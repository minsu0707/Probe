import { useState } from 'react';
import { api, type Defect } from '../../core/api.ts';
import { attempt } from '../../core/store.ts';
import type { AnswerVerdict } from '../../../../shared/models.ts';

const CHOICES: { value: AnswerVerdict; label: string; hint: string }[] = [
  { value: 'app', label: '앱 버그예요', hint: '결함으로 확정합니다. 테스트는 그대로 둡니다.' },
  { value: 'intended', label: '의도된 동작이에요', hint: '오탐으로 분류합니다. Claude가 테스트의 기대값을 앱에 맞춥니다.' },
  { value: 'test', label: '테스트가 틀렸어요', hint: '오탐으로 분류합니다. Claude가 테스트를 고칩니다.' },
  { value: 'env', label: '환경 문제예요', hint: '오탐으로 분류합니다. 앱도 테스트도 아닌 일시적 문제로 기억합니다.' },
];

/**
 * The owner looks at the screenshot and says what this failure is. The answer sticks to the failure,
 * so it is not asked again, and every Claude session of the service is told about it.
 */
export function AnswerPanel({ defect: d }: { defect: Defect }) {
  const [verdict, setVerdict] = useState<AnswerVerdict | null>(d.answer?.verdict ?? null);
  const [note, setNote] = useState(d.answer?.note ?? '');
  const [busy, setBusy] = useState(false);
  const saved = d.answer;
  const changed = verdict !== (saved?.verdict ?? null) || note.trim() !== (saved?.note ?? '');

  const save = async () => {
    if (!verdict || busy) return;
    setBusy(true);
    await attempt(() => api.answerDefect(d.id, { verdict, note }), '답변을 저장했습니다. 이 프로젝트의 Claude가 기억합니다.');
    setBusy(false);
  };
  const clear = async () => {
    setBusy(true);
    if (await attempt(() => api.clearAnswer(d.id))) {
      setVerdict(null);
      setNote('');
    }
    setBusy(false);
  };

  return (
    <section className="answer" aria-label="이 결과를 판단해 주세요">
      <h4>화면을 보고 판단해 주세요</h4>
      <div className="seg-control answer-choices" role="radiogroup">
        {CHOICES.map((c) => (
          <button key={c.value} className={verdict === c.value ? 'on' : ''} role="radio" aria-checked={verdict === c.value} title={c.hint} onClick={() => setVerdict(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      <textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="이유나 올바른 동작을 한 줄로 (선택). 예: 합계가 100이 아니면 저장이 막히는 게 정상입니다." aria-label="판단 이유" />
      <div className="answer-foot">
        <span className="muted small">{saved ? '답변이 저장되어 있습니다. 같은 실패가 다시 나와도 다시 묻지 않습니다.' : '답하면 이 프로젝트의 모든 Claude 세션이 기억합니다.'}</span>
        {saved && (
          <button className="btn btn-quiet btn-sm" onClick={() => void clear()} disabled={busy}>
            답변 지우기
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!verdict || !changed || busy}>
          저장
        </button>
      </div>
    </section>
  );
}
