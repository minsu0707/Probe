import { SEVERITY_LABEL, severityTone } from '../../core/format.ts';
import { useStore } from '../../core/store.ts';
import { Pill } from '../../ui/index.ts';

/** 이번 실행의 결함: a compact list; full triage is on the results page. */
export function RunDefects({ runId }: { runId: string }) {
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
              <Pill tone={severityTone(d.severity)}>{SEVERITY_LABEL[d.severity]}</Pill>
              <div className="mini-main">
                <span className="ellipsis">{d.title}</span>
                <span className="muted small ellipsis">{[d.feature, d.page].filter(Boolean).join(' · ')}</span>
              </div>
              {d.occurrences > 1 && <span className="muted small tabular">×{d.occurrences}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
