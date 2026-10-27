import { useEffect } from 'react';
import { boot } from '../core/socket.ts';
import { selectService, useStore } from '../core/store.ts';
import { LearnPage } from '../features/learn/LearnPage.tsx';
import { MonitorPage } from '../features/monitor/MonitorPage.tsx';
import { ResultsPage } from '../features/results/ResultsPage.tsx';
import { SessionsPage } from '../features/sessions/SessionsPage.tsx';
import { ServiceDetail } from '../features/services/ServiceDetail.tsx';
import { Welcome } from '../features/services/Welcome.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { Toasts } from '../ui/index.ts';
import { useUpdateState } from '../core/desktop.ts';
import { useRoute } from './router.ts';
import { ServiceTabs } from './ServiceTabs.tsx';
import { Sidebar } from './Sidebar.tsx';
import { StatusBar } from './StatusBar.tsx';

/**
 * App shell: sidebar of services, the open service's tabs (or the settings page), and a status bar.
 * The route decides which service is open; the pages below still read it as the store's
 * `currentId`, so the route is mirrored into the store here.
 */
export function App() {
  const route = useRoute();
  const ready = useStore((s) => s.ready);
  const services = useStore((s) => s.services);
  const currentId = useStore((s) => s.currentId);
  const update = useUpdateState();
  useEffect(() => void boot(), []);

  const routedId = route.page === 'service' ? route.serviceId : null;
  const service = services.find((s) => s.id === routedId);

  useEffect(() => {
    if (service && service.id !== currentId) selectService(service.id);
  }, [service, currentId]);

  // A service that no longer exists (deleted, or a stale link) falls back to home.
  useEffect(() => {
    if (ready && route.page === 'service' && !service) location.replace('#/');
  }, [ready, route.page, service]);

  // Home opens the last-used service, so a reload or a fresh start lands where the user left off.
  useEffect(() => {
    if (ready && route.page === 'home' && currentId && services.some((s) => s.id === currentId)) location.replace(`#/s/${encodeURIComponent(currentId)}/overview`);
  }, [ready, route.page, currentId, services]);

  return (
    <div className="shell">
      <Sidebar route={route} />
      <div className="main">
        {route.page === 'service' && service && <ServiceTabs service={service} tab={route.tab} />}
        {/* key resets a page's local state (filters, open rows) when the service or tab changes */}
        <main className="page" key={route.page === 'service' ? `${route.serviceId}/${route.tab}` : route.page === 'settings' ? 'settings' : 'home'}>
          {!ready ? (
            <div className="muted pad">불러오는 중…</div>
          ) : route.page === 'settings' ? (
            <SettingsPage section={route.section} />
          ) : route.page === 'service' ? (
            !service ? null : route.tab === 'learn' ? (
              <LearnPage />
            ) : route.tab === 'sessions' ? (
              <SessionsPage />
            ) : route.tab === 'monitor' ? (
              <MonitorPage />
            ) : route.tab === 'results' ? (
              <ResultsPage />
            ) : (
              <ServiceDetail key={service.id} service={service} />
            )
          ) : services.length === 0 ? (
            <Welcome />
          ) : null /* redirecting to the last-used service */}
        </main>
      </div>
      <StatusBar />
      <Toasts />
      {update?.phase === 'installing' && (
        <div className="installing" role="alert">
          <div className="installing-card">
            <span className="spinner" aria-hidden="true" />
            <h2>Probe {update.version}(으)로 업데이트하는 중</h2>
            <p>이 창이 닫혔다가 1~2분 뒤 자동으로 다시 열립니다. 설치 진행 창이 뜨면 그대로 두세요.</p>
          </div>
        </div>
      )}
    </div>
  );
}
