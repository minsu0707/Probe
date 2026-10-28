import { useState } from 'react';
import { Modal } from '../../ui/index.ts';

const EXAMPLE = `예)
- 테스트 제목은 "[화면] 동작 → 기대 결과" 형식으로 쓴다
- 선택자는 getByRole / getByLabel을 우선하고, 없으면 data-testid
- 테스트 데이터 이름은 QA-AUTO- 접두어를 붙인다
- 한 파일에 한 기능만, 파일명은 기능명 영문 kebab-case`;

/** The owner's house rules for this service. Every Claude session of the service gets them with each message. */
export function ConventionsModal({ value, onSave, onClose }: { value: string; onSave: (text: string) => Promise<unknown>; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const changed = text.trim() !== value.trim();
  return (
    <Modal title="프로젝트 컨벤션" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!changed || busy) return;
          setBusy(true);
          const ok = await onSave(text);
          setBusy(false);
          if (ok !== undefined) onClose();
        }}
      >
        <p className="muted small">여기에 적은 규칙은 이 서비스의 모든 Claude 세션에 똑같이 적용됩니다. 이미 있는 세션도 다음 메시지부터 따릅니다. 비워 두면 기본 규칙만 씁니다.</p>
        <textarea rows={10} value={text} maxLength={20000} autoFocus onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="컨벤션" />
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={!changed || busy}>
            저장
          </button>
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
