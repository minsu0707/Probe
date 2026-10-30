/**
 * The run's state machine, as a pure function.
 *
 * Playwright events go in; a changed RunSummary plus a list of "things to do about it"
 * (log lines, failures to record) come out. Nothing here touches the database, the
 * network or the clock, so the whole behaviour can be unit-tested with plain objects.
 * The caller (ingest.ts) performs the side effects.
 */
import { basename } from 'node:path';
import { encodeAct } from '../../../shared/actions.ts';
import { isDiagnosticDump } from '../../../shared/need.ts';
import { isTemporarySpec } from '../../../shared/temp-spec.ts';
import type { IngestEvent } from '../../../shared/events.ts';
import type { LogKind, RunCurrent, RunSummary, RunTotals, TestStatus } from '../../../shared/models.ts';

export const emptyTotals = (): RunTotals => ({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, running: 0 });
export const emptyCurrent = (): RunCurrent => ({ testId: null, test: null, file: null, page: null, feature: null, view: null, step: null });

export interface RunningTest {
  title: string[];
  file: string;
}

export interface RunState {
  /** Mutated in place by `reduceEvents`. */
  summary: RunSummary;
  /** Tests that have begun but not ended. */
  active: Map<string, RunningTest>;
}

export interface LogDraft {
  kind: LogKind;
  text: string;
  status?: TestStatus;
}

export interface Failure {
  title: string[];
  file: string;
  feature: string;
  page: string | null;
  end: Extract<IngestEvent, { type: 'test:end' }>;
}

export interface Reduction {
  logs: LogDraft[];
  failures: Failure[];
  /** The reporter said the run is over (the process exit then finalizes it). */
  runEnded: boolean;
}

/**
 * What the monitor calls the "feature": the enclosing `test.describe` titles, or the spec
 * file's name when the test is top-level.
 */
export const featureOf = (title: string[], file: string): string =>
  title.length > 1 ? title.slice(0, -1).join(' › ') : basename(file).replace(/\.(spec|test)\.[cm]?[jt]s$/, '');

/** "http://host/cart?x=1" → "/cart?x=1". The host is the service, which the UI already shows. */
export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

export function reduceEvents(state: RunState, events: IngestEvent[]): Reduction {
  const { summary: s, active } = state;
  const out: Reduction = { logs: [], failures: [], runEnded: false };
  const log = (kind: LogKind, text: string, status?: TestStatus) => out.logs.push({ kind, text, status });

  for (const ev of events) {
    switch (ev.type) {
      case 'run:plan':
        s.totals.total = ev.total;
        s.status = 'running';
        break;

      case 'test:begin':
        active.set(ev.id, { title: ev.title, file: ev.file });
        s.status = 'running';
        // A new test starts with no view or step; the page carries over until it navigates.
        s.current = { testId: ev.id, test: ev.title, file: ev.file, page: s.current.page, feature: featureOf(ev.title, ev.file), view: null, step: null };
        log('test', ev.title.join(' › '));
        break;

      case 'step':
        if (s.current.testId === ev.id) s.current.step = ev.title;
        log('step', ev.title);
        break;

      case 'stage':
        log('stage', ev.title, ev.status);
        break;

      case 'page': {
        const path = pagePath(ev.url);
        if (s.current.page !== path) log('page', path); // reloads of the same page aren't news
        s.current.page = path;
        break;
      }

      case 'act':
        log('action', encodeAct({ what: ev.what, target: ev.target, value: ev.value }));
        break;

      case 'view':
        s.current.view = ev.name;
        if (ev.feature) s.current.feature = ev.feature;
        log('view', ev.feature ? `${ev.feature} › ${ev.name}` : ev.name);
        break;

      case 'test:end': {
        const test = active.get(ev.id);
        active.delete(ev.id);
        tally(s.totals, ev);
        log('result', `${(test?.title ?? []).join(' › ')} (${(ev.durationMs / 1000).toFixed(1)}s)`, ev.status);
        // A spec Claude wrote only to look at the site fails on purpose to print what it saw; that printout is not a defect of the site.
        // Anything else it hits (a timeout, a server error, a wrong value) may be real, so it is kept.
        if (test && ev.status !== 'passed' && ev.status !== 'skipped' && !(isTemporarySpec(test.file) && isDiagnosticDump(ev.error ?? ''))) {
          out.failures.push({ title: test.title, file: test.file, feature: featureOf(test.title, test.file), page: s.current.page, end: ev });
        }
        if (s.current.testId === ev.id) s.current = { ...s.current, testId: null, test: null, step: null, view: null };
        break;
      }

      case 'run:end':
        out.runEnded = true;
        break;
    }
  }

  s.totals.running = active.size;
  return out;
}

function tally(totals: RunTotals, ev: Extract<IngestEvent, { type: 'test:end' }>): void {
  if (ev.status === 'passed') {
    totals.passed++;
    if (ev.retry > 0) totals.flaky++; // passed, but only on a retry
  } else if (ev.status === 'skipped') totals.skipped++;
  else totals.failed++;
}
