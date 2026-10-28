import { useEffect } from 'react';
import { api, type ServiceOverview } from '../../core/api.ts';
import { ago, RUN_STATUS_LABEL, runTone } from '../../core/format.ts';
import { runButtonProps } from '../../core/runGuard.ts';
import { attempt, loadRuns, useStore } from '../../core/store.ts';
import { goService, type Tab } from '../../app/router.ts';
import { Icon, Pill, useNow, type IconName } from '../../ui/index.ts';

const pct = (n: number, total: number): number => (total ? (n / total) * 100 : 0);

/** The right-hand side of 개요: how the service stands right now and where to go next. */
export function ServiceAside({ service }: { service: ServiceOverview }) {
  const runs = useStore((s) => s.runs);
  const now = useNow(30_000);
  useEffect(() => void loadRuns(service.id).catch(() => undefined), [service.id]);

  const mine = Object.values(runs)
    .filter((r) => r.serviceId === service.id)
    .sort((a, b) => b.startedAt - a.startedAt);
  const last = service.activeRun ?? mine[0] ?? service.lastRun;
  const running = Boolean(service.activeRun);
  const t = last?.totals;
  const decided = t ? t.passed + t.failed : 0;

  const start = async () => {
    if (await attempt(() => api.startRun(service.id))) goService(service.id, 'monitor');
  };

  return (
    <aside className="stack overview-aside" aria-label="서비스 현황">
      <section className="panel">
        <div className="panel-head">
          <h2>마지막 실행</h2>
          {last && (
            <Pill tone={runTone(last.status)} dot={running}>
              {RUN_STATUS_LABEL[last.status]}
            </Pill>
          )}
        </div>
        {last && t ? (
          <>
            <div className="ov-rate">
              <span className={`ov-rate-num tabular tone-${last.status === 'passed' ? 'pass' : t.failed ? 'fail' : ''}`}>{decided ? `${Math.round(pct(t.passed, decided))}%` : '—'}</span>
              <span className="muted small">통과율 · {ago(last.startedAt, now)}</span>
            </div>
            <div className="progress ov-bar" aria-hidden="true">
              <span className="seg seg-pass" style={{ width: `${pct(t.passed, t.total)}%` }} />
              <span className="seg seg-fail" style={{ width: `${pct(t.failed, t.total)}%` }} />
              <span className="seg seg-skip" style={{ width: `${pct(t.skipped, t.total)}%` }} />
            </div>
            <dl className="ov-figures">
              <div>
                <dt>통과</dt>
                <dd className="tone-pass tabular">{t.passed}</dd>
              </div>
              <div>
                <dt>실패</dt>
                <dd className={`tabular${t.failed ? ' tone-fail' : ''}`}>{t.failed}</dd>
              </div>
              <div>
                <dt>건너뜀</dt>
                <dd className="tabular">{t.skipped}</dd>
              </div>
              <div>
                <dt>결함</dt>
                <dd className={`tabular${last.defects ? ' tone-fail' : ''}`}>{last.defects}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="muted small">아직 실행한 테스트가 없습니다. 아래 버튼으로 처음 실행해 보세요.</p>
        )}
        <div className="actions">
          <button className="btn btn-primary btn-sm" disabled={running} {...runButtonProps(service, start, running ? '다른 실행이 진행 중입니다' : undefined)}>
            <Icon name="play" size={12} />
            테스트 실행
          </button>
          {last && (
            <button className="btn btn-sm" onClick={() => goService(service.id, 'monitor')}>
              모니터링 보기
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>준비 상태</h2>
        </div>
        <ul className="ov-checks">
          <Check icon="lock" label="환경 변수" value={`${service.secretCount}개`} ok={service.secretCount > 0} to="overview" />
          <Check icon="file" label="올린 문서" value={service.unlearnedDocs ? `${service.docCount}개 · 새 ${service.unlearnedDocs}개` : `${service.docCount}개`} ok={service.docCount > 0 && service.unlearnedDocs === 0} to="learn" id={service.id} />
          <Check icon="learn" label="지식 문서" value={service.learning ? '학습 중…' : `${service.knowledgeCount}개`} ok={service.knowledgeCount > 0} to="learn" id={service.id} />
          <Check icon="results" label="열린 결함" value={`${service.openDefects}건`} ok={service.openDefects === 0} to="results" id={service.id} />
        </ul>
      </section>

      {mine.length > 0 && (
        <section className="panel ov-recent">
          <div className="panel-head">
            <h2>최근 실행</h2>
            <span className="muted small">{mine.length}건</span>
          </div>
          <ol className="ov-runs">
            {mine.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button onClick={() => goService(service.id, 'monitor')}>
                  <span className={`dot ov-dot-${runTone(r.status)}`} aria-hidden="true" />
                  <span className="ov-run-main">
                    <span>{RUN_STATUS_LABEL[r.status]}</span>
                    <span className="muted small tabular">
                      {r.totals.passed}/{r.totals.passed + r.totals.failed}
                    </span>
                  </span>
                  <span className="muted small">{ago(r.startedAt, now)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="panel ov-shortcuts">
        <div className="panel-head">
          <h2>바로가기</h2>
        </div>
        <div className="ov-links">
          <Shortcut icon="edit" label="Claude 세션에서 테스트 쓰기" to="sessions" id={service.id} />
          <Shortcut icon="learn" label="문서 올리고 학습하기" to="learn" id={service.id} />
          <Shortcut icon="check" label="테스트 케이스 고르기" to="cases" id={service.id} />
        </div>
      </section>
    </aside>
  );
}

function Check({ icon, label, value, ok, to, id }: { icon: IconName; label: string; value: string; ok: boolean; to: Tab; id?: string }) {
  const body = (
    <>
      <Icon name={icon} size={15} />
      <span className="ov-check-label">{label}</span>
      <span className={`ov-check-value${ok ? '' : ' ov-check-warn'}`}>{value}</span>
    </>
  );
  return <li>{id ? <button onClick={() => goService(id, to)}>{body}</button> : <div className="ov-static">{body}</div>}</li>;
}

function Shortcut({ icon, label, to, id }: { icon: IconName; label: string; to: Tab; id: string }) {
  return (
    <button className="ov-link" onClick={() => goService(id, to)}>
      <Icon name={icon} size={15} />
      {label}
      <Icon name="chevron" size={13} />
    </button>
  );
}
