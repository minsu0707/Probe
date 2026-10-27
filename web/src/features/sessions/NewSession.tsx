import { useState } from 'react';
import { goService, settingsHref } from '../../app/router.ts';
import { api, type Session, type SessionKind } from '../../core/api.ts';
import { useDraft } from '../../core/drafts.ts';
import { attempt, upsertSession } from '../../core/store.ts';
import { Icon } from '../../ui/index.ts';

/** Start a session: the "테스트 작성" shortcut, or a free conversation. */
export function NewSession({ serviceId, knowledgeCount, claudeReady, onCreated }: { serviceId: string; knowledgeCount: number; claudeReady: boolean; onCreated: (s: Session) => void }) {
  const [focus, setFocus] = useDraft(`new-focus:${serviceId}`);
  const [message, setMessage] = useDraft(`new-message:${serviceId}`);
  const [busy, setBusy] = useState<SessionKind | null>(null);

  const start = async (kind: SessionKind, text: string) => {
    setBusy(kind);
    const session = await attempt(() => api.createSession(serviceId, { kind, message: text }));
    setBusy(null);
    if (session) {
      if (kind === 'chat') setMessage('');
      upsertSession(session);
      onCreated(session);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>테스트 작성</h2>
        <p className="muted small">
          Claude가 학습한 지식 문서를 읽고 Playwright 테스트를 <code>tests/specs/</code>에 씁니다. 이미 있는 테스트는 확장합니다. Claude는 파일만 읽고 쓰며 사이트를 열거나 명령을 실행하지 않습니다. 쓴 뒤에 위의 <strong>테스트 실행</strong>을 누르세요.
        </p>
        {knowledgeCount === 0 && (
          <div className="callout">
            <strong>아직 학습한 지식이 없습니다.</strong>
            <span className="muted small">근거 없는 테스트가 됩니다. 문서를 먼저 올려 학습시키는 것이 좋습니다.</span>
            <button className="btn btn-sm" onClick={() => goService(serviceId, 'learn')}>
              도메인 학습으로
            </button>
          </div>
        )}
        <div className="field">
          <label htmlFor="focus">집중할 범위 (선택)</label>
          <input id="focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="예: 로그인과 장바구니, P0만" />
        </div>
        <div className="actions">
          <button className="btn btn-primary" disabled={!claudeReady || busy !== null} onClick={() => void start('write-tests', focus)}>
            <Icon name="play" size={14} />
            {busy === 'write-tests' ? '시작하는 중…' : '테스트 작성 시작'}
          </button>
          {!claudeReady && (
            <a className="btn btn-sm" href={settingsHref('agent')}>
              Claude 로그인
            </a>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>자유 대화</h2>
        <p className="muted small">이 서비스의 문서와 지식, 테스트에 대해 묻거나 시킵니다. 같은 권한(파일 읽기·쓰기)으로 동작합니다.</p>
        <div className="field">
          <label htmlFor="first-message">첫 메시지</label>
          <textarea id="first-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="예: 결제 흐름에서 빠진 예외 케이스가 있는지 knowledge/rules.md를 보고 알려줘" />
        </div>
        <div className="actions">
          <button className="btn" disabled={!claudeReady || busy !== null || !message.trim()} onClick={() => void start('chat', message)}>
            {busy === 'chat' ? '시작하는 중…' : '대화 시작'}
          </button>
        </div>
      </section>
    </div>
  );
}
