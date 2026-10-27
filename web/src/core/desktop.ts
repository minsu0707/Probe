/**
 * The bridge the desktop shell exposes to the page (desktop/preload.cjs). In a normal browser it
 * does not exist, and everything here degrades to "not the desktop app".
 */
import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/models.ts';

export type { UpdateState };

interface ProbeDesktop {
  getUpdate(): Promise<UpdateState>;
  checkForUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<boolean>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
}

const bridge = (): ProbeDesktop | undefined => (window as unknown as { probeDesktop?: ProbeDesktop }).probeDesktop;

export const isDesktopApp = (): boolean => Boolean(bridge());
export const checkForUpdate = () => bridge()?.checkForUpdate();
export const installUpdate = () => bridge()?.installUpdate();

/** Live update state; null in a plain browser or before the first answer. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let alive = true;
    void b.getUpdate().then((s) => alive && setState(s));
    const off = b.onUpdate(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
