/**
 * Starting, stopping and finishing runs.
 *
 * Lifecycle:  starting → running → passed | failed          (reporter finished)
 *                                 → stopped                 (user pressed stop)
 *                                 → error                   (Playwright died, or ran nothing)
 *
 * While a run is live its authoritative state is in memory (live.ts); every change is also
 * written to the database and broadcast (emit.ts). Events arriving from the test process are
 * handled in ingest.ts.
 */
import { randomBytes } from 'node:crypto';
import { conflict, notFound, unprocessable } from '../../core/errors.ts';
import { newId } from '../../core/ids.ts';
import { killTree } from '../../core/process.ts';
import { ensureDir, runDir } from '../../config.ts';
import type { LogLine, RunStatus, RunSummary } from '../../../shared/models.ts';
import { countRunDefects } from '../defects/service.ts';
import { runtimeEnv, sensitiveValues } from '../secrets/service.ts';
import { requireService } from '../services/service.ts';
import { scaffoldWorkspace } from '../services/workspace.ts';
import { persist, writeLog } from './emit.ts';
import { launchPlaywright, listSpecFiles } from './launcher.ts';
import { activeSummary, addLive, getLive, isActive, retire, type LiveRun } from './live.ts';
import { redactionForms, scrub } from './redact.ts';
import { emptyCurrent, emptyTotals } from './reduce.ts';
import * as repo from './repository.ts';

export interface StartOptions {
  grep?: string;
  file?: string;
  headed?: boolean;
  title?: string;
}

export const activeRun = activeSummary;
export const liveFrame = (runId: string): Buffer | null => getLive(runId)?.frame ?? null;
export const runLog = (runId: string, afterId = 0, limit = 500): LogLine[] => repo.logAfter(runId, afterId, limit);

const withDefects = (s: RunSummary): RunSummary => ({ ...s, defects: countRunDefects(s.id) });

export function getRun(id: string): RunSummary {
  const live = getLive(id);
  if (live) return live.summary;
  const stored = repo.findRun(id);
  if (!stored) throw notFound(`Run ${id} not found`);
  return withDefects(stored);
}

/** Live runs report their in-memory summary; the rest come from the database. */
export function listRuns(serviceId?: string, limit = 50): RunSummary[] {
  return repo.listRuns(serviceId, limit).map((stored) => getLive(stored.id)?.summary ?? withDefects(stored));
}

export function startRun(serviceId: string, opts: StartOptions = {}): RunSummary {
  const service = requireService(serviceId);
  if (activeRun(serviceId)) throw conflict(`${service.name} already has a run in progress`);

  scaffoldWorkspace(serviceId);
  const specs = listSpecFiles(serviceId);
  if (specs.length === 0) throw unprocessable('No spec files yet. Ask Claude to write tests first.');
  if (!service.baseUrl && !runtimeEnv(serviceId).BASE_URL) throw unprocessable('Set the service URL (or BASE_URL in the env file) before running');

  const summary: RunSummary = {
    id: newId(),
    serviceId,
    title: opts.title?.trim() || (opts.grep ? `${service.name} · ${opts.grep}` : service.name),
    status: 'starting',
    startedAt: Date.now(),
    endedAt: null,
    totals: emptyTotals(),
    current: emptyCurrent(),
    defects: 0,
  };
  repo.insertRun(summary);
  ensureDir(runDir(summary.id));

  const run: LiveRun = {
    summary,
    active: new Map(),
    token: randomBytes(16).toString('hex'),
    proc: null,
    frame: null,
    stopped: false,
    reporterFinished: false,
    outputTail: [],
    redactions: redactionForms(sensitiveValues(serviceId)),
  };
  addLive(run);

  run.proc = launchPlaywright({ serviceId, runId: summary.id, token: run.token, grep: opts.grep, file: opts.file, headed: opts.headed });
  writeLog(run, 'system', `Started ${specs.length} spec file${specs.length === 1 ? '' : 's'}${opts.grep ? ` matching "${opts.grep}"` : ''}`);
  watchProcess(run);
  persist(run);
  return summary;
}

/** Keep the last lines of output (for diagnostics) and finish the run when the process exits. */
function watchProcess(run: LiveRun): void {
  const proc = run.proc!;
  for (const stream of [proc.stdout!, proc.stderr!]) {
    let partial = '';
    stream.on('data', (chunk: Buffer) => {
      const lines = (partial + chunk.toString('utf8')).split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) run.outputTail = [...run.outputTail.slice(-29), scrub(line, run.redactions)];
    });
  }
  proc.on('error', (e) => finishRun(run, 'error', `Could not start Playwright: ${e.message}`));
  proc.on('close', (code) => {
    if (run.reporterFinished) return finishRun(run);
    if (run.stopped) return finishRun(run, 'stopped');
    const detail = run.outputTail.join('\n');
    finishRun(run, 'error', `Playwright exited with code ${code} before reporting a result${detail ? `:\n${detail}` : ''}`);
  });
}

/**
 * Close a run. With no `forced` status the result is derived from the counts; a run in
 * which no test executed is an error, not a pass.
 */
export function finishRun(run: LiveRun, forced?: RunStatus, note?: string): void {
  const s = run.summary;
  if (s.endedAt) return; // already closed (e.g. 'error' followed by 'close')

  const executed = s.totals.passed + s.totals.failed + s.totals.skipped;
  let status: RunStatus;
  if (forced) status = forced;
  else if (executed === 0) {
    status = 'error';
    note ??= `No tests ran.${run.outputTail.length ? `\n${run.outputTail.join('\n')}` : ''}`;
  } else status = s.totals.failed > 0 ? 'failed' : 'passed';

  s.status = status;
  s.endedAt = Date.now();
  s.current = { ...emptyCurrent(), page: s.current.page };
  s.totals.running = 0;
  run.active.clear();
  run.frame = null;

  if (note) writeLog(run, 'system', note);
  writeLog(run, 'system', `Run ${status}: ${s.totals.passed} passed, ${s.totals.failed} failed, ${s.totals.skipped} skipped`);
  persist(run);
  retire(s.id);
}

export function stopRun(id: string): void {
  const run = getLive(id);
  if (!run || !isActive(run.summary)) throw conflict('Run is not active');
  run.stopped = true;
  if (run.proc) killTree(run.proc);
}
