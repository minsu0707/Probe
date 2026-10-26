/**
 * Receiving events from the Playwright process (reporter and fixture) over HTTP.
 *
 * Every batch is authenticated with the run's token, scrubbed of credentials, folded into
 * the run state by the pure reducer, and then turned into side effects: log lines, defects,
 * a saved summary and a broadcast.
 */
import { broadcast } from '../../core/hub.ts';
import { HttpError } from '../../core/errors.ts';
import type { IngestEvent } from '../../../shared/events.ts';
import { recordFailure } from '../defects/service.ts';
import { persist, writeLog } from './emit.ts';
import { getLive, type LiveRun } from './live.ts';
import { scrubDeep } from './redact.ts';
import { reduceEvents } from './reduce.ts';

/** @throws 401 for an unknown run or wrong token. */
export function authorize(runId: string, token: string | undefined): LiveRun {
  const run = getLive(runId);
  if (!run || run.token !== token) throw new HttpError(401, 'Unknown run or bad token');
  return run;
}

export function ingestEvents(runId: string, token: string | undefined, events: IngestEvent[]): void {
  const run = authorize(runId, token);
  const { logs, failures, runEnded } = reduceEvents(run, scrubDeep(events, run.redactions));

  for (const l of logs) writeLog(run, l.kind, l.text, l.status);
  for (const f of failures) {
    recordFailure({
      serviceId: run.summary.serviceId,
      runId,
      testTitle: f.title,
      feature: f.feature,
      page: f.page,
      error: f.end.error,
      screenshot: f.end.screenshot,
      trace: f.end.trace,
    });
  }
  if (runEnded) run.reporterFinished = true;
  persist(run);
}

/** Keep the newest screenshot only; the UI polls it whenever a 'frame' message arrives. */
export function ingestFrame(runId: string, token: string | undefined, jpeg: Buffer): void {
  const run = authorize(runId, token);
  run.frame = jpeg;
  broadcast({ type: 'frame', runId, ts: Date.now() });
}
