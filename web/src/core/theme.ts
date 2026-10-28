import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'probe:theme';

const system = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

let current: Theme = saved() ?? system();
const listeners = new Set<() => void>();

const apply = (): void => {
  document.documentElement.dataset.theme = current;
};

/** Call once at startup, before the first paint, so there is no flash of the wrong theme. */
export function initTheme(): void {
  apply();
  // Until the user chooses, follow the operating system.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (saved()) return;
    current = system();
    apply();
    listeners.forEach((l) => l());
  });
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the choice just won't survive a restart */
  }
  apply();
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => current,
  );
}
