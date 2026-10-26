import { api, type Defect } from '../../core/api.ts';
import { DEFECT_STATUS_LABEL, SEVERITY_LABEL, ago, severityTone } from '../../core/format.ts';
import { attempt } from '../../core/store.ts';
import { Icon, Pill } from '../../ui/index.ts';

/** One defect: a header you can expand to see the error, evidence and triage actions. */
export function DefectRow({ defect: d, open, onToggle, now }: { defect: Defect; open: boolean; onToggle: () => void; now: number }) {
  const update = (patch: Parameters<typeof api.updateDefect>[1]) => void attempt(() => api.updateDefect(d.id, patch));
  const closed = d.status === 'fixed' || d.status === 'false_positive';
  const evidenceUrl = (file: string) => `/api/runs/${d.runId}/files/${file}`;

  return (
    <li className={`defect sev-${d.severity}${closed ? ' defect-done' : ''}`}>
      <button className="defect-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron" size={16} />
        <span className="defect-title">{d.title}</span>
        <span className="defect-meta">
          <Pill tone={severityTone(d.severity)}>{SEVERITY_LABEL[d.severity]}</Pill>
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
              <a href={evidenceUrl(d.screenshot)} target="_blank" rel="noreferrer noopener" className="shot">
                <img src={evidenceUrl(d.screenshot)} alt="실패 시점의 화면" loading="lazy" />
              </a>
            )}
            {d.trace && (
              <div className="stack-sm">
                <a className="btn btn-sm" href={evidenceUrl(d.trace)} download>
                  <Icon name="download" size={14} />
                  트레이스 받기
                </a>
                <span className="muted small">
                  받은 파일은 <code>npx playwright show-trace</code>로 열 수 있습니다. 입력한 값이 포함될 수 있으니 공유에 주의하세요.
                </span>
              </div>
            )}
          </div>
          <div className="actions">
            {d.status !== 'confirmed' && (
              <button className="btn btn-primary btn-sm" onClick={() => update({ status: 'confirmed' })}>
                <Icon name="check" size={14} />
                결함 확정
              </button>
            )}
            {d.status !== 'false_positive' && (
              <button className="btn btn-sm" onClick={() => update({ status: 'false_positive' })}>
                오탐으로 분류
              </button>
            )}
            {d.status !== 'fixed' && (
              <button className="btn btn-sm" onClick={() => update({ status: 'fixed' })}>
                수정됨
              </button>
            )}
            {closed && (
              <button className="btn btn-sm" onClick={() => update({ status: 'candidate' })}>
                다시 열기
              </button>
            )}
            <label className="inline-select">
              <span className="muted small">심각도</span>
              <select value={d.severity} onChange={(e) => update({ severity: e.target.value as Defect['severity'] })}>
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
