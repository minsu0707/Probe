/**
 * The live connection to the server. Messages are folded into the store; if the socket
 * drops it reconnects and refetches, so a closed laptop lid never leaves stale data on screen.
 */
import type { ServerMessage } from '../../../shared/events.ts';
import { appendLog, loadDefects, patch, refreshServices, toast, loadRuns } from './store.ts';

const RECONNECT_MS = 1500;
const REFRESH_DEBOUNCE_MS = 250;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Service counters (defects, last run, learning flag) are derived on the server. Many
 * messages arrive in a burst during a run, so refetch once after the burst, not per message.
 */
function refreshSoon(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshServices().catch(() => undefined), REFRESH_DEBOUNCE_MS);
}

function bumpServiceVersion(serviceId: string): void {
  patch((s) => ({ serviceVersion: { ...s.serviceVersion, [serviceId]: (s.serviceVersion[serviceId] ?? 0) + 1 } }));
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case 'run':
      patch((s) => ({ runs: { ...s.runs, [msg.run.id]: msg.run } }));
      refreshSoon();
      break;
    case 'log':
      appendLog(msg.runId, { ts: msg.ts, kind: msg.kind, text: msg.text, status: msg.status });
      break;
    case 'frame':
      patch((s) => ({ frameTick: { ...s.frameTick, [msg.runId]: msg.ts } }));
      break;
    case 'defect':
      patch((s) => ({ defects: [msg.defect, ...s.defects.filter((d) => d.id !== msg.defect.id)] }));
      refreshSoon();
      break;
    case 'job':
      patch((s) => ({ jobs: { ...s.jobs, [msg.job.serviceId]: msg.job } }));
      refreshSoon();
      break;
    case 'service':
    case 'docs':
      bumpServiceVersion(msg.serviceId);
      refreshSoon();
      break;
  }
}

function connect(): void {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    patch(() => ({ connected: true }));
    // Anything that happened while disconnected is recovered by refetching.
    void refreshServices().catch(() => undefined);
    void loadDefects().catch(() => undefined);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    patch(() => ({ connected: false }));
    setTimeout(connect, RECONNECT_MS);
  };
}

/** Open the socket and do the first load. Called once from the app root. */
export async function boot(): Promise<void> {
  connect();
  try {
    await Promise.all([refreshServices(), loadDefects(), loadRuns()]);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
  patch(() => ({ ready: true }));
}
