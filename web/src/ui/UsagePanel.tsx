import type { ClaudeUsage, UsageWindow } from '../core/api.ts';
import { ago } from '../core/format.ts';
import { useNow } from './hooks.ts';

/** "2시간 9분", "1일 22시간", "9분": how long until a limit window resets. */
export function untilReset(resetsAt: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((resetsAt - now) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  return `${m}분`;
}

const clockAt = (ts: number): string => new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function Row({ label, hint, w, now }: { label: string; hint: string; w: UsageWindow; now: number }) {
  const pct = Math.round(w.utilization * 100);
  const passed = w.resetsAt <= now;
  return (
    <div className="usage-row" title={`${clockAt(w.resetsAt)}에 초기화`}>
      <div className="usage-row-head">
        <strong>{label}</strong>
        <span className="muted small">{hint}</span>
      </div>
      <div className="usage-track" role="meter" aria-label={`${label} 사용량`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className={`usage-fill${w.utilization >= 0.9 ? ' usage-hot' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="usage-row-foot muted small">
        <span className="tabular">{pct}% 사용</span>
        <span className="tabular">{passed ? '초기화됨' : `${untilReset(w.resetsAt, now)} 후 초기화`}</span>
      </div>
    </div>
  );
}

/** Both Claude limit windows with a countdown to their reset, in the shape Orca shows them. */
export function UsagePanel({ usage }: { usage: ClaudeUsage }) {
  const now = useNow(30_000);
  return (
    <div className="usage-panel">
      {usage.fiveHour && <Row label="세션" hint="5시간 한도" w={usage.fiveHour} now={now} />}
      {usage.sevenDay && <Row label="주간" hint="7일 한도" w={usage.sevenDay} now={now} />}
      <p className="muted small">{ago(usage.at, now)} 업데이트 · 새로고침 버튼으로 다시 읽을 수 있습니다</p>
    </div>
  );
}
