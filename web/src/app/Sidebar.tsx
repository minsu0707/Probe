import { useStore } from '../core/store.ts';
import { Icon, Logo, type IconName } from '../ui/index.ts';
import { navigate, type Route } from './router.ts';

interface NavItem {
  id: Route;
  label: string;
  icon: IconName;
  /** Second line: a live one-glance status for the destination. */
  sub: string;
  live?: boolean;
}

/** The five destinations, each with a status line so the menu doubles as a mini dashboard. */
export function Sidebar({ route }: { route: Route }) {
  const services = useStore((s) => s.services);
  const current = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const connected = useStore((s) => s.connected);
  const active = services.find((s) => s.activeRun)?.activeRun;

  const learnSub = !current ? '서비스를 선택하세요' : current.learning ? '학습 중…' : current.unlearnedDocs ? `새 문서 ${current.unlearnedDocs}개` : current.knowledgeCount ? `지식 ${current.knowledgeCount}개 문서` : '문서 없음';
  const items: NavItem[] = [
    { id: 'services', label: '서비스', icon: 'services', sub: services.length ? `${services.length}개 등록` : '등록된 서비스 없음' },
    { id: 'learn', label: '도메인 학습', icon: 'learn', sub: learnSub },
    { id: 'monitor', label: '실시간 모니터링', icon: 'monitor', sub: active ? `실행 중 ${active.totals.passed + active.totals.failed + active.totals.skipped}/${active.totals.total}` : '대기 중', live: Boolean(active) },
    { id: 'results', label: '결과 · 결함', icon: 'results', sub: current ? (current.openDefects ? `열린 결함 ${current.openDefects}건` : '열린 결함 없음') : '—' },
    { id: 'settings', label: '설정', icon: 'settings', sub: '연결 · 보안' },
  ];

  return (
    <aside className="side">
      <div className="brand">
        <Logo />
        <span>Probe</span>
      </div>
      <nav aria-label="주 메뉴">
        {items.map((it) => (
          <a key={it.id} href={`#/${it.id}`} className={`nav${route === it.id ? ' nav-on' : ''}`} aria-current={route === it.id ? 'page' : undefined} onClick={(e) => (e.preventDefault(), navigate(it.id))}>
            <Icon name={it.icon} />
            <span className="nav-text">
              <span className="nav-label">{it.label}</span>
              <span className="nav-sub">
                {it.live && <span className="dot dot-live" />}
                {it.sub}
              </span>
            </span>
          </a>
        ))}
      </nav>
      <div className="side-foot">
        <span className={`dot ${connected ? 'dot-ok' : 'dot-bad'}`} />
        {connected ? '서버 연결됨' : '서버 연결 끊김 · 재연결 중'}
      </div>
    </aside>
  );
}
