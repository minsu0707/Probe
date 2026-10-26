import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type LogLine, type RunSummary } from '../api.ts';
import { RUN_STATUS_LABEL, SEVERITY_LABEL, clock, duration } from '../format.ts';
import { attempt, loadRun, loadRuns, useStore } from '../store.ts';
import { Empty, Icon, Pill, useNow } from '../ui.tsx';

export function MonitorPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const runs = useStore((s) => s.runs);
  if (!service) return <Empty title="서비스를 먼저 등록하세요">서비스를 등록하면 이곳에서 테스트 진행 상황을 볼 수 있습니다.</Empty>;
  const mine = Object.values(runs)
    .filter((r) => r.serviceId === service.id)
    .sort((a, b) => b.startedAt - a.startedAt);
  return <MonitorBody key={service.id} serviceId={service.id} serviceName={service.name} runs={mine} />;
}

function MonitorBody({ serviceId, serviceName, runs }: { serviceId: string; serviceName: string; runs: RunSummary[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const activeId = runs.find((r) => r.status === 'running' || r.status === 'starting')?.id;
  // Follow a new live run automatically unless the user chose an older one on purpose.
  const [pinned, setPinned] = useState(false);
  const runId = pinned && picked ? picked : (activeId ?? picked ?? runs[0]?.id ?? null);
  const run = runs.find((r) => r.id === runId);

  useEffect(() => void loadRuns(serviceId).catch(() => undefined), [serviceId]);
  useEffect(() => {
    if (runId) void loadRun(runId).catch(() => undefined);
  }, [runId]);

  if (!run)
    return (
      <>
        <div className="page-head">
          <div>
            <h1>실시간 모니터링</h1>
            <p className="muted">테스트가 실행되면 어떤 페이지와 기능을 보고 있는지 여기에 실시간으로 표시됩니다.</p>
          </div>
        </div>
        <Empty
          title="아직 실행한 테스트가 없습니다"
          action={
            <button className="btn btn-primary" onClick={() => void attempt(() => api.startRun(serviceId))}>
              <Icon name="play" size={14} />
              테스트 실행
            </button>
          }
        >
          {serviceName}에 대한 테스트 코드는 Claude가 작성합니다. Claude에게 “{serviceName} 테스트해줘”라고 요청하거나, 작성된 테스트가 있으면 위 버튼으로 바로 실행하세요.
        </Empty>
      </>
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>실시간 모니터링</h1>
          <p className="muted">{run.title}</p>
        </div>
        <label className="run-picker">
          <span className="eyebrow">실행 기록</span>
          <select
            value={run.id}
            onChange={(e) => {
              setPicked(e.target.value);
              setPinned(true);
            }}
          >
            {runs.slice(0, 30).map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} · {RUN_STATUS_LABEL[r.status]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <RunView run={run} serviceName={serviceName} />
    </>
  );
}

function RunView({ run, serviceName }: { run: RunSummary; serviceName: string }) {
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

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'pass' | 'fail' }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <span className={`stat-value tabular${tone ? ` tone-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function NowCard({ run, serviceName, live }: { run: RunSummary; serviceName: string; live: boolean }) {
  const c = run.current;
  if (!live) {
    return (
      <section className="panel now">
        <div className="panel-head">
          <h2>결과</h2>
          <Pill tone={run.status === 'passed' ? 'pass' : run.status === 'failed' ? 'fail' : 'neutral'}>{RUN_STATUS_LABEL[run.status]}</Pill>
        </div>
        <p className="now-test">
          {run.status === 'passed' && '모든 테스트를 통과했습니다.'}
          {run.status === 'failed' && `${run.totals.failed}개 테스트가 실패했고 결함 ${run.defects}건이 생겼습니다.`}
          {run.status === 'stopped' && '사용자가 실행을 중단했습니다.'}
          {run.status === 'error' && '테스트를 끝까지 실행하지 못했습니다. 아래 기록에서 이유를 확인하세요.'}
        </p>
      </section>
    );
  }
  const crumbs = [serviceName, c.page, c.feature, c.view].filter(Boolean) as string[];
  return (
    <section className="panel now" aria-live="polite">
      <div className="panel-head">
        <h2>지금 하는 일</h2>
        <Pill tone="run" dot>
          {RUN_STATUS_LABEL[run.status]}
        </Pill>
      </div>
      <ol className="crumbs" aria-label="현재 위치">
        {['서비스', '페이지', '기능', '화면'].map((label, i) => {
          const value = [serviceName, c.page, c.feature, c.view][i];
          return (
            <li key={label} className={value ? '' : 'crumb-empty'}>
              <span className="eyebrow">{label}</span>
              <span className="crumb-value ellipsis" title={value ?? undefined}>
                {value ?? '—'}
              </span>
            </li>
          );
        })}
      </ol>
      {crumbs.length > 0 && c.test ? (
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

const MARK: Record<string, string> = { test: '▸', step: '·', page: '→', view: '◇', result: '', system: '!' };

function Timeline({ runId }: { runId: string }) {
  const lines = useStore((s) => s.logs[runId]);
  const [showSteps, setShowSteps] = useState(false);
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const shown = useMemo(() => (lines ?? []).filter((l) => showSteps || l.kind !== 'step'), [lines, showSteps]);

  useEffect(() => {
    if (stick.current) box.current?.scrollTo({ top: box.current.scrollHeight });
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
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
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

function LogRow({ line }: { line: LogLine }) {
  const resultTone = line.kind === 'result' ? (line.status === 'passed' ? 'pass' : line.status === 'skipped' ? 'skip' : 'fail') : undefined;
  const mark = line.kind === 'result' ? (line.status === 'passed' ? '✓' : line.status === 'skipped' ? '–' : '✕') : MARK[line.kind];
  return (
    <li className={`log-row log-${line.kind}${resultTone ? ` log-${resultTone}` : ''}`}>
      <time className="tabular">{clock(line.ts)}</time>
      <span className="log-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="log-text">{line.text}</span>
    </li>
  );
}

function LiveFrame({ run, live }: { run: RunSummary; live: boolean }) {
  const tick = useStore((s) => s.frameTick[run.id]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tick]);
  return (
    <section className="panel frame-panel">
      <div className="panel-head">
        <h2>브라우저 화면</h2>
        {live && tick && !failed && <Pill tone="run" dot>라이브</Pill>}
      </div>
      <div className="frame">
        {live && tick && !failed ? (
          <img src={`/api/runs/${run.id}/live.jpg?t=${tick}`} alt="테스트 브라우저의 현재 화면" onError={() => setFailed(true)} />
        ) : (
          <div className="frame-empty muted small">{live ? '첫 화면을 기다리는 중…' : '실행이 끝나서 라이브 화면이 없습니다. 실패한 테스트의 화면은 결과 · 결함에서 볼 수 있습니다.'}</div>
        )}
      </div>
    </section>
  );
}

function RunDefects({ runId }: { runId: string }) {
  const defects = useStore((s) => s.defects).filter((d) => d.runId === runId);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>이번 실행의 결함</h2>
        <span className="muted small tabular">{defects.length}건</span>
      </div>
      {defects.length === 0 ? (
        <p className="muted small">아직 발견된 결함이 없습니다.</p>
      ) : (
        <ul className="mini-defects">
          {defects.map((d) => (
            <li key={d.id}>
              <Pill tone={d.severity === 'critical' ? 'fail' : d.severity === 'major' ? 'warn' : 'neutral'}>{SEVERITY_LABEL[d.severity]}</Pill>
              <div className="mini-main">
                <span className="ellipsis">{d.title}</span>
                <span className="muted small ellipsis">
                  {[d.feature, d.page].filter(Boolean).join(' · ')}
                </span>
              </div>
              {d.occurrences > 1 && <span className="muted small tabular">×{d.occurrences}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
