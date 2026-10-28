import { get, run } from '../../core/db.ts';
import { DEFAULT_PREFS, SESSION_EFFORTS, SESSION_MODELS, SESSION_MODES, type SessionPrefs } from '../../../shared/session-prefs.ts';
import { requireService } from '../services/service.ts';

const key = (serviceId: string) => `session-prefs:${serviceId}`;
const pick = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** The choice the user made last for this service. Every session of the service follows it, new ones included. */
export function getPrefs(serviceId: string): SessionPrefs {
  const raw = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key(serviceId))?.value;
  let saved: Partial<SessionPrefs> = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    /* a damaged value falls back to the defaults */
  }
  return { mode: pick(SESSION_MODES, saved.mode, DEFAULT_PREFS.mode), model: pick(SESSION_MODELS, saved.model, DEFAULT_PREFS.model), effort: pick(SESSION_EFFORTS, saved.effort, DEFAULT_PREFS.effort) };
}

export function setPrefs(serviceId: string, change: Partial<SessionPrefs>): SessionPrefs {
  requireService(serviceId);
  const next = { ...getPrefs(serviceId), ...change };
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key(serviceId), JSON.stringify(next));
  return next;
}
