import { api } from '../core/api.ts';
import type { ServiceOverview } from '../core/api.ts';
import { attempt } from '../core/store.ts';
import { Icon } from '../ui/index.ts';
import { goService, serviceHref, type Tab } from './router.ts';

interface TabDef {
  id: Tab;
  label: string;
  /** A short live badge: a count, or a pulse while something is running. */
  badge?: (s: ServiceOverview) => { text?: string; live?: boolean; tone?: 'fail' } | null;
}

/** The four views of one service. The monitor tab pulses while a run is active, like Orca's session tabs. */
const TAB_DEFS: TabDef[] = [
  { id: 'overview', label: '개요' },
  { id: 'learn', label: '도메인 학습', badge: (s) => (s.learning ? { live: true } : s.unlearnedDocs ? { text: String(s.unlearnedDocs) } : null) },
  { id: 'sessions', label: 'Claude 세션', badge: (s) => (s.claudeWorking ? { live: true } : null) },
  { id: 'monitor', label: '실시간 모니터링', badge: (s) => (s.activeRun ? { live: true } : null) },
  { id: 'results', label: '결과 · 결함', badge: (s) => (s.openDefects ? { text: String(s.openDefects), tone: 'fail' } : null) },
];

/** Header of a service: its name and address, the tabs, and the run control. */
export function ServiceTabs({ service, tab }: { service: ServiceOverview; tab: Tab }) {
  const active = service.activeRun;

  return (
    <header className="tabbar">
      <div className="tabbar-title">
        <strong className="ellipsis">{service.name}</strong>
        {service.baseUrl && (
          <a className="url" href={service.baseUrl} target="_blank" rel="noreferrer noopener" title="서비스 열기">
            {service.baseUrl.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <nav className="svc-tabs" aria-label={`${service.name} 화면`}>
        {TAB_DEFS.map((t) => {
          const badge = t.badge?.(service);
          return (
            <a key={t.id} href={serviceHref(service.id, t.id)} className={`svc-tab${tab === t.id ? ' svc-tab-on' : ''}`} aria-current={tab === t.id ? 'page' : undefined}>
              {t.label}
              {badge?.live && <span className="dot dot-live" />}
              {badge?.text && <span className={`count${badge.tone === 'fail' ? ' count-fail' : ''}`}>{badge.text}</span>}
            </a>
          );
        })}
      </nav>

      <div className="spacer" />
      {active ? (
        <button className="btn btn-danger" onClick={() => void attempt(() => api.stopRun(active.id))}>
          <Icon name="stop" size={14} />
          중단
        </button>
      ) : (
        <button
          className="btn btn-primary"
          onClick={async () => {
            if (await attempt(() => api.startRun(service.id))) goService(service.id, 'monitor');
          }}
        >
          <Icon name="play" size={14} />
          테스트 실행
        </button>
      )}
    </header>
  );
}
