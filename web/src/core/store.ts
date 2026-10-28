/**
 * Client state. One small observable store instead of a state library: the data is a handful
 * of lists that the server pushes over a WebSocket (see socket.ts), plus the user's current
 * service. Components read it with `useStore(selector)`.
 *
 * Selectors must return values that are stable between calls (a slice of state, not a freshly
 * built array), otherwise React re-renders forever.
 */
import { useSyncExternalStore } from 'react';
import { api } from './api.ts';
import type { ClaudeAgentStatus, Defect, Job, LogLine, QueuedMessage, RunSummary, ServiceOverview, Session, SessionMessage } from './api.ts';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export interface State {
  /** First load finished (successfully or not). */
  ready: boolean;
  /** WebSocket is open. */
  connected: boolean;
  services: ServiceOverview[];
  currentId: string | null;
  runs: Record<string, RunSummary>;
  logs: Record<string, LogLine[]>;
  defects: Defect[];
  /** Latest learning job per service. */
  jobs: Record<string, Job>;
  /** Timestamp of the newest live frame per run; changing it makes the <img> reload. */
  frameTick: Record<string, number>;
  /** Bumped when a service's env/docs/knowledge changed, so open pages refetch their own data. */
  serviceVersion: Record<string, number>;
  /** Claude CLI install and sign-in state; null until first fetched. */
  claude: ClaudeAgentStatus | null;
  /** Claude sessions per service, newest activity first. */
  sessions: Record<string, Session[]>;
  /** Transcript per session. */
  transcripts: Record<string, SessionMessage[]>;
  /** Messages waiting for Claude to be free, per session. */
  queues: Record<string, QueuedMessage[]>;
  toasts: Toast[];
}

let state: State = { ready: false, connected: false, services: [], currentId: null, runs: {}, logs: {}, defects: [], jobs: {}, frameTick: {}, serviceVersion: {}, claude: null, sessions: {}, transcripts: {}, queues: {}, toasts: [] };
const listeners = new Set<() => void>();

export const getState = (): State => state;

/** Merge a change into state and notify subscribers. */
export function patch(fn: (s: State) => Partial<State>): void {
  state = { ...state, ...fn(state) };
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => select(state),
  );
}

// ---------------------------------------------------------------- toasts

let toastSeq = 0;

export function toast(text: string, kind: Toast['kind'] = 'ok'): void {
  const id = ++toastSeq;
  patch((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => patch((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
}

/** Run an action; show its error as a toast (and return undefined) instead of leaking a rejection. */
export async function attempt<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> {
  try {
    const out = await fn();
    if (okText) toast(okText);
    return out;
  } catch (e) {
    toast((e as Error).message, 'error');
    return undefined;
  }
}

// -------------------------------------------------------- current service

const STORAGE_KEY = 'probe.currentService';

const remembered = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked; the choice just won't persist
  }
};

export function selectService(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* see remembered() */
  }
  patch(() => ({ currentId: id }));
}

// ----------------------------------------------------------------- loads

/** Reload services, keeping the current selection if it still exists (else the first one). */
export async function refreshServices(): Promise<void> {
  const services = await api.services();
  patch((s) => {
    const wanted = s.currentId ?? remembered();
    return { services, currentId: services.some((x) => x.id === wanted) ? wanted : (services[0]?.id ?? null) };
  });
}

/** Re-read the Claude CLI state (runs the CLI, so it takes a moment). Failure keeps the old value. */
export async function refreshClaude(): Promise<void> {
  const claude = await api.claude();
  patch(() => ({ claude }));
}

/** Ask for the plan's current usage (the status bar's refresh button). */
export async function refreshUsage(): Promise<void> {
  const claude = await api.refreshClaudeUsage();
  patch(() => ({ claude }));
}

export async function loadDefects(): Promise<void> {
  const defects = await api.defects();
  patch(() => ({ defects }));
}

export async function loadRuns(serviceId?: string): Promise<void> {
  const list = await api.runs(serviceId);
  patch((s) => ({ runs: { ...s.runs, ...Object.fromEntries(list.map((r) => [r.id, r])) } }));
}

// Log lines can arrive over the WebSocket while the full log is still being fetched.
// They wait here, then only the ones newer than the fetched log are appended, so nothing
// is shown twice or lost.
const pendingLog: Record<string, LogLine[]> = {};

export async function loadRun(id: string): Promise<void> {
  pendingLog[id] = [];
  const { run, log } = await api.run(id);
  const lastTs = log.at(-1)?.ts ?? 0;
  const queued = (pendingLog[id] ?? []).filter((l) => l.ts > lastTs);
  delete pendingLog[id];
  patch((s) => ({ runs: { ...s.runs, [id]: run }, logs: { ...s.logs, [id]: [...log, ...queued] } }));
}

const MAX_LOG_LINES = 3000;

export function appendLog(runId: string, line: LogLine): void {
  if (runId in pendingLog) pendingLog[runId].push(line);
  else patch((s) => ({ logs: { ...s.logs, [runId]: [...(s.logs[runId] ?? []), line].slice(-MAX_LOG_LINES) } }));
}

// -------------------------------------------------------------- sessions

export async function loadSessions(serviceId: string): Promise<void> {
  const list = await api.sessions(serviceId);
  patch((s) => ({ sessions: { ...s.sessions, [serviceId]: list } }));
}

/** Insert or replace a session and keep the list ordered by last activity. */
export function upsertSession(session: Session): void {
  patch((s) => {
    const rest = (s.sessions[session.serviceId] ?? []).filter((x) => x.id !== session.id);
    return { sessions: { ...s.sessions, [session.serviceId]: [session, ...rest].sort((a, b) => b.updatedAt - a.updatedAt) } };
  });
}

export function removeRuns(ids: string[]): void {
  patch((s) => {
    const gone = new Set(ids);
    const keep = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([id]) => !gone.has(id)));
    return { runs: keep(s.runs), logs: keep(s.logs) };
  });
}

export function removeSession(serviceId: string, sessionId: string): void {
  patch((s) => {
    const { [sessionId]: _gone, ...transcripts } = s.transcripts;
    return { sessions: { ...s.sessions, [serviceId]: (s.sessions[serviceId] ?? []).filter((x) => x.id !== sessionId) }, transcripts };
  });
}

/** Messages are keyed by id, so one that arrives over the socket while the transcript is being fetched is not doubled. */
export function addTranscript(sessionId: string, messages: SessionMessage[]): void {
  patch((s) => {
    const known = new Map((s.transcripts[sessionId] ?? []).map((m) => [m.id, m]));
    for (const m of messages) known.set(m.id, m);
    return { transcripts: { ...s.transcripts, [sessionId]: [...known.values()].sort((a, b) => a.id - b.id) } };
  });
}

export async function loadTranscript(sessionId: string): Promise<void> {
  const { session, messages, queue } = await api.session(sessionId);
  upsertSession(session);
  addTranscript(sessionId, messages);
  setQueue(sessionId, queue);
}

export function setQueue(sessionId: string, queue: QueuedMessage[]): void {
  patch((s) => ({ queues: { ...s.queues, [sessionId]: queue } }));
}
