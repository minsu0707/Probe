import { useUpdateState } from '../core/desktop.ts';
import { useStore } from '../core/store.ts';
import { UsageMeter } from '../ui/index.ts';
import { goService, settingsHref } from './router.ts';

/** Always-visible footer: is the server up, can Claude be used, is anything running. */
export function StatusBar() {
  const connected = useStore((s) => s.connected);
  const claude = useStore((s) => s.claude);
  const running = useStore((s) => s.services.find((x) => x.activeRun));
  const learning = useStore((s) => s.services.find((x) => x.learning));
  const working = useStore((s) => s.services.find((x) => x.claudeWorking));

  const update = useUpdateState();
  const claudeOk = Boolean(claude?.installed && claude.auth?.loggedIn);
  const claudeText = !claude ? 'Claude 확인 중…' : !claude.installed ? 'Claude Code 없음' : claude.auth?.loggedIn ? `Claude · ${claude.auth.email ?? '로그인됨'}${claude.auth.plan ? ` · ${claude.auth.plan}` : ''}` : 'Claude 로그인 필요';
  const run = running?.activeRun;

  return (
    <footer className="statusbar">
      <span className="status-item">
        <span className={`dot ${connected ? 'dot-ok' : 'dot-bad'}`} />
        {connected ? '서버 연결됨' : '서버 연결 끊김 · 재연결 중'}
      </span>
      {claude && (
        <a className="status-item status-link" href={settingsHref('agent')} title="에이전트 설정">
          <span className={`dot ${claudeOk ? 'dot-ok' : 'dot-warn'}`} />
          {claudeText}
        </a>
      )}
      {claude?.usage && <UsageMeter usage={claude.usage} />}
      <span className="spacer" />
      {update?.phase === 'ready' && (
        <a className="status-item status-link" href={settingsHref('general')} title="설정에서 설치">
          <span className="dot dot-ok" />
          업데이트 {update.version} 준비됨
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
