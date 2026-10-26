import { useEffect, useState } from 'react';
import { api, type LogLine, type RunSummary } from '../../core/api.ts';
import { RUN_STATUS_LABEL, duration, runTone, startTime } from '../../core/format.ts';
import { loadRuns, useStore } from '../../core/store.ts';
import { Empty, Pill } from '../../ui/index.ts';
import { LogRow } from '../monitor/LogRow.tsx';

/** 실행 기록: one row per run; expand a row to see each test's result. */
export function RunList({ serviceId }: { serviceId: string }) {
  const runs = useStore((s) => s.runs);
  const [openId, setOpenId] = useState<string | null>(null);
  const mine = Object.values(runs)
    .filter((r) => r.serviceId === serviceId)
    .sort((a, b) => b.startedAt - a.startedAt);

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
  const [results, setResults] = useState<LogLine[] | null>(null);

  // Fetched on first expand; only results and system notes, since steps would bury them.
  useEffect(() => {
    if (open && !results) api.run(r.id).then((d) => setResults(d.log.filter((l) => l.kind === 'result' || l.kind === 'system')), () => setResults([]));
  }, [open, results, r.id]);

  const tone = runTone(r.status);
  return (
    <>
      <tr className={`run-row${open ? ' run-open' : ''}`} onClick={onToggle} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())} aria-expanded={open}>
        <td>{startTime(r.startedAt)}</td>
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
            {results === null ? (
              <span className="muted small">불러오는 중…</span>
            ) : (
              <ol className="log log-flat">
                {results.map((l, i) => (
                  <LogRow key={i} line={l} />
                ))}
              </ol>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
