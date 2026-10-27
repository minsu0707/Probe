import { useEffect, useState } from 'react';
import { settingsHref } from '../../app/router.ts';
import type { Session } from '../../core/api.ts';
import { ago } from '../../core/format.ts';
import { loadSessions, useStore } from '../../core/store.ts';
import { Empty, Icon, useNow } from '../../ui/index.ts';
import { NewSession } from './NewSession.tsx';
import { Transcript } from './Transcript.tsx';

const NEW = 'new';
const EMPTY: Session[] = [];

/** Claude 세션: ask Claude to write tests for this service, and keep talking to it afterwards. */
export function SessionsPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  if (!service) return <Empty title="서비스를 먼저 등록하세요">Claude 세션은 서비스별로 보관됩니다.</Empty>;
  // key remounts per service so one service's conversation never flashes while another loads
  return <SessionsBody key={service.id} serviceId={service.id} serviceName={service.name} knowledgeCount={service.knowledgeCount} />;
}

function SessionsBody({ serviceId, serviceName, knowledgeCount }: { serviceId: string; serviceName: string; knowledgeCount: number }) {
  const sessions = useStore((s) => s.sessions[serviceId] ?? EMPTY);
  const claude = useStore((s) => s.claude);
  const now = useNow(30_000);
  const [picked, setPicked] = useState<string | null>(null);
  const claudeReady = !claude || (claude.installed && Boolean(claude.auth?.loggedIn));

  useEffect(() => void loadSessions(serviceId).catch(() => undefined), [serviceId]);

  // Until the user picks something: the newest session, or the "new" form when there is none.
  const selectedId = picked ?? sessions[0]?.id ?? NEW;
  const selected = sessions.find((s) => s.id === selectedId);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted">{serviceName}의 테스트를 Claude에게 쓰게 하고, 대화로 고쳐 나갑니다.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setPicked(NEW)} disabled={!claudeReady}>
          <Icon name="plus" size={16} />새 세션
        </button>
      </div>

      {!claudeReady && (
        <div className="callout">
          <strong>{claude?.installed ? 'Claude에 로그인해야 대화할 수 있습니다.' : 'Claude Code가 설치되어 있지 않습니다.'}</strong>
          <a className="btn btn-primary btn-sm" href={settingsHref('agent')}>
            설정에서 {claude?.installed ? '로그인' : '확인'}하기
          </a>
        </div>
      )}

      <div className="split split-sessions">
        <section className="panel list" aria-label="세션 목록">
          {sessions.length === 0 && <p className="muted small pad">아직 세션이 없습니다.</p>}
          {sessions.map((s) => (
            <button key={s.id} className={`row${s.id === selectedId ? ' row-on' : ''}`} onClick={() => setPicked(s.id)} aria-pressed={s.id === selectedId}>
              <div className="row-main">
                <strong className="ellipsis">{s.title}</strong>
                <span className="muted small">
                  {s.status === 'running' ? (
                    <>
                      <span className="dot dot-live" /> 작업 중
                    </>
                  ) : s.status === 'failed' ? (
                    '오류로 멈춤'
                  ) : (
                    ago(s.updatedAt, now)
                  )}
                </span>
              </div>
            </button>
          ))}
        </section>

        {selected ? (
          <Transcript key={selected.id} session={selected} claudeReady={claudeReady} onDeleted={() => setPicked(null)} />
        ) : (
          <NewSession serviceId={serviceId} knowledgeCount={knowledgeCount} claudeReady={claudeReady} onCreated={(s) => setPicked(s.id)} />
        )}
      </div>
    </>
  );
}
