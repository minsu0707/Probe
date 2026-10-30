import { useState } from 'react';
import { explainCause } from '../../../../shared/cause.ts';
import { reviewNeed } from '../../../../shared/need.ts';
import { api, type Defect } from '../../core/api.ts';
import { goService } from '../../app/router.ts';
import { CAUSE_HINT, CAUSE_LABEL, DEFECT_STATUS_LABEL, SEVERITY_LABEL, ago, dateTime, startTime } from '../../core/format.ts';
import { attempt } from '../../core/store.ts';
import { Icon } from '../../ui/index.ts';
import { AnswerPanel } from './AnswerPanel.tsx';
import { analysisRequest } from './analysis.ts';

const SHOT_SIZES = [
  { id: 'small', label: '작게', width: '420px' },
  { id: 'medium', label: '보통', width: '720px' },
  { id: 'large', label: '크게', width: '1100px' },
  { id: 'full', label: '꽉 차게', width: '100%' },
] as const;
type ShotSize = (typeof SHOT_SIZES)[number]['id'];
const SHOT_SIZE_KEY = 'probe.shotSize';

/** The chosen screenshot size is remembered; storage can be blocked, so it is only a convenience. */
function readShotSize(): ShotSize {
  try {
    const saved = localStorage.getItem(SHOT_SIZE_KEY);
    return SHOT_SIZES.find((s) => s.id === saved)?.id ?? 'medium';
  } catch {
    return 'medium';
  }
}

/** One row in the list: severity dot and title, where it is, and one quiet line of facts. */
export function DefectItem({ defect: d, selected, onSelect, now }: { defect: Defect; selected: boolean; onSelect: () => void; now: number }) {
  const closed = d.status === 'fixed' || d.status === 'false_positive';
  const facts = [d.status !== 'candidate' ? DEFECT_STATUS_LABEL[d.status] : null, d.cause !== 'unknown' ? CAUSE_LABEL[d.cause] : null, d.answer ? '답변함' : null, d.occurrences > 1 ? `${d.occurrences}회` : null, `${startTime(d.firstSeen)} 발견`, d.occurrences > 1 ? `최근 ${ago(d.lastSeen, now)}` : null].filter(Boolean);
  return (
    <li className={`defect-item${closed ? ' defect-done' : ''}${selected ? ' selected' : ''}`}>
      <button onClick={onSelect} aria-current={selected}>
        <span className="defect-title">
          <span className={`sev sev-${d.severity}`} role="img" aria-label={`심각도 ${SEVERITY_LABEL[d.severity]}`} title={`심각도 ${SEVERITY_LABEL[d.severity]}`} />
          {d.title}
        </span>
        <span className="defect-where muted small">{[d.feature, d.page].filter(Boolean).join(' · ') || '위치 정보 없음'}</span>
        {!closed && <span className="defect-why small">{reviewNeed({ error: d.error, page: d.page, feature: d.feature, hasScreenshot: Boolean(d.screenshot) }).headline}</span>}
        <span className="muted small">{facts.join(' · ')}</span>
      </button>
    </li>
  );
}

/** Everything about the selected defect: the error, the screenshot at a readable size and the triage actions. */
export function DefectDetail({ defect: d, followedFrom }: { defect: Defect; followedFrom?: string }) {
  const update = (patch: Parameters<typeof api.updateDefect>[1]) => void attempt(() => api.updateDefect(d.id, patch));
  const closed = d.status === 'fixed' || d.status === 'false_positive';
  const guess = explainCause(d.error);
  const need = reviewNeed({ error: d.error, page: d.page, feature: d.feature, hasScreenshot: Boolean(d.screenshot) });
  const analyze = async () => {
    if (await attempt(() => api.createSession(d.serviceId, { kind: 'chat', message: analysisRequest(d, followedFrom), parallel: true }))) goService(d.serviceId, 'sessions');
  };
  const [shotSize, setShotSize] = useState<ShotSize>(readShotSize);
  const chooseShotSize = (id: ShotSize) => {
    setShotSize(id);
    try {
      localStorage.setItem(SHOT_SIZE_KEY, id);
    } catch {
      /* not remembered */
    }
  };
  const evidenceUrl = (file: string) => `/api/runs/${d.runId}/files/${file}`;

  return (
    <div className="defect-detail">
      <div className="defect-detail-head">
        <h3>{d.title}</h3>
        <div className="defect-where muted small">{[d.feature, d.page].filter(Boolean).join(' · ') || '위치 정보 없음'}</div>
        <div className="muted small">
          {[SEVERITY_LABEL[d.severity], DEFECT_STATUS_LABEL[d.status], d.answer ? '답변함' : null, d.occurrences > 1 ? `${d.occurrences}회 발생` : null, `${dateTime(d.firstSeen)} 발견`, d.occurrences > 1 ? `최근 ${dateTime(d.lastSeen)}` : null].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div className="actions">
        {d.status !== 'confirmed' && (
          <button className="btn btn-primary btn-sm" onClick={() => update({ status: 'confirmed' })}>
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
        <button className="btn btn-quiet btn-sm" onClick={() => void analyze()} title="실패 내용을 Claude 세션으로 보내 테스트 문제인지 앱 문제인지 판단하게 합니다">
          Claude에게 원인 분석 맡기기
        </button>
        <label className="inline-select">
          <span className="muted small">심각도</span>
          <select value={d.severity} onChange={(e) => update({ severity: e.target.value as Defect['severity'] })}>
            <option value="critical">치명</option>
            <option value="major">주요</option>
            <option value="minor">경미</option>
          </select>
        </label>
      </div>

      {!closed && (
        <section className="need" aria-label="확인이 필요한 이유">
          <h4>무슨 일이 있었나</h4>
          <p>{need.happened}</p>
          <h4>왜 사람이 봐야 하나</h4>
          <p>{need.why}</p>
          <h4>이렇게 확인해 주세요</h4>
          <ol>
            {need.checks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </section>
      )}

      <div className="cause">
        {/* "원인 불명" says nothing the block above does not say better, so it is left out. */}
        {(d.cause !== 'unknown' || closed) && (
          <p className="muted small">
            <strong>{CAUSE_LABEL[d.cause]}</strong> · {guess.detail?.summary ?? guess.why ?? CAUSE_HINT[d.cause]}
          </p>
        )}
        {guess.detail && guess.detail.points.length > 0 && (
          <ul className="cause-points muted small">
            {guess.detail.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {guess.detail?.fix && <p className="small">고치려면: {guess.detail.fix}</p>}
        {guess.matched && (
          <p className="muted small">
            판단 근거: 오류 문구의 <code>{guess.matched}</code> 부분. 오류 문구만 보고 추정한 것이라 틀릴 수 있습니다.
          </p>
        )}
      </div>
      <AnswerPanel key={`${d.id}:${d.answer?.answeredAt ?? 0}`} defect={d} />
      {followedFrom && <p className="muted small">같은 파일에서 먼저 실패한 “{followedFrom}” 뒤에 이어서 실패했습니다. 앞의 원인을 고치면 같이 해결될 수 있습니다.</p>}

      {d.screenshot && (
        <div className="shot-box">
          <div className="shot-size" role="group" aria-label="스크린샷 크기">
            <span className="muted small">화면 크기</span>
            {SHOT_SIZES.map((s) => (
              <button key={s.id} type="button" className={`btn btn-sm${shotSize === s.id ? ' btn-primary' : ''}`} aria-pressed={shotSize === s.id} onClick={() => chooseShotSize(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <a href={evidenceUrl(d.screenshot)} target="_blank" rel="noreferrer noopener" className="shot" style={{ maxWidth: SHOT_SIZES.find((s) => s.id === shotSize)!.width }} title="새 탭에서 원본 크기로 보기">
            <img src={evidenceUrl(d.screenshot)} alt="실패 시점의 화면" loading="lazy" />
          </a>
        </div>
      )}

      <pre className="error-block">{d.error}</pre>

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
  );
}
