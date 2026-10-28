import { useEffect, useState } from 'react';
import { Logo } from './Icon.tsx';

/**
 * A waiting screen with something to look at: a radar sweep around the Probe mark, a status line
 * that changes while it works, a tip, and a count of the seconds so a slow load reads as "working",
 * not "stuck". The skeleton rows hint at what is about to appear.
 */
export function Loading({ steps, tips = [], rows = 3 }: { steps: string[]; tips?: string[]; rows?: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const step = steps[Math.min(steps.length - 1, Math.floor(tick / 2))];
  const tip = tips.length ? tips[Math.floor(tick / 5) % tips.length] : null;

  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="radar" aria-hidden="true">
        <span className="radar-ring" />
        <span className="radar-ring" />
        <span className="radar-ring" />
        <span className="radar-sweep" />
        <span className="radar-core">
          <Logo />
        </span>
      </div>
      <p className="loading-step" key={step}>
        {step}
      </p>
      <p className="loading-meta muted small tabular">{tick < 3 ? ' ' : `${tick}초째 확인하는 중`}</p>
      {tip && (
        <p className="loading-tip small" key={tip}>
          <b>TIP</b> {tip}
        </p>
      )}
      <div className="skeletons" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ animationDelay: `${i * 0.18}s` }}>
            <span className="skel skel-box" />
            <span className="skel skel-line" style={{ width: `${70 - i * 12}%` }} />
            <span className="skel skel-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}
