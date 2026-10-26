import type { IngestEvent } from '../shared/events.ts';

const api = process.env.PROBE_API;
const runId = process.env.PROBE_RUN_ID;
const token = process.env.PROBE_TOKEN ?? '';

/** True when a dashboard started this run. Outside it, everything below is a no-op. */
export const connected = Boolean(api && runId);

let chain: Promise<unknown> = Promise.resolve();

/** Posts events in order. Failures are swallowed: a dead dashboard must never fail a test. */
export function send(events: IngestEvent[]): Promise<unknown> {
  if (!connected) return Promise.resolve();
  chain = chain.then(() =>
    fetch(`${api}/api/ingest/${runId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-probe-token': token },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined),
  );
  return chain;
}

export function sendFrame(jpeg: Buffer): Promise<unknown> {
  if (!connected) return Promise.resolve();
  return fetch(`${api}/api/ingest/${runId}/frame`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-probe-token': token },
    body: new Uint8Array(jpeg),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}
