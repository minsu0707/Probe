/**
 * Data shapes that cross a process boundary (server ⇄ browser, server ⇄ MCP).
 * Keep this file free of imports and runtime code so every side can use it.
 */

// ------------------------------------------------------------------ services

export interface Service {
  id: string;
  name: string;
  baseUrl: string | null;
  notes: string | null;
  createdAt: number;
}

/** A service plus the counters the UI shows next to it. */
export interface ServiceOverview extends Service {
  secretCount: number;
  docCount: number;
  /** Documents added since the last successful learning job. */
  unlearnedDocs: number;
  knowledgeCount: number;
  openDefects: number;
  lastRun: RunSummary | null;
  activeRun: RunSummary | null;
  learning: boolean;
}

/** An environment variable as shown to the UI. Sensitive values are never included. */
export interface SecretMeta {
  key: string;
  sensitive: boolean;
  value?: string;
}

// ----------------------------------------------------------------- documents

export interface Doc {
  id: string;
  serviceId: string;
  kind: 'file' | 'drive';
  name: string;
  /** File name under the service's docs folder, or the Drive URL. */
  ref: string;
  mime: string | null;
  size: number;
  learnedAt: number | null;
  addedAt: number;
}

export interface KnowledgeFile {
  name: string;
  content: string;
  updatedAt: number;
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

// ---------------------------------------------------------------------- runs

export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
export type RunStatus = 'starting' | 'running' | 'passed' | 'failed' | 'stopped' | 'error';

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** Tests that passed only after a retry. Already counted in `passed`. */
  flaky: number;
  running: number;
}

/** Where the run is right now: what the monitor's "지금 하는 일" card shows. */
export interface RunCurrent {
  testId: string | null;
  test: string[] | null;
  file: string | null;
  page: string | null;
  feature: string | null;
  view: string | null;
  step: string | null;
}

export interface RunSummary {
  id: string;
  serviceId: string;
  title: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  totals: RunTotals;
  /** Distinct defects (by fingerprint) raised by this run. */
  defects: number;
  current: RunCurrent;
}

export type LogKind = 'test' | 'step' | 'page' | 'view' | 'result' | 'system';

export interface LogLine {
  id?: number;
  ts: number;
  kind: LogKind;
  text: string;
  status?: string | null;
}

// ------------------------------------------------------------------- defects

export type Severity = 'critical' | 'major' | 'minor';
export type DefectStatus = 'candidate' | 'confirmed' | 'false_positive' | 'fixed';

export interface Defect {
  id: string;
  serviceId: string;
  runId: string;
  /** Stable hash of (service, test, error shape). Identical failures share it. */
  fingerprint: string;
  title: string;
  severity: Severity;
  status: DefectStatus;
  page: string | null;
  feature: string | null;
  error: string;
  /** File names under the run's folder, served by /api/runs/:id/files/:name. */
  screenshot: string | null;
  trace: string | null;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
}

// -------------------------------------------------------------------- agents

/** Where the Claude CLI keeps its login: Probe's own folder, or whatever the environment gives. */
export type ClaudeProfile = 'probe' | 'system';

/** What `claude auth status` reports. Tokens are never part of it. */
export interface ClaudeAuth {
  loggedIn: boolean;
  /** 'claude.ai' (subscription), 'console' (API billing), or 'none'. */
  method: string;
  /** e.g. 'pro', 'max', 'team'. */
  plan: string | null;
  email: string | null;
  organization: string | null;
  configDirectory: string | null;
}

export type LoginPhase = 'idle' | 'starting' | 'waiting' | 'verifying' | 'done' | 'failed' | 'cancelled';

/** Progress of an in-app login. The browser step happens outside Probe. */
export interface LoginState {
  phase: LoginPhase;
  /** Sign-in page to open in the browser, once the CLI has printed it. */
  url: string | null;
  /** The CLI is waiting for the code shown after sign-in. */
  needsCode: boolean;
  message: string | null;
}

export interface ClaudeAgentStatus {
  installed: boolean;
  version: string | null;
  profile: ClaudeProfile;
  /** Status for the selected profile; null when the CLI isn't installed. */
  auth: ClaudeAuth | null;
  /** Set when Probe's own profile is signed out but the system one is signed in. */
  systemAuth: ClaudeAuth | null;
  login: LoginState;
  /** What the background jobs may and may not do, shown read-only in settings. */
  allowedTools: string[];
  deniedTools: string[];
}
