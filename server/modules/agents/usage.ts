/**
 * The last usage the CLI reported. Only background jobs (learning, sessions) produce it, as a
 * `rate_limit_event` in their stream, so it is as fresh as the last job. It is kept per profile
 * because Probe's own login and the system login can be different accounts.
 */
import { get, run } from '../../core/db.ts';
import { broadcast } from '../../core/hub.ts';
import type { ClaudeUsage } from '../../../shared/models.ts';
import { getProfile } from './settings.ts';

const key = () => `agent.claude.usage.${getProfile()}`;

export function getUsage(): ClaudeUsage | null {
  const raw = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key())?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClaudeUsage;
  } catch {
    return null;
  }
}

export function recordUsage(usage: ClaudeUsage): void {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key(), JSON.stringify(usage));
  broadcast({ type: 'agent' });
}
