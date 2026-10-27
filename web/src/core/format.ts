/** Display formatting and Korean labels. No React, no state. */
import type { DefectCause, DefectStatus, RunStatus, Severity } from '../../../shared/models.ts';

/** 125000 → "2분 05초". Used for elapsed and total times. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${String(sec).padStart(2, '0')}초`;
  return `${sec}초`;
}

/** Relative time ("3분 전"); falls back to a date after a week. `now` is injectable for tests. */
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

/** "10. 26. 16:46"-style start time for run lists and pickers. */
export const startTime = (ts: number) => new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  starting: '시작 중',
  running: '실행 중',
  passed: '통과',
  failed: '실패',
  stopped: '중단됨',
  error: '오류',
};

export const CAUSE_LABEL: Record<DefectCause, string> = { test: '테스트 문제 의심', app: '앱 동작 의심', env: '환경 문제 의심', unknown: '원인 불명' };
export const CAUSE_HINT: Record<DefectCause, string> = {
  test: '위치를 못 찾았거나 여러 개로 잡혔거나 기다리다 시간이 끝났습니다. 선택자나 기다림이 잘못됐을 가능성이 큽니다.',
  app: '화면은 응답했지만 기대한 값과 다르게 나왔습니다. 문서와 실제 중 어느 쪽이 맞는지 확인해 볼 만합니다.',
  env: '브라우저나 네트워크 문제, 또는 조회 전용으로 막은 쓰기 요청입니다.',
  unknown: '오류 문구만으로는 구분하지 못했습니다.',
};
export const SEVERITY_LABEL: Record<Severity, string> = { critical: '치명', major: '주요', minor: '경미' };
export const DEFECT_STATUS_LABEL: Record<DefectStatus, string> = { candidate: '확인 필요', confirmed: '확정', false_positive: '오탐', fixed: '수정됨' };

/** Pill colour for a run's status. */
export const runTone = (status: RunStatus): 'pass' | 'fail' | 'run' | 'neutral' => (status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : status === 'running' || status === 'starting' ? 'run' : 'neutral');

/** Pill colour for a defect's severity. */
export const severityTone = (s: Severity): 'fail' | 'warn' | 'neutral' => (s === 'critical' ? 'fail' : s === 'major' ? 'warn' : 'neutral');
