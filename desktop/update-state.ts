/**
 * The update state machine, kept free of Electron so it can be tested. The updater feeds it the
 * events electron-updater emits; it returns the state the UI shows.
 */
import type { UpdateState } from '../shared/models.ts';

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'none'; at: number }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'installing'; version: string }
  | { type: 'error'; message: string };

/**
 * A release becomes visible a few minutes before its latest.yml is uploaded. A check in that gap is
 * not a failure the user can act on: the next check (every few minutes) finds it, so it stays quiet.
 */
export const isReleaseStillUploading = (message: string): boolean => /Cannot find latest\.yml/i.test(message);

export function reduceUpdate(state: UpdateState, ev: UpdateEvent): UpdateState {
  const currentVersion = state.currentVersion;
  // A downloaded update stays the answer: a later check failing (offline) must not hide it.
  if (state.phase === 'installing') return state; // nothing changes the story once the installer has started
  if (state.phase === 'ready' && ev.type !== 'downloaded' && ev.type !== 'installing') {
    // Checks go on while a downloaded update waits: if an even newer release appears, it is fetched
    // behind the ready one, so installing never lands on a version that is already out of date.
    if (ev.type === 'available' && ev.version !== state.version) return { ...state, newerVersion: ev.version };
    if (ev.type === 'error' && state.newerVersion) return { phase: 'ready', currentVersion: state.currentVersion, version: state.version };
    return state;
  }
  switch (ev.type) {
    case 'checking':
      return { phase: 'checking', currentVersion };
    case 'available':
      return { phase: 'downloading', currentVersion, version: ev.version, percent: 0 };
    case 'none':
      return { phase: 'idle', currentVersion, checkedAt: ev.at };
    case 'progress':
      return state.phase === 'downloading' ? { ...state, percent: Math.max(0, Math.min(100, Math.round(ev.percent))) } : state;
    case 'downloaded':
      return { phase: 'ready', currentVersion, version: ev.version };
    case 'installing':
      return { phase: 'installing', currentVersion, version: ev.version };
    case 'error':
      if (isReleaseStillUploading(ev.message)) return { phase: 'idle', currentVersion, checkedAt: state.phase === 'idle' ? state.checkedAt : null };
      return { phase: 'error', currentVersion, message: ev.message };
  }
}

/** electron-updater's error text can be long and technical; keep the first line for the UI. */
export const briefError = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200);
