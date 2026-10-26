export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

/** Events posted by the Playwright reporter / fixture to POST /api/ingest/:runId */
export type IngestEvent =
  | { type: 'run:plan'; total: number }
  | { type: 'test:begin'; id: string; title: string[]; file: string; project: string }
  | { type: 'step'; id: string; title: string }
  | { type: 'page'; id: string; url: string }
  | { type: 'view'; id: string; name: string; feature?: string }
  | {
      type: 'test:end';
      id: string;
      status: TestStatus;
      durationMs: number;
      retry: number;
      error?: string;
      errorStack?: string;
      screenshot?: string;
      trace?: string;
    }
  | { type: 'run:end'; status: 'passed' | 'failed' | 'timedOut' | 'interrupted' };

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  running: number;
}

export interface RunCurrent {
  testId: string | null;
  test: string[] | null;
  file: string | null;
  page: string | null;
  feature: string | null;
  view: string | null;
  step: string | null;
}

export type RunStatus = 'starting' | 'running' | 'passed' | 'failed' | 'stopped' | 'error';

export interface RunSummary {
  id: string;
  serviceId: string;
  title: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  totals: RunTotals;
  defects: number;
  current: RunCurrent;
}

/** Messages pushed over the WebSocket. */
export type ServerMessage =
  | { type: 'run'; run: RunSummary }
  | { type: 'log'; runId: string; ts: number; kind: 'test' | 'step' | 'page' | 'view' | 'result' | 'system'; text: string; status?: TestStatus }
  | { type: 'frame'; runId: string; ts: number }
  | { type: 'defect'; defect: Defect }
  | { type: 'job'; job: Job }
  | { type: 'service'; serviceId: string }
  | { type: 'docs'; serviceId: string };

export interface Defect {
  id: string;
  serviceId: string;
  runId: string;
  fingerprint: string;
  title: string;
  severity: 'critical' | 'major' | 'minor';
  status: 'candidate' | 'confirmed' | 'false_positive' | 'fixed';
  page: string | null;
  feature: string | null;
  error: string;
  screenshot: string | null;
  trace: string | null;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
}

export interface Job {
  id: string;
  serviceId: string;
  kind: 'learn';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt: number | null;
  log: string[];
  summary: string | null;
}
