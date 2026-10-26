/** The two side effects every run change needs: save it, and tell the browsers. */
import { broadcast } from '../../core/hub.ts';
import type { LogKind, TestStatus } from '../../../shared/models.ts';
import { countRunDefects } from '../defects/service.ts';
import type { LiveRun } from './live.ts';
import * as repo from './repository.ts';

/** Refresh the defect count, store the summary, and push it to the UI. */
export function persist(run: LiveRun): void {
  run.summary.defects = countRunDefects(run.summary.id);
  repo.saveRun(run.summary);
  broadcast({ type: 'run', run: run.summary });
}

export function writeLog(run: LiveRun, kind: LogKind, text: string, status?: TestStatus): void {
  const ts = Date.now();
  repo.appendLog(run.summary.id, { ts, kind, text, status });
  broadcast({ type: 'log', runId: run.summary.id, ts, kind, text, status });
}
