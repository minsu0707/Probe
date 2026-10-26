import { useSyncExternalStore } from 'react';
import type { ServerMessage } from '../../server/types.ts';
import { api, type Defect, type Job, type LogLine, type RunSummary, type ServiceOverview } from './api.ts';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

interface State {
  ready: boolean;
  connected: boolean;
  services: ServiceOverview[];
  currentId: string | null;
  runs: Record<string, RunSummary>;
  logs: Record<string, LogLine[]>;
  defects: Defect[];
  jobs: Record<string, Job>;
  frameTick: Record<string, number>;
  /** Bumped when a service's env/docs/knowledge changed so open pages refetch. */
  serviceVersion: Record<string, number>;
  toasts: Toast[];
}

let state: State = { ready: false, connected: false, services: [], currentId: null, runs: {}, logs: {}, defects: [], jobs: {}, frameTick: {}, serviceVersion: {}, toasts: [] };
const listeners = new Set<() => void>();

const set = (fn: (s: State) => Partial<State>) => {
  state = { ...state, ...fn(state) };
  listeners.forEach((l) => l());
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => select(state),
  );
}

export const getState = () => state;

const STORAGE_KEY = 'probe.currentService';
const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- toasts
let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
}

/** Run an action and surface its error as a toast instead of an unhandled rejection. */
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

// ------------------------------------------------------------ data loads
export async function refreshServices() {
  const services = await api.services();
  set((s) => {
    const stored = s.currentId ?? readStored();
    const currentId = services.some((x) => x.id === stored) ? stored : (services[0]?.id ?? null);
    return { services, currentId };
  });
}

export async function loadDefects() {
  const defects = await api.defects();
  set(() => ({ defects }));
}

export function selectService(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage can be blocked; the choice just won't persist */
  }
  set(() => ({ currentId: id }));
}

const pendingLog: Record<string, LogLine[]> = {};

export async function loadRun(id: string) {
  pendingLog[id] = [];
  const { run, log } = await api.run(id);
  const lastTs = log.at(-1)?.ts ?? 0;
  const queued = (pendingLog[id] ?? []).filter((l) => l.ts > lastTs);
  delete pendingLog[id];
  set((s) => ({ runs: { ...s.runs, [id]: run }, logs: { ...s.logs, [id]: [...log, ...queued] } }));
}

export async function loadRuns(serviceId?: string) {
  const list = await api.runs(serviceId);
  set((s) => ({ runs: { ...s.runs, ...Object.fromEntries(list.map((r) => [r.id, r])) } }));
}

// ------------------------------------------------------------- websocket
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const refreshSoon = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshServices().catch(() => undefined), 250);
};

function onMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'run':
      set((s) => ({ runs: { ...s.runs, [msg.run.id]: msg.run } }));
      refreshSoon();
      break;
    case 'log': {
      const line: LogLine = { ts: msg.ts, kind: msg.kind, text: msg.text, status: msg.status };
      if (msg.runId in pendingLog) pendingLog[msg.runId].push(line);
      else set((s) => ({ logs: { ...s.logs, [msg.runId]: [...(s.logs[msg.runId] ?? []), line].slice(-3000) } }));
      break;
    }
    case 'frame':
      set((s) => ({ frameTick: { ...s.frameTick, [msg.runId]: msg.ts } }));
      break;
    case 'defect':
      set((s) => ({ defects: [msg.defect, ...s.defects.filter((d) => d.id !== msg.defect.id)] }));
      refreshSoon();
      break;
    case 'job':
      set((s) => ({ jobs: { ...s.jobs, [msg.job.serviceId]: msg.job } }));
      refreshSoon();
      break;
    case 'service':
    case 'docs':
      set((s) => ({ serviceVersion: { ...s.serviceVersion, [msg.serviceId]: (s.serviceVersion[msg.serviceId] ?? 0) + 1 } }));
      refreshSoon();
      break;
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    set(() => ({ connected: true }));
    // Anything missed while disconnected is recovered by refetching.
    void refreshServices().catch(() => undefined);
    void loadDefects().catch(() => undefined);
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    set(() => ({ connected: false }));
    setTimeout(connect, 1500);
  };
}

export async function boot() {
  connect();
  try {
    await Promise.all([refreshServices(), loadDefects(), loadRuns()]);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
  set(() => ({ ready: true }));
}
