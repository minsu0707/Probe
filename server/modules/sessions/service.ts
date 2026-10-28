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
import { join } from 'node:path';
import { HOME, PORT, ROOT, serviceDir } from '../../config.ts';
import { conflict, notFound, unprocessable } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { newId } from '../../core/ids.ts';
import { killTree } from '../../core/process.ts';
import type { QueuedMessage, Session, SessionKind, SessionMessage } from '../../../shared/models.ts';
import { BACKGROUND_ALLOWED_TOOLS, BACKGROUND_DENIED_TOOLS, SESSION_EXTRA_TOOLS } from '../agents/claude-cli.ts';
import { requireClaudeReady } from '../agents/service.ts';
import { recordUsage } from '../agents/usage.ts';
import { listKnowledge } from '../learning/knowledge.ts';
import { parseStreamLine } from '../learning/stream.ts';
import { listSecrets } from '../secrets/service.ts';
import { requireService } from '../services/service.ts';
import { DEFAULT_PREFS, type SessionPrefs } from '../../../shared/session-prefs.ts';
import { recentAnswers } from '../defects/service.ts';
import { getPrefs } from './prefs.ts';
import { buildSystemPrompt, openingMessage } from './prompt.ts';
import * as repo from './repository.ts';
import { snapshotSpecs, sweepDeletedSpecs } from './sweep.ts';

const STDERR_TAIL_CHARS = 2000;
const QUEUE_MAX = 10;
const TITLE_MAX = 40;

/** Cut at TITLE_MAX characters and say so, instead of stopping mid-sentence. */
const shorten = (text: string): string => {
  const chars = [...text.trim()];
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join('').trimEnd()}…` : chars.join('');
};

/** Running children by session id, so cancel and delete can find the process. */
const children = new Map<string, ChildProcess>();
/** Sessions whose current turn was stopped by the user, so the exit isn't reported as a failure. */
const cancelled = new Set<string>();

export const listSessions = (serviceId: string): Session[] => repo.forService(requireService(serviceId).id);
export const isSessionRunning = (serviceId: string): boolean => Boolean(repo.runningIn(serviceId));

export function getSession(id: string): { session: Session; messages: SessionMessage[]; queue: QueuedMessage[] } {
  const session = repo.findById(id);
  if (!session) throw notFound('Session not found');
  return { session, messages: repo.messages(id), queue: repo.queue(id) };
}

/** Create a session and send its first message. */
export async function createSession(serviceId: string, input: { kind: SessionKind; message?: string }): Promise<Session> {
  requireService(serviceId);
  const typed = input.message?.trim() ?? '';
  const first = openingMessage(input.kind, typed);
  if (!first) throw unprocessable('Type a message to start a conversation');
  await assertCanRun(serviceId);

  const id = newId();
  const title = input.kind === 'write-tests' ? '테스트 작성' : shorten(first);
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

  // Claude is busy with this very conversation, or earlier messages are still waiting (paused by a
  // stop or a restart): the new one joins the line instead of being refused.
  if (children.has(id) || repo.queue(id).length) {
    if (repo.queue(id).length >= QUEUE_MAX) throw conflict(`You can queue up to ${QUEUE_MAX} messages.`);
    repo.enqueue(id, message, Date.now());
    broadcastQueue(id);
    if (!children.has(id)) await dispatchNext(id); // idle with a paused line: sending is the signal to go on
    return repo.findById(id)!;
  }

  await assertCanRun(session.serviceId);
  await takeTurn(id, message, message);
  return repo.findById(id)!;
}

/** Send the first waiting message now. Used when a turn ends well, and by "지금 보내기" for a paused line. */
export async function dispatchNext(id: string): Promise<void> {
  if (!repo.findById(id)) throw notFound('Session not found');
  if (children.has(id)) throw conflict('Claude is still working on the current message.');
  const next = repo.queue(id)[0];
  if (!next) throw conflict('No message is waiting.');
  await assertCanRun(repo.findById(id)!.serviceId);
  repo.dequeue(id, next.id);
  broadcastQueue(id);
  try {
    await takeTurn(id, next.text, next.text);
  } catch (e) {
    repo.requeue(next); // it never started: keep it
    broadcastQueue(id);
    throw e;
  }
}

export function removeQueued(sessionId: string, queuedId: number): void {
  if (!repo.dequeue(sessionId, queuedId)) throw notFound('That message is not waiting any more');
  broadcastQueue(sessionId);
}

function broadcastQueue(sessionId: string): void {
  broadcast({ type: 'session:queue', sessionId, queue: repo.queue(sessionId) });
}

export function cancelSession(id: string): void {
  const child = children.get(id);
  if (!child) throw conflict('Nothing is running in this session');
  cancelled.add(id);
  killTree(child);
}

export function renameSession(id: string, title: string): Session {
  if (!repo.findById(id)) throw notFound('Session not found');
  repo.rename(id, title.trim());
  const session = repo.findById(id)!;
  broadcast({ type: 'session', session });
  return session;
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

  const specsBefore = snapshotSpecs(session.serviceId);
  const args = buildArgs({ prompt, claudeSessionId: ids.claudeSessionId, resume: ids.started, system: buildSystemPrompt(contextFor(session.serviceId)), prefs: getPrefs(session.serviceId), readOnly: requireService(session.serviceId).readOnly });
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
    const removed = sweepDeletedSpecs(session.serviceId, specsBefore);
    if (removed.length) say(id, 'tool', `컴퓨터 휴지통으로 옮긴 파일: ${removed.join(', ')}`);
    if (note) say(id, 'error', note);
    setStatus(id, status);
    broadcast({ type: 'service', serviceId: session.serviceId });
    // Only a turn that ended well moves the line on. After a stop or a failure the messages wait
    // for the user, who sees them and chooses (send now, or remove).
    if (status === 'idle' && !note && repo.queue(id)[0]) {
      dispatchNext(id).catch((e: unknown) => say(id, 'error', `예약한 메시지를 보내지 못했습니다: ${e instanceof Error ? e.message : String(e)}`));
    }
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
  return { serviceName: service.name, baseUrl: service.baseUrl, envNames: listSecrets(serviceId).map((s) => s.key), knowledgeFiles: listKnowledge(serviceId).map((f) => f.name), readOnly: service.readOnly, conventions: service.conventions, answers: recentAnswers(serviceId, 40) };
}

/** Probe's own MCP server for this session, so run_tests works whichever Claude login is in use. It must not open a browser tab: the app is already open. */
function probeMcpConfig(): string {
  const electron = Boolean(process.versions.electron);
  const env = { PROBE_MCP_NO_OPEN: '1', PORT: String(PORT), PROBE_HOME: HOME, ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
  return JSON.stringify({ mcpServers: { probe: { command: process.execPath, args: [join(ROOT, 'mcp', 'server.ts')], env } } });
}

/**
 * Same tool policy as every background job (see agents/claude-cli.ts) unless the user chose a wider
 * mode: Auto and Bypass permissions open the shell and the web. A 조회 전용 service always keeps them
 * closed, whatever the mode, because there a stray command could change data the owner wants untouched.
 */
export function buildArgs(o: { prompt: string; claudeSessionId: string; resume: boolean; system: string; prefs?: SessionPrefs; readOnly?: boolean }): string[] {
  const prefs = o.prefs ?? DEFAULT_PREFS;
  const open = (prefs.mode === 'auto' || prefs.mode === 'bypassPermissions') && !o.readOnly;
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
    prefs.mode,
    ...(prefs.model === 'default' ? [] : ['--model', prefs.model]),
    ...(prefs.effort === 'default' ? [] : ['--effort', prefs.effort]),
    '--mcp-config',
    probeMcpConfig(),
    '--allowedTools',
    ...BACKGROUND_ALLOWED_TOOLS,
    ...SESSION_EXTRA_TOOLS,
    ...(open ? [] : ['--disallowedTools', ...BACKGROUND_DENIED_TOOLS]),
  ];
}

function say(sessionId: string, role: SessionMessage['role'], text: string): void {
  broadcast({ type: 'session:message', message: repo.addMessage(sessionId, role, text, Date.now()) });
}

function setStatus(id: string, status: Session['status']): void {
  repo.setStatus(id, status, Date.now());
  broadcast({ type: 'session', session: repo.findById(id)! });
}
