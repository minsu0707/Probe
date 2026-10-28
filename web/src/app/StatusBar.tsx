import { useUpdateState } from '../core/desktop.ts';
import { useEffect, useRef, useState } from 'react';
import { attempt, refreshUsage, useStore } from '../core/store.ts';
import { ClaudeMark, Icon, UsageMeter, UsagePanel } from '../ui/index.ts';
import { goService, settingsHref } from './router.ts';

/** Always-visible footer: is the server up, can Claude be used, is anything running. */
export function StatusBar() {
  const connected = useStore((s) => s.connected);
  const claude = useStore((s) => s.claude);
  const running = useStore((s) => s.services.find((x) => x.activeRun));
  const learning = useStore((s) => s.services.find((x) => x.learning));
  const working = useStore((s) => s.services.find((x) => x.claudeWorking));

  const update = useUpdateState();
  const [refreshing, setRefreshing] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const usageBox = useRef<HTMLSpanElement>(null);
  // The usage popover closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!usageOpen) return;
    const away = (e: MouseEvent) => !usageBox.current?.contains(e.target as Node) && setUsageOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setUsageOpen(false);
    window.addEventListener('mousedown', away);
    const close = () => setUsageOpen(false);
    window.addEventListener('keydown', key);
    window.addEventListener('hashchange', close);
    return () => {
      window.removeEventListener('hashchange', close);
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [usageOpen]);
  const claudeOk = Boolean(claude?.installed && claude.auth?.loggedIn);
  // The icon already says "Claude", so the words only carry what differs: who is signed in, or what is wrong.
  const claudeText = !claude?.installed ? '설치되어 있지 않음' : claude.auth?.loggedIn ? `${claude.auth.email ?? '로그인됨'}${claude.auth.plan ? ` · ${claude.auth.plan}` : ''}` : '로그인 필요';
  const claudeTitle = !claude?.installed ? 'Claude Code가 설치되어 있지 않습니다' : claude.auth?.loggedIn ? 'Claude 로그인됨 · 에이전트 설정' : 'Claude 로그인이 필요합니다 · 에이전트 설정';
  const claudeTone = claudeOk ? 'claude-ok' : claude?.installed ? 'claude-warn' : 'claude-off';
  const run = running?.activeRun;

  return (
    <footer className="statusbar">
      <span className="status-item">
        <span className={`dot ${connected ? 'dot-ok' : 'dot-bad'}`} />
        {connected ? '서버 연결됨' : '서버 연결 끊김 · 재연결 중'}
      </span>
      {claude && (
        <a className="status-item status-link" href={settingsHref('agent')} title={claudeTitle} aria-label={`${claudeTitle}: ${claudeText}`}>
          <span className={`claude-mark ${claudeTone}`}>
            <ClaudeMark />
          </span>
          {claudeText}
        </a>
      )}
      {claudeOk && (
        <>
          <span className="usage-anchor" ref={usageBox}>
            <button className="status-link usage-trigger" onClick={() => setUsageOpen((o) => !o)} aria-expanded={usageOpen} aria-label="사용량 자세히 보기" title={claude?.usage ? undefined : '사용량'}>
              {claude?.usage ? <UsageMeter usage={claude.usage} /> : <span className="muted">사용량</span>}
            </button>
            {usageOpen && (
              <div className="usage-pop" role="dialog" aria-label="Claude 사용량">
                <div className="usage-pop-head">
                  <span className="claude-mark claude-ok">
                    <ClaudeMark size={16} />
                  </span>
                  <strong>Claude</strong>
                </div>
                {claude?.usage ? <UsagePanel usage={claude.usage} /> : <p className="muted small">백그라운드 작업을 한 번 실행하면 표시됩니다.</p>}
                {claude?.auth?.email && <div className="usage-pop-foot muted small">{claude.auth.email}</div>}
              </div>
            )}
          </span>
          <button
            className={`usage-refresh${refreshing ? ' is-spinning' : ''}`}
            title="사용량 새로고침"
            aria-label="사용량 새로고침"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await attempt(refreshUsage);
              setRefreshing(false);
            }}
          >
            <Icon name="refresh" size={13} />
          </button>
        </>
      )}
      <span className="spacer" />
      {update?.phase === 'ready' && (
        <a className="status-item status-link" href={settingsHref('general')} title="설정에서 설치">
          <span className="dot dot-ok" />
          업데이트 {update.newerVersion ?? update.version} {update.newerVersion ? '받는 중' : '준비됨'}
        </a>
      )}
      {working && (
        <a className="status-item status-link" href={`#/s/${encodeURIComponent(working.id)}/sessions`}>
          <span className="dot dot-live" />
          {working.name} · Claude 작업 중
        </a>
      )}
      {learning && (
        <a className="status-item status-link" href={`#/s/${encodeURIComponent(learning.id)}/learn`}>
          <span className="dot dot-live" />
          {learning.name} 학습 중
        </a>
      )}
      {running && run && (
        <button className="status-item status-link" onClick={() => goService(running.id, 'monitor')}>
          <span className="dot dot-live" />
          {running.name} 실행 중 · {run.totals.passed + run.totals.failed + run.totals.skipped}/{run.totals.total || '?'}
        </button>
      )}
    </footer>
  );
}
