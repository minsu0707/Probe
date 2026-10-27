import { useEffect, useState } from 'react';

/** Unsent text, kept per box so leaving the tab (which unmounts the page) does not lose it. */
const drafts = new Map<string, string>();
const PREFIX = 'probe:draft:';

function read(key: string): string {
  const mem = drafts.get(key);
  if (mem !== undefined) return mem;
  try {
    return localStorage.getItem(PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  drafts.set(key, value);
  try {
    if (value) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable: the in-memory copy still covers tab switches */
  }
}

/** Like useState('') but the value outlives the component. */
export function useDraft(key: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => read(key));
  useEffect(() => setValue(read(key)), [key]);
  return [value, (v) => (setValue(v), write(key, v))];
}
