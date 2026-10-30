import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type QueuedMessage, type Session, type SessionMessage } from '../../core/api.ts';
import { clock, dateTime } from '../../core/format.ts';
import { labelOfLine } from '../../../../shared/tool-labels.ts';
import { useDraft } from '../../core/drafts.ts';
import { attempt, loadTranscript, useStore } from '../../core/store.ts';
import { ClaudeAvatar, ConfirmModal, Icon, Markdown } from '../../ui/index.ts';
import { NodeMapModal } from './NodeMap.tsx';

const EMPTY: SessionMessage[] = [];
const NO_QUEUE: QueuedMessage[] = [];

/** One conversation: the messages so far, and a box to say the next thing. */
export function Transcript({ session, claudeReady, onDeleted }: { session: Session; claudeReady: boolean; onDeleted: () => void }) {
  const messages = useStore((s) => s.transcripts[session.id] ?? EMPTY);
  const queue = useStore((s) => s.queues[session.id] ?? NO_QUEUE);
  const [draft, setDraft] = useDraft(`session:${session.id}`);
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  /** False once the reader scrolls up: new messages stop pulling the view down, and a jump button appears. */
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const running = session.status === 'running';
  const [showNodes, setShowNodes] = useState(false);
  // Offered once a test run has started since the user's last message: that run is what the nodes show.
  const turnStart = messages.findLast((m) => m.role === 'user')?.ts ?? 0;
  const turnRun = useStore((s) => Object.values(s.runs).filter((r) => r.serviceId === session.serviceId && r.startedAt >= turnStart - 5000).sort((a, b) => b.startedAt - a.startedAt)[0]);
  const nodeButtonAt = turnRun ? messages.findLastIndex((m) => m.role === 'tool') : -1;

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
    if (!text || sending) return;
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
        <div className="chat-head-side">
          {running ? (
            <button className="btn btn-stop btn-sm" onClick={() => setConfirmStop(true)}>
              중단
            </button>
          ) : (
            <button className="btn btn-quiet btn-sm" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={14} />
              세션 삭제
            </button>
          )}
          <dl className="chat-dates muted small">
            <div>
              <dt>시작</dt>
              <dd>{dateTime(session.createdAt)}</dd>
            </div>
            <div>
              <dt>마지막 작업</dt>
              <dd>{running ? '지금 작업 중' : dateTime(session.updatedAt)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {showNodes && turnRun && <NodeMapModal run={turnRun} onClose={() => setShowNodes(false)} />}

      {confirmStop && (
        <ConfirmModal
          title="작업 중단"
          confirm="중단"
          onConfirm={async () => {
            await attempt(() => api.cancelSession(session.id));
          }}
          onClose={() => setConfirmStop(false)}
        >
          Claude의 작업을 중단합니다. 진행 중이던 응답은 끊기고, 예약해 둔 메시지가 있으면 자동으로 보내지 않고 멈춰 둡니다.
        </ConfirmModal>
      )}

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
        {groupMessages(messages).map((g, i, all) =>
          g.kind === 'tools' ? (
            <ToolGroup key={g.items[0].id} items={g.items} first={g.first} live={running && i === all.length - 1} onNodes={g.items.some((m) => m.id === messages[nodeButtonAt]?.id) ? () => setShowNodes(true) : undefined} />
          ) : (
            <Message key={g.m.id} m={g.m} first={g.first} />
          ),
        )}
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
        {queue.length > 0 && (
          <div className="queue" aria-label="예약된 메시지">
            <div className="queue-head muted small">
              {running ? `예약 ${queue.length}건 · Claude가 끝나면 순서대로 보냅니다` : `예약 ${queue.length}건 · 멈춰 있습니다`}
              {!running && (
                <button className="btn btn-sm" onClick={() => void attempt(() => api.sendQueuedNow(session.id))} disabled={!claudeReady}>
                  지금 보내기
                </button>
              )}
            </div>
            {queue.map((q, i) => (
              <div key={q.id} className="queue-item">
                <span className="queue-no tabular">{i + 1}</span>
                <p>{q.text}</p>
                <button className="icon-btn" aria-label="예약 취소" title="예약 취소" onClick={() => void attempt(() => api.removeQueued(session.id, q.id))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
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
          placeholder={running ? 'Claude가 작업 중입니다. 지금 보내면 끝난 뒤 순서대로 보냅니다 (Enter 예약)' : '메시지 (Enter 전송, Shift+Enter 줄바꿈)'}
          aria-label="메시지"
        />
        <button className="btn btn-primary" onClick={() => void send()} disabled={!claudeReady || sending || !draft.trim()}>
          {running ? '예약' : '보내기'}
        </button>
      </div>
    </section>
  );
}

type Item = { kind: 'msg'; m: SessionMessage; first: boolean } | { kind: 'tools'; items: SessionMessage[]; first: boolean };

/** Consecutive tool notes become one group, so twelve identical calls are one line instead of twelve. */
function groupMessages(messages: SessionMessage[]): Item[] {
  const out: Item[] = [];
  for (const m of messages) {
    const first = !isClaudeSide(messages[messages.indexOf(m) - 1]);
    const last = out.at(-1);
    if (m.role === 'tool' && last?.kind === 'tools') last.items.push(m);
    else if (m.role === 'tool') out.push({ kind: 'tools', items: [m], first });
    else out.push({ kind: 'msg', m, first });
  }
  return out;
}

/** What Claude is doing or did, in one quiet line; click for every step. */
function ToolGroup({ items, first, live, onNodes }: { items: SessionMessage[]; first: boolean; live: boolean; onNodes?: () => void }) {
  const labels = items.map((m) => labelOfLine(m.text));
  const counts: [string, number][] = [];
  for (const l of labels) {
    const hit = counts.find(([x]) => x === l);
    if (hit) hit[1]++;
    else counts.push([l, 1]);
  }
  const part = ([l, n]: [string, number]) => (n > 1 ? `${l} ×${n}` : l);
  const summary = counts.slice(0, 3).map(part).join(' · ') + (counts.length > 3 ? ` 외 ${counts.length - 3}종` : '');
  return (
    <div className="msg-row msg-row-claude">
      <span className="avatar-slot">{first ? <ClaudeAvatar /> : null}</span>
      <div className="msg-col">
        {first && <div className="msg-name">Claude</div>}
        <details className={`tool-group${live ? ' tool-live' : ''}`}>
          <summary>
            {live && <span className="dot dot-live" />}
            <span className="tool-now">{live ? `${labels.at(-1)}${items.length > 1 ? ` · ${items.length}단계째` : ''}` : summary}</span>
            {!live && items.length > 1 && <span className="muted small">{items.length}단계</span>}
          </summary>
          <ol>
            {items.map((m, i) => (
              <li key={m.id}>
                <span className="tabular muted">{i + 1}</span> {labels[i]} <time className="muted small">{clock(m.ts)}</time>
              </li>
            ))}
          </ol>
        </details>
        {onNodes && (
          <button className="btn btn-sm node-btn" onClick={onNodes}>
            노드로 보기
          </button>
        )}
      </div>
    </div>
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
