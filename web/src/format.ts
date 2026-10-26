export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${String(sec).padStart(2, '0')}초`;
  return `${sec}초`;
}

export function ago(ts: number, now = Date.now()): string {
  const d = Math.round((now - ts) / 1000);
  if (d < 45) return '방금';
  if (d < 3600) return `${Math.round(d / 60)}분 전`;
  if (d < 86400) return `${Math.round(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/** HH:MM:SS. en-GB gives a fixed-width 24h form; ko-KR spells out 시/분/초 and wraps. */
export const clock = (ts: number) => new Date(ts).toLocaleTimeString('en-GB');

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  starting: '시작 중',
  running: '실행 중',
  passed: '통과',
  failed: '실패',
  stopped: '중단됨',
  error: '오류',
};

export const SEVERITY_LABEL = { critical: '치명', major: '주요', minor: '경미' } as const;
export const DEFECT_STATUS_LABEL = { candidate: '확인 필요', confirmed: '확정', false_positive: '오탐', fixed: '수정됨' } as const;
