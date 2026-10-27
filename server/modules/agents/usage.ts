/**
 * The last usage the CLI reported. Only background jobs (learning, sessions) produce it, as a
 * `rate_limit_event` in their stream, so it is as fresh as the last job. It is kept per profile
 * because Probe's own login and the system login can be different accounts.
 */
import { get, run } from '../../core/db.ts';
import { broadcast } from '../../core/hub.ts';
import type { ClaudeUsage, UsageWindow } from '../../../shared/models.ts';
import { getProfile } from './settings.ts';

const key = () => `agent.claude.usage.${getProfile()}`;

/** A window whose reset time has passed starts over: what was recorded no longer applies. */
const current = (w: UsageWindow | null, now: number): UsageWindow | null => (w && w.resetsAt <= now ? { utilization: 0, resetsAt: w.resetsAt } : w);

/** Show each window as of now: a stale 80% from before the last reset reads 0%, not 80%. */
export const freshUsage = (u: ClaudeUsage, now = Date.now()): ClaudeUsage => ({ ...u, fiveHour: current(u.fiveHour, now), sevenDay: current(u.sevenDay, now) });

export function getUsage(): ClaudeUsage | null {
  const raw = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key())?.value;
  if (!raw) return null;
  try {
    return freshUsage(JSON.parse(raw) as ClaudeUsage);
  } catch {
    return null;
  }
}

export function recordUsage(incoming: ClaudeUsage): void {
  // An event may report one window only; keep the other from before instead of blanking it.
  const before = getUsage();
  const usage: ClaudeUsage = { ...incoming, fiveHour: incoming.fiveHour ?? before?.fiveHour ?? null, sevenDay: incoming.sevenDay ?? before?.sevenDay ?? null };
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key(), JSON.stringify(usage));
  broadcast({ type: 'agent' });
}
