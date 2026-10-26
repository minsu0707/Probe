import { api } from '../core/api.ts';
import { RUN_STATUS_LABEL } from '../core/format.ts';
import { attempt, selectService, useStore } from '../core/store.ts';
import { Icon, Pill } from '../ui/index.ts';
import { navigate } from './router.ts';

/** Service switcher on the left; the run control (start/stop) on the right. */
export function Topbar() {
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
        <button className="chip-run" onClick={() => navigate('monitor')}>
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
              if (await attempt(() => api.startRun(current.id))) navigate('monitor');
            }}
          >
            <Icon name="play" size={14} />
            테스트 실행
          </button>
        ))}
    </header>
  );
}
