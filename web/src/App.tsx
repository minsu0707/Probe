import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { RUN_STATUS_LABEL } from './format.ts';
import { LearnPage } from './pages/LearnPage.tsx';
import { MonitorPage } from './pages/MonitorPage.tsx';
import { ResultsPage } from './pages/ResultsPage.tsx';
import { ServicesPage } from './pages/ServicesPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { attempt, boot, selectService, useStore } from './store.ts';
import { Icon, Logo, Pill, Toasts, type IconName } from './ui.tsx';

type Route = 'services' | 'learn' | 'monitor' | 'results' | 'settings';
const ROUTES: Route[] = ['services', 'learn', 'monitor', 'results', 'settings'];

function useRoute(): [Route, (r: Route) => void] {
  const read = (): Route => {
    const h = location.hash.replace(/^#\/?/, '') as Route;
    return ROUTES.includes(h) ? h : 'services';
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => (location.hash = `#/${r}`)];
}

export function App() {
  const [route, go] = useRoute();
  const ready = useStore((s) => s.ready);
  useEffect(() => void boot(), []);

  return (
    <div className="shell">
      <Sidebar route={route} go={go} />
      <div className="main">
        <Topbar go={go} />
        <main className="page" key={route}>
          {!ready ? <div className="muted pad">불러오는 중…</div> : route === 'services' ? <ServicesPage go={go} /> : route === 'learn' ? <LearnPage /> : route === 'monitor' ? <MonitorPage /> : route === 'results' ? <ResultsPage /> : <SettingsPage />}
        </main>
      </div>
      <Toasts />
    </div>
  );
}

function Sidebar({ route, go }: { route: Route; go: (r: Route) => void }) {
  const services = useStore((s) => s.services);
  const current = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const connected = useStore((s) => s.connected);
  const active = services.find((s) => s.activeRun)?.activeRun;

  const items: { id: Route; label: string; icon: IconName; sub: string; live?: boolean }[] = [
    { id: 'services', label: '서비스', icon: 'services', sub: services.length ? `${services.length}개 등록` : '등록된 서비스 없음' },
    { id: 'learn', label: '도메인 학습', icon: 'learn', sub: !current ? '서비스를 선택하세요' : current.learning ? '학습 중…' : current.unlearnedDocs ? `새 문서 ${current.unlearnedDocs}개` : current.knowledgeCount ? `지식 ${current.knowledgeCount}개 문서` : '문서 없음' },
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
          <a key={it.id} href={`#/${it.id}`} className={`nav${route === it.id ? ' nav-on' : ''}`} aria-current={route === it.id ? 'page' : undefined} onClick={(e) => (e.preventDefault(), go(it.id))}>
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

function Topbar({ go }: { go: (r: Route) => void }) {
  const services = useStore((s) => s.services);
  const current = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const active = current?.activeRun;

  return (
    <header className="topbar">
      <div className="switcher">
        <label htmlFor="service-select" className="eyebrow">
          서비스
        </label>
        {services.length ? (
          <select id="service-select" value={current?.id ?? ''} onChange={(e) => selectService(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">없음</span>
        )}
        {current?.baseUrl && (
          <a className="url" href={current.baseUrl} target="_blank" rel="noreferrer noopener" title="서비스 열기">
            {current.baseUrl.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>
      <div className="spacer" />
      {active && (
        <button className="chip-run" onClick={() => go('monitor')}>
          <Pill tone="run" dot>
            {RUN_STATUS_LABEL[active.status]}
          </Pill>
          <span className="tabular">
            {active.totals.passed + active.totals.failed + active.totals.skipped}/{active.totals.total || '?'}
          </span>
        </button>
      )}
      {current &&
        (active ? (
          <button className="btn btn-danger" onClick={() => void attempt(() => api.stopRun(active.id))}>
            <Icon name="stop" size={14} />
            중단
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={async () => {
              const r = await attempt(() => api.startRun(current.id));
              if (r) go('monitor');
            }}
          >
            <Icon name="play" size={14} />
            테스트 실행
          </button>
        ))}
    </header>
  );
}
