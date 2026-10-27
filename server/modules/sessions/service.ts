/**
 * Sessions: conversations with Claude about one service ("테스트 작성", free chat).
 *
 * Every user message is one `claude -p` process. The first turn creates the CLI session with a
 * fixed id (--session-id), later turns continue it (--resume <id>), so Claude keeps its context
 * across turns and restarts. Output is `stream-json`; each piece is stored and broadcast as it
 * arrives.
 *
 * One turn may run per service at a time: two Claudes writing into the same tests folder would
 * overwrite each other.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { serviceDir } from '../../config.ts';
import { conflict, notFound, unprocessable } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { newId } from '../../core/ids.ts';
import { killTree } from '../../core/process.ts';
import type { Session, SessionKind, SessionMessage } from '../../../shared/models.ts';
import { BACKGROUND_ALLOWED_TOOLS, BACKGROUND_DENIED_TOOLS } from '../agents/claude-cli.ts';
import { requireClaudeReady } from '../agents/service.ts';
import { recordUsage } from '../agents/usage.ts';
import { listKnowledge } from '../learning/knowledge.ts';
import { parseStreamLine } from '../learning/stream.ts';
import { listSecrets } from '../secrets/service.ts';
import { requireService } from '../services/service.ts';
import { buildSystemPrompt, openingMessage } from './prompt.ts';
import * as repo from './repository.ts';
import { sweepDeletedSpecs } from './sweep.ts';

const STDERR_TAIL_CHARS = 2000;
const TITLE_MAX = 40;

/** Running children by session id, so cancel and delete can find the process. */
const children = new Map<string, ChildProcess>();
/** Sessions whose current turn was stopped by the user, so the exit isn't reported as a failure. */
const cancelled = new Set<string>();

export const listSessions = (serviceId: string): Session[] => repo.forService(requireService(serviceId).id);
export const isSessionRunning = (serviceId: string): boolean => Boolean(repo.runningIn(serviceId));

export function getSession(id: string): { session: Session; messages: SessionMessage[] } {
  const session = repo.findById(id);
  if (!session) throw notFound('Session not found');
  return { session, messages: repo.messages(id) };
}

/** Create a session and send its first message. */
export async function createSession(serviceId: string, input: { kind: SessionKind; message?: string }): Promise<Session> {
  requireService(serviceId);
  const typed = input.message?.trim() ?? '';
  const first = openingMessage(input.kind, typed);
  if (!first) throw unprocessable('Type a message to start a conversation');
  await assertCanRun(serviceId);

  const id = newId();
  const title = input.kind === 'write-tests' ? '테스트 작성' : [...first].slice(0, TITLE_MAX).join('');
  repo.insert({ id, serviceId, title, kind: input.kind, claudeSessionId: randomUUID(), now: Date.now() });
  broadcast({ type: 'session', session: repo.findById(id)! });
  // The transcript shows the user's own words, not the longer instruction behind the button.
  await takeTurn(id, first, typed || (input.kind === 'write-tests' ? '테스트 작성 시작' : first));
  return repo.findById(id)!;
}

export async function sendMessage(id: string, text: string): Promise<Session> {
  const session = repo.findById(id);
  if (!session) throw notFound('Session not found');
  const message = text.trim();
  if (!message) throw unprocessable('Message is empty');
  await assertCanRun(session.serviceId);
  await takeTurn(id, message, message);
  return repo.findById(id)!;
}

export function cancelSession(id: string): void {
  const child = children.get(id);
  if (!child) throw conflict('Nothing is running in this session');
  cancelled.add(id);
  killTree(child);
}

export function deleteSession(id: string): void {
  const session = repo.findById(id);
  if (!session) throw notFound('Session not found');
  if (children.has(id)) throw conflict('Stop the running turn first');
  repo.remove(id);
  broadcast({ type: 'session:deleted', sessionId: id, serviceId: session.serviceId });
}

/** Refuse before touching anything: another turn in this service, or Claude not usable. */
async function assertCanRun(serviceId: string): Promise<void> {
  if (repo.runningIn(serviceId)) throw conflict('Claude is already working in this service. Wait for it or stop it first.');
  await requireClaudeReady();
  if (repo.runningIn(serviceId)) throw conflict('Claude is already working in this service.'); // re-check: the await let another request in
}

/** One `claude -p` process. `prompt` goes to Claude, `shown` is what the transcript records as the user's message. */
async function takeTurn(id: string, prompt: string, shown: string): Promise<void> {
  const session = repo.findById(id)!;
  const ids = repo.cli(id)!;
  const env = await requireClaudeReady();
  if (repo.runningIn(session.serviceId)) throw conflict('Claude is already working in this service.');

  say(id, 'user', shown);
  setStatus(id, 'running');
  broadcast({ type: 'service', serviceId: session.serviceId });

  const args = buildArgs({ prompt, claudeSessionId: ids.claudeSessionId, resume: ids.started, system: buildSystemPrompt(contextFor(session.serviceId)) });
  const child = spawn('claude', args, { cwd: serviceDir(session.serviceId), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.set(id, child);

  let resultOk: boolean | null = null; // null: the stream ended without a result
  let stderrTail = '';
  let pending = '';

  child.stderr!.on('data', (d: Buffer) => (stderrTail = (stderrTail + d.toString()).slice(-STDERR_TAIL_CHARS)));
  child.stdout!.on('data', (d: Buffer) => {
    pending += d.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines)
      for (const ev of parseStreamLine(line)) {
        if (ev.kind === 'init') repo.markStarted(id);
        else if (ev.kind === 'usage') recordUsage(ev.usage);
        else if (ev.kind === 'text') say(id, 'assistant', ev.text);
        else if (ev.kind === 'progress') say(id, 'tool', ev.text);
        else {
          resultOk = ev.ok;
          if (!ev.ok) say(id, 'error', ev.text);
        }
      }
  });

  let closed = false;
  const close = (status: Session['status'], note?: string) => {
    if (closed) return; // 'error' can be followed by 'close'
    closed = true;
    children.delete(id);
    const removed = sweepDeletedSpecs(session.serviceId);
    if (removed.length) say(id, 'tool', `삭제한 파일: ${removed.join(', ')}`);
    if (note) say(id, 'error', note);
    setStatus(id, status);
    broadcast({ type: 'service', serviceId: session.serviceId });
  };
  child.on('error', (e) => close('failed', `Could not start the claude CLI: ${e.message}`));
  child.on('close', (code) => {
    if (cancelled.delete(id)) return close('idle', '중단했습니다');
    if (resultOk === true) return close('idle');
    // A reported error is already in the transcript; otherwise say what the process said.
    close('failed', resultOk === false ? undefined : `claude exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`);
  });
}

function contextFor(serviceId: string) {
  const service = requireService(serviceId);
  return { serviceName: service.name, baseUrl: service.baseUrl, envNames: listSecrets(serviceId).map((s) => s.key), knowledgeFiles: listKnowledge(serviceId).map((f) => f.name), readOnly: service.readOnly };
}

/** Same tool policy as every background job; see agents/claude-cli.ts for why it is explicit. */
export function buildArgs(o: { prompt: string; claudeSessionId: string; resume: boolean; system: string }): string[] {
  return [
    '-p',
    o.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    o.resume ? '--resume' : '--session-id',
    o.claudeSessionId,
    '--append-system-prompt',
    o.system,
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ...BACKGROUND_ALLOWED_TOOLS,
    '--disallowedTools',
    ...BACKGROUND_DENIED_TOOLS,
  ];
}

function say(sessionId: string, role: SessionMessage['role'], text: string): void {
  broadcast({ type: 'session:message', message: repo.addMessage(sessionId, role, text, Date.now()) });
}

function setStatus(id: string, status: Session['status']): void {
  repo.setStatus(id, status, Date.now());
  broadcast({ type: 'session', session: repo.findById(id)! });
}
