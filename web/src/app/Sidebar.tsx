import { useState } from 'react';
import { useStore } from '../core/store.ts';
import { AddServiceModal } from '../features/services/AddServiceModal.tsx';
import { Icon, Logo } from '../ui/index.ts';
import { serviceHref, settingsHref, type Route } from './router.ts';
import type { ServiceOverview } from '../core/api.ts';

/** The one-line state under a service's name: what is happening there right now, else what needs attention. */
function serviceStatus(s: ServiceOverview): { text: string; live: boolean } {
  if (s.activeRun) {
    const t = s.activeRun.totals;
    return { text: `실행 중 ${t.passed + t.failed + t.skipped}/${t.total || '?'}`, live: true };
  }
  if (s.learning) return { text: '학습 중…', live: true };
  if (s.openDefects) return { text: `열린 결함 ${s.openDefects}건`, live: false };
  if (s.unlearnedDocs) return { text: `새 문서 ${s.unlearnedDocs}개`, live: false };
  return { text: s.baseUrl?.replace(/^https?:\/\//, '') ?? '주소 없음', live: false };
}

/** Services on the left (each one opens its own tabs), settings pinned at the bottom. */
export function Sidebar({ route }: { route: Route }) {
  const services = useStore((s) => s.services);
  const currentId = useStore((s) => s.currentId);
  const [adding, setAdding] = useState(false);
  const openId = route.page === 'service' ? route.serviceId : null;

  return (
    <aside className="side">
      <div className="brand">
        <Logo />
        <span>Probe</span>
      </div>

      <div className="side-head">
        <span className="eyebrow">서비스</span>
        <button className="icon-btn" onClick={() => setAdding(true)} aria-label="서비스 추가" title="서비스 추가">
          <Icon name="plus" size={16} />
        </button>
      </div>

      <nav className="side-list" aria-label="서비스">
        {services.length === 0 && <p className="side-empty">등록된 서비스가 없습니다.</p>}
        {services.map((s) => {
          const st = serviceStatus(s);
          const on = openId ? s.id === openId : route.page === 'home' && s.id === currentId;
          return (
            <a key={s.id} href={serviceHref(s.id)} className={`svc${on ? ' svc-on' : ''}`} aria-current={on ? 'page' : undefined} title={s.name}>
              <span className="avatar" aria-hidden="true">
                {[...s.name][0]?.toUpperCase()}
              </span>
              <span className="svc-text">
                <span className="svc-name">{s.name}</span>
                <span className="svc-sub">
                  {st.live && <span className="dot dot-live" />}
                  {st.text}
                </span>
              </span>
            </a>
          );
        })}
      </nav>

      <div className="side-foot">
        <a href={settingsHref()} className={`svc${route.page === 'settings' ? ' svc-on' : ''}`} aria-current={route.page === 'settings' ? 'page' : undefined} title="설정">
          <Icon name="settings" />
          <span className="svc-text">
            <span className="svc-name">설정</span>
          </span>
        </a>
      </div>
      {adding && <AddServiceModal onClose={() => setAdding(false)} />}
    </aside>
  );
}
