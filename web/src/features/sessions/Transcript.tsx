import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type Session, type SessionMessage } from '../../core/api.ts';
import { clock } from '../../core/format.ts';
import { useDraft } from '../../core/drafts.ts';
import { attempt, loadTranscript, useStore } from '../../core/store.ts';
import { ClaudeAvatar, ConfirmModal, Icon, Markdown } from '../../ui/index.ts';

const EMPTY: SessionMessage[] = [];

/** One conversation: the messages so far, and a box to say the next thing. */
export function Transcript({ session, claudeReady, onDeleted }: { session: Session; claudeReady: boolean; onDeleted: () => void }) {
  const messages = useStore((s) => s.transcripts[session.id] ?? EMPTY);
  const [draft, setDraft] = useDraft(`session:${session.id}`);
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  /** False once the reader scrolls up: new messages stop pulling the view down, and a jump button appears. */
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const running = session.status === 'running';

  useEffect(() => void loadTranscript(session.id).catch(() => undefined), [session.id]);
  // Follow the newest message while Claude works.
  useEffect(() => {
    if (atBottomRef.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const jumpToBottom = () => {
    atBottomRef.current = true;
    setAtBottom(true);
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || running || sending) return;
    setSending(true);
    const ok = await attempt(() => api.sendMessage(session.id, text));
    setSending(false);
    if (ok) setDraft('');
  };
  // Enter sends, Shift+Enter adds a line. Composition (Korean IME) must not send half a syllable.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <section className="panel chat">
      <div className="panel-head">
        <h2 className="ellipsis">{session.title}</h2>
        {running ? (
          <button className="btn btn-danger btn-sm" onClick={() => void attempt(() => api.cancelSession(session.id))}>
            <Icon name="stop" size={12} />
            중단
          </button>
        ) : (
          <button className="icon-btn" aria-label="세션 삭제" title="세션 삭제" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="세션 삭제"
          onConfirm={async () => {
            if (await attempt(() => api.deleteSession(session.id))) onDeleted();
          }}
          onClose={() => setConfirmDelete(false)}
        >
          <b>{session.title}</b> 대화를 삭제합니다. 대화 내용은 복구할 수 없습니다.
        </ConfirmModal>
      )}

      <div className="chat-profile">
        <ClaudeAvatar size={32} />
        <div className="chat-profile-text">
          <strong>Claude</strong>
          <span className="muted small">
            <span className={`dot${running ? ' dot-live' : ' dot-idle'}`} /> {running ? '작업 중' : claudeReady ? '대기 중' : '로그인이 필요합니다'}
          </span>
        </div>
      </div>

      <div className="chat-log-wrap">
      <div
        className="chat-log"
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          atBottomRef.current = near;
          setAtBottom(near);
        }}
      >
        {messages.map((m, i) => (
          <Message key={m.id} m={m} first={!startsClaudeRun(messages[i - 1])} />
        ))}
        {running && (
          <div className="msg-row msg-row-claude">
            <span className="avatar-slot">{!messages.length || messages.at(-1)!.role === 'user' ? <ClaudeAvatar /> : null}</span>
            <div className="msg-col">
              {(!messages.length || messages.at(-1)!.role === 'user') && <div className="msg-name">Claude</div>}
              <div className="msg msg-claude msg-typing" aria-label="Claude가 작업 중입니다">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {!atBottom && (
        <button className="to-bottom" onClick={jumpToBottom} aria-label="맨 아래로 이동" title="맨 아래로">
          <Icon name="arrowDown" size={16} />
        </button>
      )}
      </div>

      <div className="chat-input">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={!claudeReady}
          placeholder={running ? 'Claude가 끝나면 이어서 보낼 수 있습니다' : '메시지 (Enter 전송, Shift+Enter 줄바꿈)'}
          aria-label="메시지"
        />
        <button className="btn btn-primary" onClick={() => void send()} disabled={!claudeReady || running || sending || !draft.trim()}>
          보내기
        </button>
      </div>
    </section>
  );
}

/** A run of Claude's lines (answers, tool notes, errors) shows its avatar and name once, on the first line. */
const isClaudeSide = (m: SessionMessage | undefined): boolean => Boolean(m) && m!.role !== 'user';
const startsClaudeRun = isClaudeSide;

function Message({ m, first }: { m: SessionMessage; first: boolean }) {
  if (m.role === 'user')
    return (
      <div className="msg-row msg-row-user">
        <div className="msg msg-user">
          <p>{m.text}</p>
          <time>{clock(m.ts)}</time>
        </div>
      </div>
    );
  return (
    <div className="msg-row msg-row-claude">
      <span className="avatar-slot">{first ? <ClaudeAvatar /> : null}</span>
      <div className="msg-col">
        {first && <div className="msg-name">Claude</div>}
        {m.role === 'tool' ? (
          <div className="msg msg-tool">{m.text}</div>
        ) : m.role === 'error' ? (
          <div className="msg msg-error">{m.text}</div>
        ) : (
          <div className="msg msg-claude">
            <Markdown source={m.text} />
            <time>{clock(m.ts)}</time>
          </div>
        )}
      </div>
    </div>
  );
}
