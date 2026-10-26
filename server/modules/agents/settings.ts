import { get, run } from '../../core/db.ts';
import type { ClaudeProfile } from '../../../shared/models.ts';

const PROFILE_KEY = 'agent.claude.profile';

/** Probe's own profile is the default: it never depends on how Probe was started. */
export function getProfile(): ClaudeProfile {
  return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', PROFILE_KEY)?.value === 'system' ? 'system' : 'probe';
}

export function setProfile(profile: ClaudeProfile): void {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', PROFILE_KEY, profile);
}
