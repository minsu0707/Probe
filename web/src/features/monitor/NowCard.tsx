import type { RunSummary } from '../../core/api.ts';
import { RUN_STATUS_LABEL, runTone } from '../../core/format.ts';
import { Pill } from '../../ui/index.ts';

const CRUMB_LABELS = ['서비스', '페이지', '기능', '화면'] as const;

/** One-sentence outcome for a finished run. */
function outcome(run: RunSummary): string {
  switch (run.status) {
    case 'passed':
      return '모든 테스트를 통과했습니다.';
    case 'failed':
      return `${run.totals.failed}개 테스트가 실패했고 결함 ${run.defects}건이 생겼습니다.`;
    case 'stopped':
      return '사용자가 실행을 중단했습니다.';
    default:
      return '테스트를 끝까지 실행하지 못했습니다. 아래 기록에서 이유를 확인하세요.';
  }
}

/** Where the test is right now (service › page › feature › screen), or the outcome once it ends. */
export function NowCard({ run, serviceName, live }: { run: RunSummary; serviceName: string; live: boolean }) {
  const c = run.current;

  if (!live) {
    return (
      <section className="panel now">
        <div className="panel-head">
          <h2>결과</h2>
          <Pill tone={runTone(run.status)}>{RUN_STATUS_LABEL[run.status]}</Pill>
        </div>
        <p className="now-test">{outcome(run)}</p>
      </section>
    );
  }

  const values = [serviceName, c.page, c.feature, c.view];
  return (
    <section className="panel now" aria-live="polite">
      <div className="panel-head">
        <h2>지금 하는 일</h2>
        <Pill tone="run" dot>
          {RUN_STATUS_LABEL[run.status]}
        </Pill>
      </div>
      <ol className="crumbs" aria-label="현재 위치">
        {CRUMB_LABELS.map((label, i) => (
          <li key={label} className={values[i] ? '' : 'crumb-empty'}>
            <span className="eyebrow">{label}</span>
            <span className="crumb-value ellipsis" title={values[i] ?? undefined}>
              {values[i] ?? '—'}
            </span>
          </li>
        ))}
      </ol>
      {c.test ? (
        <>
          <p className="now-test">{c.test.join(' › ')}</p>
          <p className="now-step muted">{c.step ?? '준비 중…'}</p>
        </>
      ) : (
        <p className="muted now-step">{run.status === 'starting' ? '브라우저를 준비하는 중…' : '다음 테스트를 기다리는 중…'}</p>
      )}
    </section>
  );
}
