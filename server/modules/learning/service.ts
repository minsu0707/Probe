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
import { listDocs, markLearned } from '../documents/service.ts';
import { requireService } from '../services/service.ts';
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

export function startLearn(serviceId: string): Job {
  const service = requireService(serviceId);
  if (repo.findRunning(serviceId)) throw conflict('Learning is already running for this service');
  const docs = listDocs(serviceId);
  if (docs.length === 0) throw unprocessable('Add at least one document or Drive link first');

  const id = newId();
  repo.insert(id, serviceId, Date.now());

  const prompt = buildLearnPrompt({
    serviceName: service.name,
    baseUrl: service.baseUrl,
    driveLinks: docs.filter((d) => d.kind === 'drive').map((d) => d.ref),
    hasExistingKnowledge: countKnowledge(serviceId) > 0,
  });
  const child = spawn('claude', buildClaudeArgs(prompt), { cwd: serviceDir(serviceId), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.set(id, child);

  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    if (log.length > MAX_LOG_LINES) log.shift();
    repo.saveLog(id, log);
    broadcast({ type: 'job', job: repo.findById(id)! });
  };
  note(`자료 ${docs.length}개를 읽기 시작합니다`);

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
        else if (ev.ok) summary = ev.text;
        else reportedError = ev.text;
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
    finish(id, serviceId, log, 'done', summary);
  });

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
