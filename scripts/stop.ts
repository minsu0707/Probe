/**
 * Stop the Probe server. Refuses while a test run or learning job is active, so work isn't
 * lost by accident; add --force to stop anyway.
 */
import { BASE_URL, portStatus } from './ensure-server.ts';

const force = process.argv.includes('--force');

if ((await portStatus()) !== 'probe') {
  console.log('Probe is not running.');
  process.exit(0);
}

const res = await fetch(`${BASE_URL}/api/shutdown${force ? '?force=1' : ''}`, { method: 'POST' });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error((body as { error?: string }).error ?? `Could not stop Probe (HTTP ${res.status}).`);
  process.exit(1);
}
console.log('Probe stopped.');
