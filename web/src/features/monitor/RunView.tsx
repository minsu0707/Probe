import type { RunSummary } from '../../core/api.ts';
import { duration } from '../../core/format.ts';
import { useNow } from '../../ui/index.ts';
import { LiveFrame } from './LiveFrame.tsx';
import { NowCard } from './NowCard.tsx';
import { RunDefects } from './RunDefects.tsx';
import { Timeline } from './Timeline.tsx';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'pass' | 'fail' }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <span className={`stat-value tabular${tone ? ` tone-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

/** Counters and progress bar across the top; "now" + log on the left, browser + defects on the right. */
export function RunView({ run, serviceName }: { run: RunSummary; serviceName: string }) {
  const live = run.status === 'running' || run.status === 'starting';
  const now = useNow(1000);
  const t = run.totals;
  const done = t.passed + t.failed + t.skipped;
  const pct = (n: number) => (t.total ? (n / t.total) * 100 : 0);

  return (
    <div className="monitor">
      <section className="stats" aria-label="실행 요약">
        <Stat label="전체" value={t.total || '—'} />
        <Stat label="통과" value={t.passed} tone="pass" />
        <Stat label="실패" value={t.failed} tone={t.failed ? 'fail' : undefined} />
        <Stat label="건너뜀" value={t.skipped} />
        <Stat label="발견된 결함" value={run.defects} tone={run.defects ? 'fail' : undefined} />
        <Stat label={live ? '경과' : '소요'} value={duration((run.endedAt ?? now) - run.startedAt)} />
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={t.total} aria-valuenow={done} aria-label={`${done}/${t.total} 완료`}>
          <span className="seg seg-pass" style={{ width: `${pct(t.passed)}%` }} />
          <span className="seg seg-fail" style={{ width: `${pct(t.failed)}%` }} />
          <span className="seg seg-skip" style={{ width: `${pct(t.skipped)}%` }} />
          {live && t.running > 0 && <span className="seg seg-run" style={{ width: `${pct(t.running)}%` }} />}
        </div>
      </section>

      <div className="monitor-grid">
        <div className="stack">
          <NowCard run={run} serviceName={serviceName} live={live} />
          <Timeline runId={run.id} />
        </div>
        <div className="stack">
          <LiveFrame run={run} live={live} />
          <RunDefects runId={run.id} />
        </div>
      </div>
    </div>
  );
}
