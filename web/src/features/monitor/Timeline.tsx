import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../core/store.ts';
import { LogRow } from './LogRow.tsx';

/** 진행 기록: the run's log, following the newest line until the user scrolls up. */
export function Timeline({ runId }: { runId: string }) {
  const lines = useStore((s) => s.logs[runId]);
  const [showSteps, setShowSteps] = useState(false);
  const box = useRef<HTMLOListElement>(null);
  /** False once the user scrolls away from the bottom, so new lines don't yank them back. */
  const following = useRef(true);
  // Individual actions (click, fill…) are noisy; they're opt-in.
  const shown = useMemo(() => (lines ?? []).filter((l) => showSteps || l.kind !== 'step'), [lines, showSteps]);

  useEffect(() => {
    if (following.current) box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [shown.length]);

  return (
    <section className="panel timeline">
      <div className="panel-head">
        <h2>진행 기록</h2>
        <label className="check">
          <input type="checkbox" checked={showSteps} onChange={(e) => setShowSteps(e.target.checked)} />
          동작 단계 보기
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="muted small">{lines === undefined ? '불러오는 중…' : '기록이 아직 없습니다.'}</p>
      ) : (
        <ol
          className="log"
          ref={box}
          tabIndex={0}
          aria-label="진행 기록"
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {shown.map((l, i) => (
            <LogRow key={i} line={l} />
          ))}
        </ol>
      )}
    </section>
  );
}
