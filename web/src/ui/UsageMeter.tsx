import type { ClaudeUsage, UsageWindow } from '../core/api.ts';

const pct = (w: UsageWindow) => Math.round(w.utilization * 100);
const resetText = (w: UsageWindow) => new Date(w.resetsAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The Claude usage windows as two small bars. The numbers come from Probe's own background jobs,
 * so they are as recent as the last job; the tooltip says when they were read.
 */
export function UsageMeter({ usage }: { usage: ClaudeUsage }) {
  const parts = [
    { label: '5시간', w: usage.fiveHour },
    { label: '7일', w: usage.sevenDay },
  ].filter((p): p is { label: string; w: UsageWindow } => p.w !== null);
  const title = [...parts.map((p) => `${p.label} 한도 ${pct(p.w)}% 사용 · ${resetText(p.w)}에 초기화`)].join('\n');

  return (
    <span className="usage" title={title}>
      {parts.map((p) => (
        <span key={p.label} className="usage-item">
          {p.label}
          <span className="usage-bar" role="meter" aria-label={`${p.label} 사용량`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(p.w)}>
            <span className={`usage-fill${p.w.utilization >= 0.9 ? ' usage-hot' : ''}`} style={{ width: `${pct(p.w)}%` }} />
          </span>
          <span className="tabular">{pct(p.w)}%</span>
        </span>
      ))}
    </span>
  );
}
