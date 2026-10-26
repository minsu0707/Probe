import { useEffect, useState } from 'react';
import { api, type Defect, type LogLine, type RunSummary } from '../api.ts';
import { DEFECT_STATUS_LABEL, RUN_STATUS_LABEL, SEVERITY_LABEL, ago, clock, duration } from '../format.ts';
import { attempt, loadRuns, useStore } from '../store.ts';
import { Empty, Icon, Pill, useNow } from '../ui.tsx';

type Tab = 'defects' | 'runs';
type Filter = 'open' | Defect['status'] | 'all';

export function ResultsPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const [tab, setTab] = useState<Tab>('defects');
  if (!service) return <Empty title="서비스를 먼저 등록하세요">테스트 결과와 결함은 서비스별로 모입니다.</Empty>;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>결과 · 결함</h1>
          <p className="muted">{service.name}의 실행 기록과 발견된 결함입니다.</p>
        </div>
        <div className="seg-control" role="tablist">
          <button role="tab" aria-selected={tab === 'defects'} className={tab === 'defects' ? 'on' : ''} onClick={() => setTab('defects')}>
            결함
          </button>
          <button role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'on' : ''} onClick={() => setTab('runs')}>
            실행 기록
          </button>
        </div>
      </div>
      {tab === 'defects' ? <DefectList serviceId={service.id} /> : <RunList serviceId={service.id} />}
    </>
  );
}

function DefectList({ serviceId }: { serviceId: string }) {
  const all = useStore((s) => s.defects).filter((d) => d.serviceId === serviceId);
  const [filter, setFilter] = useState<Filter>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(30_000);
  const matches = (d: Defect) => (filter === 'all' ? true : filter === 'open' ? d.status === 'candidate' || d.status === 'confirmed' : d.status === filter);
  const list = all.filter(matches);
  const count = (f: Filter) => all.filter((d) => (f === 'all' ? true : f === 'open' ? d.status === 'candidate' || d.status === 'confirmed' : d.status === f)).length;
  const filters: [Filter, string][] = [
    ['open', '열린 결함'],
    ['candidate', '확인 필요'],
    ['confirmed', '확정'],
    ['fixed', '수정됨'],
    ['false_positive', '오탐'],
    ['all', '전체'],
  ];

  return (
    <>
      <div className="filters" role="group" aria-label="결함 필터">
        {filters.map(([f, label]) => (
          <button key={f} className={`filter${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} <span className="tabular">{count(f)}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title={all.length === 0 ? '아직 발견된 결함이 없습니다' : '이 조건의 결함이 없습니다'}>
          {all.length === 0 && '테스트가 실패하면 결함 후보가 자동으로 만들어지고, 같은 원인으로 실패하면 한 건으로 묶여 횟수만 올라갑니다.'}
        </Empty>
      ) : (
        <ul className="defects">
          {list.map((d) => (
            <DefectRow key={d.id} defect={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

function DefectRow({ defect: d, open, onToggle, now }: { defect: Defect; open: boolean; onToggle: () => void; now: number }) {
  const set = (patch: Parameters<typeof api.updateDefect>[1]) => void attempt(() => api.updateDefect(d.id, patch));
  const done = d.status === 'fixed' || d.status === 'false_positive';
  return (
    <li className={`defect sev-${d.severity}${done ? ' defect-done' : ''}`}>
      <button className="defect-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron" size={16} />
        <span className="defect-title">{d.title}</span>
        <span className="defect-meta">
          <Pill tone={d.severity === 'critical' ? 'fail' : d.severity === 'major' ? 'warn' : 'neutral'}>{SEVERITY_LABEL[d.severity]}</Pill>
          <Pill tone={d.status === 'confirmed' ? 'accent' : d.status === 'fixed' ? 'pass' : 'neutral'}>{DEFECT_STATUS_LABEL[d.status]}</Pill>
          {d.occurrences > 1 && <span className="muted small tabular">{d.occurrences}회</span>}
          <span className="muted small">{ago(d.lastSeen, now)}</span>
        </span>
      </button>
      <div className="defect-where muted small">{[d.feature, d.page].filter(Boolean).join(' · ') || '위치 정보 없음'}</div>
      {open && (
        <div className="defect-body">
          <pre className="error-block">{d.error}</pre>
          <div className="evidence">
            {d.screenshot && (
              <a href={`/api/runs/${d.runId}/files/${d.screenshot}`} target="_blank" rel="noreferrer noopener" className="shot">
                <img src={`/api/runs/${d.runId}/files/${d.screenshot}`} alt="실패 시점의 화면" loading="lazy" />
              </a>
            )}
            <div className="stack-sm">
              {d.trace && (
                <a className="btn btn-sm" href={`/api/runs/${d.runId}/files/${d.trace}`} download>
                  <Icon name="download" size={14} />
                  트레이스 받기
                </a>
              )}
              {d.trace && <span className="muted small">받은 파일은 <code>npx playwright show-trace</code>로 열 수 있습니다. 입력한 값이 포함될 수 있으니 공유에 주의하세요.</span>}
            </div>
          </div>
          <div className="actions">
            {d.status !== 'confirmed' && (
              <button className="btn btn-primary btn-sm" onClick={() => set({ status: 'confirmed' })}>
                <Icon name="check" size={14} />
                결함 확정
              </button>
            )}
            {d.status !== 'false_positive' && (
              <button className="btn btn-sm" onClick={() => set({ status: 'false_positive' })}>
                오탐으로 분류
              </button>
            )}
            {d.status !== 'fixed' && (
              <button className="btn btn-sm" onClick={() => set({ status: 'fixed' })}>
                수정됨
              </button>
            )}
            {(d.status === 'false_positive' || d.status === 'fixed') && (
              <button className="btn btn-sm" onClick={() => set({ status: 'candidate' })}>
                다시 열기
              </button>
            )}
            <label className="inline-select">
              <span className="muted small">심각도</span>
              <select value={d.severity} onChange={(e) => set({ severity: e.target.value as Defect['severity'] })}>
                <option value="critical">치명</option>
                <option value="major">주요</option>
                <option value="minor">경미</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </li>
  );
}

function RunList({ serviceId }: { serviceId: string }) {
  const runs = useStore((s) => s.runs);
  const mine = Object.values(runs)
    .filter((r) => r.serviceId === serviceId)
    .sort((a, b) => b.startedAt - a.startedAt);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => void loadRuns(serviceId).catch(() => undefined), [serviceId]);

  if (mine.length === 0) return <Empty title="실행 기록이 없습니다">테스트를 실행하면 결과가 이곳에 쌓입니다.</Empty>;
  return (
    <div className="panel table-panel">
      <div className="table-wrap">
        <table className="runs">
          <thead>
            <tr>
              <th>시작</th>
              <th>상태</th>
              <th className="num">통과</th>
              <th className="num">실패</th>
              <th className="num">건너뜀</th>
              <th className="num">결함</th>
              <th className="num">소요</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((r) => (
              <RunRow key={r.id} run={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunRow({ run: r, open, onToggle }: { run: RunSummary; open: boolean; onToggle: () => void }) {
  const [log, setLog] = useState<LogLine[] | null>(null);
  useEffect(() => {
    if (open && !log) api.run(r.id).then((d) => setLog(d.log.filter((l) => l.kind === 'result' || l.kind === 'system')), () => setLog([]));
  }, [open, log, r.id]);
  const tone = r.status === 'passed' ? 'pass' : r.status === 'failed' ? 'fail' : r.status === 'running' || r.status === 'starting' ? 'run' : 'neutral';
  return (
    <>
      <tr className={`run-row${open ? ' run-open' : ''}`} onClick={onToggle} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())} aria-expanded={open}>
        <td>{new Date(r.startedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
        <td>
          <Pill tone={tone} dot={tone === 'run'}>
            {RUN_STATUS_LABEL[r.status]}
          </Pill>
        </td>
        <td className="num tabular">{r.totals.passed}</td>
        <td className={`num tabular${r.totals.failed ? ' tone-fail' : ''}`}>{r.totals.failed}</td>
        <td className="num tabular">{r.totals.skipped}</td>
        <td className="num tabular">{r.defects}</td>
        <td className="num tabular">{r.endedAt ? duration(r.endedAt - r.startedAt) : '—'}</td>
      </tr>
      {open && (
        <tr className="run-detail">
          <td colSpan={7}>
            {log === null ? (
              <span className="muted small">불러오는 중…</span>
            ) : (
              <ol className="log log-flat">
                {log.map((l, i) => (
                  <li key={i} className={`log-row log-${l.kind}${l.kind === 'result' ? ` log-${l.status === 'passed' ? 'pass' : l.status === 'skipped' ? 'skip' : 'fail'}` : ''}`}>
                    <time className="tabular">{clock(l.ts)}</time>
                    <span className="log-mark" aria-hidden="true">
                      {l.kind === 'result' ? (l.status === 'passed' ? '✓' : l.status === 'skipped' ? '–' : '✕') : '!'}
                    </span>
                    <span className="log-text">{l.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
