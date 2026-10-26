import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'pass' | 'fail' | 'warn' | 'run' | 'accent';

/** Small status label. `dot` adds a marker; with tone "run" the dot pulses. */
export function Pill({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`pill pill-${tone}`}>
      {dot && <span className={`dot${tone === 'run' ? ' dot-live' : ''}`} />}
      {children}
    </span>
  );
}
