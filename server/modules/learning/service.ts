/**
 * The learning job: run `claude -p` over a service's documents and let it write the
 * knowledge files. It uses whatever login the installed Claude Code already has, so Probe
 * needs no API key.
 *
 * Lifecycle of a job:  running → done | failed | cancelled
 * Progress lines are persisted and broadcast as they arrive so the UI can show them live.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { conflict, unprocessable } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { newId } from '../../core/ids.ts';
import { killTree } from '../../core/process.ts';
import { serviceDir } from '../../config.ts';
import type { Job } from '../../../shared/models.ts';
import { requireClaudeReady } from '../agents/service.ts';
import { recordUsage } from '../agents/usage.ts';
import { listDocs, markLearned } from '../documents/service.ts';
import { requireService } from '../services/service.ts';
import { createSession } from '../sessions/service.ts';
import { exploreService } from './explore.ts';
import { countKnowledge } from './knowledge.ts';
import { buildClaudeArgs, buildLearnPrompt } from './prompt.ts';
import * as repo from './repository.ts';
import { parseStreamLine } from './stream.ts';

const MAX_LOG_LINES = 400;
const STDERR_TAIL_CHARS = 2000;

/** Running children by job id, so a cancel request can find the process. */
const children = new Map<string, ChildProcess>();

export const listJobs = (serviceId: string, limit = 10): Job[] => repo.recent(serviceId, limit);
export const isLearning = repo.isLearning;

export async function startLearn(serviceId: string, opts: { explore?: boolean; writeTests?: boolean } = {}): Promise<Job> {
  const service = requireService(serviceId);
  if (repo.findRunning(serviceId)) throw conflict('Learning is already running for this service');
  const docs = listDocs(serviceId);
  if (opts.explore && !service.baseUrl) throw unprocessable('서비스 주소를 먼저 입력해야 서비스를 둘러볼 수 있습니다');
  if (docs.length === 0 && !opts.explore) throw unprocessable('Add at least one document or Drive link first');
  // Fail here with a clear message rather than as a cryptic exit code from the CLI.
  const env = await requireClaudeReady();
  if (repo.findRunning(serviceId)) throw conflict('Learning is already running for this service'); // re-check: the await above let another request in

  const id = newId();
  repo.insert(id, serviceId, Date.now());

  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    if (log.length > MAX_LOG_LINES) log.shift();
    repo.saveLog(id, log);
    broadcast({ type: 'job', job: repo.findById(id)! });
  };
  /** Phase two: Claude reads the documents (and what the exploration found) and writes the knowledge files. */
  const begin = (explored: boolean) => {
    const prompt = buildLearnPrompt({
      serviceName: service.name,
      baseUrl: service.baseUrl,
      driveLinks: docs.filter((d) => d.kind === 'drive').map((d) => d.ref),
      hasExistingKnowledge: countKnowledge(serviceId) > 0,
      hasExploration: explored,
    });
    const child = spawn('claude', buildClaudeArgs(prompt), { cwd: serviceDir(serviceId), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.set(id, child);

    if (docs.length) note(`자료 ${docs.length}개를 읽기 시작합니다`);
    else note('올린 자료 없이 둘러본 내용만으로 정리합니다');

    // Outcome is collected while streaming and decided once the process exits.
    let summary: string | null = null;
    let reportedError: string | null = null;
    let stderrTail = '';
    let pending = '';

    child.stderr!.on('data', (d: Buffer) => (stderrTail = (stderrTail + d.toString()).slice(-STDERR_TAIL_CHARS)));
    child.stdout!.on('data', (d: Buffer) => {
      pending += d.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? ''; // the last piece may be half a line
      for (const line of lines)
        for (const ev of parseStreamLine(line)) {
          if (ev.kind === 'progress') note(ev.text);
          else if (ev.kind === 'usage') recordUsage(ev.usage);
          else if (ev.kind === 'result') {
            if (ev.ok) summary = ev.text;
            else reportedError = ev.text;
          }
        }
    });

    child.on('error', (e) => finish(id, serviceId, log, 'failed', null, `Could not start the claude CLI: ${e.message}`));
    child.on('close', (code) => {
      children.delete(id);
      if (repo.findById(id)?.status === 'cancelled') return; // cancelLearn() already closed the job
      if (reportedError || code !== 0 || summary === null) {
        return finish(id, serviceId, log, 'failed', null, reportedError ?? `claude exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`);
      }
      if (countKnowledge(serviceId) === 0) return finish(id, serviceId, log, 'failed', summary, 'Claude finished but wrote no knowledge files');
      markLearned(serviceId);
      if (opts.writeTests) log.push('이어서 Claude 세션에서 기능별 테스트 케이스를 만듭니다. 진행은 Claude 세션 탭에서 볼 수 있습니다');
      finish(id, serviceId, log, 'done', summary);
      // After the job is closed, so a busy or signed-out Claude cannot turn a good learning run into a failed one.
      if (opts.writeTests) void createSession(serviceId, { kind: 'write-tests', message: '학습한 내용으로 테스트 케이스를 만들어 주세요. 먼저 가이드나 시나리오 문서의 처음부터 끝까지 프로세스를 입력값과 기대 결과까지 그대로 따라가는 E2E 테스트를 만들고, 그다음 기능별 확인 테스트를 만들어 주세요' }).catch(() => undefined);
    });

  };

  if (opts.explore) {
    note('서비스를 직접 둘러보는 중입니다. 메뉴와 화면을 읽기만 하고 아무것도 저장하지 않습니다');
    void exploreService(serviceId, service.baseUrl!, note, (c) => children.set(id, c)).then((r) => {
      if (repo.findById(id)?.status !== 'running') return; // cancelled while exploring
      note(r.note);
      if (!r.ok && docs.length === 0) return finish(id, serviceId, log, 'failed', null, r.note);
      begin(r.ok);
    });
  } else begin(false);

  return repo.findById(id)!;
}

/** Close a job exactly once; later calls (e.g. 'error' after 'close') are ignored. */
function finish(id: string, serviceId: string, log: string[], status: Job['status'], summary: string | null, errorNote?: string): void {
  if (repo.findById(id)?.status !== 'running') return;
  if (errorNote) log.push(errorNote);
  repo.close(id, status, Date.now(), summary ?? errorNote ?? null, log);
  broadcast({ type: 'job', job: repo.findById(id)! });
  broadcast({ type: 'service', serviceId });
}

export function cancelLearn(serviceId: string): void {
  const job = repo.findRunning(serviceId);
  if (!job) throw conflict('Nothing is running');
  repo.markCancelled(job.id, Date.now());
  const child = children.get(job.id);
  if (child) killTree(child);
  broadcast({ type: 'job', job: repo.findById(job.id)! });
}
