import { useEffect } from 'react';
import { boot } from '../core/socket.ts';
import { useStore } from '../core/store.ts';
import { LearnPage } from '../features/learn/LearnPage.tsx';
import { MonitorPage } from '../features/monitor/MonitorPage.tsx';
import { ResultsPage } from '../features/results/ResultsPage.tsx';
import { ServicesPage } from '../features/services/ServicesPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { Toasts } from '../ui/index.ts';
import { navigate, useRoute } from './router.ts';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';

/** App shell: sidebar, top bar, and the page for the current route. */
export function App() {
  const route = useRoute();
  const ready = useStore((s) => s.ready);
  useEffect(() => void boot(), []);

  return (
    <div className="shell">
      <Sidebar route={route} />
      <div className="main">
        <Topbar />
        {/* key resets a page's local state (filters, open rows) when the route changes */}
        <main className="page" key={route}>
          {!ready ? (
            <div className="muted pad">불러오는 중…</div>
          ) : route === 'services' ? (
            <ServicesPage onOpenLearn={() => navigate('learn')} />
          ) : route === 'learn' ? (
            <LearnPage />
          ) : route === 'monitor' ? (
            <MonitorPage />
          ) : route === 'results' ? (
            <ResultsPage />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
