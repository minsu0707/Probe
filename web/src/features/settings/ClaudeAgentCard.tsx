import { useState } from 'react';
import { api, type ClaudeAgentStatus, type ClaudeProfile } from '../../core/api.ts';
import { attempt, refreshClaude, useStore } from '../../core/store.ts';
import { CopyButton, Icon, Pill, UsageMeter } from '../../ui/index.ts';

const PROFILE_HELP: Record<ClaudeProfile, string> = {
  probe: 'Probe 전용 로그인. 개인 Claude Code의 설정·훅·MCP와 섞이지 않습니다.',
  system: '이 PC의 Claude Code 로그인을 그대로 씁니다. 여기서 로그아웃하면 평소 쓰는 Claude Code도 로그아웃됩니다.',
};

const METHOD_LABEL: Record<string, string> = { 'claude.ai': 'Claude 구독', console: 'Anthropic Console (API 과금)', none: '로그인 안 됨' };

/** 에이전트 › Claude: is the CLI installed, who is it signed in as, and sign in or out from here. */
export function ClaudeAgentCard() {
  const claude = useStore((s) => s.claude);

  if (!claude) {
    return (
      <section className="panel">
        <h2>Claude Code</h2>
        <p className="muted small">상태를 확인하는 중…</p>
      </section>
    );
  }
  if (!claude.installed) return <NotInstalled />;

  const inProgress = ['starting', 'waiting', 'verifying'].includes(claude.login.phase);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Claude Code</h2>
        <div className="actions">
          <span className="muted small tabular">v{claude.version}</span>
          {claude.auth?.loggedIn ? <Pill tone="pass">로그인됨{claude.auth.plan ? ` · ${claude.auth.plan}` : ''}</Pill> : <Pill tone="warn">로그인 필요</Pill>}
        </div>
      </div>

      <ProfilePicker claude={claude} locked={inProgress} />

      {claude.auth?.loggedIn ? <Account claude={claude} /> : inProgress ? <LoginPanel claude={claude} /> : <SignIn claude={claude} />}

      <Permissions claude={claude} />
    </section>
  );
}

function NotInstalled() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Claude Code</h2>
        <Pill tone="fail">설치되어 있지 않음</Pill>
      </div>
      <p>
        학습과 테스트 작성에는 Claude Code가 필요합니다. 설치한 뒤 새로고침하세요. 설치 방법은 <a href="https://code.claude.com/docs" target="_blank" rel="noreferrer noopener">Claude Code 문서</a>에 있습니다.
      </p>
      <div className="actions">
        <button className="btn" onClick={() => void attempt(refreshClaude)}>
          <Icon name="refresh" size={14} />
          새로고침
        </button>
      </div>
    </section>
  );
}

function ProfilePicker({ claude, locked }: { claude: ClaudeAgentStatus; locked: boolean }) {
  const choose = (profile: ClaudeProfile) => profile !== claude.profile && void attempt(() => api.setClaudeProfile(profile));
  return (
    <div className="field">
      <span className="label">로그인 위치</span>
      <div className="seg-control" role="radiogroup" aria-label="로그인 위치">
        {(['probe', 'system'] as const).map((p) => (
          <button key={p} role="radio" aria-checked={claude.profile === p} className={claude.profile === p ? 'on' : ''} disabled={locked} onClick={() => choose(p)}>
            {p === 'probe' ? 'Probe 전용' : '내 Claude Code'}
          </button>
        ))}
      </div>
      <span className="hint">{PROFILE_HELP[claude.profile]}</span>
    </div>
  );
}

function Account({ claude }: { claude: ClaudeAgentStatus }) {
  const a = claude.auth!;
  return (
    <>
      <dl className="facts">
        <dt>계정</dt>
        <dd>{a.email ?? '—'}</dd>
        <dt>요금제</dt>
        <dd>{[a.plan, a.organization].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>방식</dt>
        <dd>{METHOD_LABEL[a.method] ?? a.method}</dd>
        <dt>사용량</dt>
        <dd>{claude.usage ? <UsageMeter usage={claude.usage} /> : '백그라운드 작업을 한 번 실행하면 표시됩니다'}</dd>
        <dt>설정 폴더</dt>
        <dd className="mono-wrap">{a.configDirectory ?? '—'}</dd>
      </dl>
      <div className="actions">
        <button className="btn" onClick={() => void attempt(api.claudeLogout, '로그아웃했습니다')}>
          로그아웃
        </button>
        <button className="btn btn-quiet" onClick={() => void attempt(refreshClaude)}>
          <Icon name="refresh" size={14} />
          새로고침
        </button>
      </div>
    </>
  );
}

function SignIn({ claude }: { claude: ClaudeAgentStatus }) {
  const [method, setMethod] = useState<'claudeai' | 'console'>('claudeai');
  const [email, setEmail] = useState('');
  const { login, systemAuth } = claude;

  return (
    <>
      {systemAuth && (
        <div className="callout">
          <strong>이 PC의 Claude Code는 이미 로그인되어 있습니다.</strong>
          <span className="muted small">{[systemAuth.email, systemAuth.plan].filter(Boolean).join(' · ')}</span>
          <button className="btn btn-primary btn-sm" onClick={() => void attempt(() => api.setClaudeProfile('system'))}>
            그 로그인 사용하기
          </button>
        </div>
      )}
      {(login.phase === 'failed' || login.phase === 'cancelled') && login.message && <p className={login.phase === 'failed' ? 'error-text' : 'muted'}>{login.message}</p>}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(() => api.startClaudeLogin({ method, email: email.trim() || undefined }));
        }}
      >
        <div className="row-fields">
          <div className="field">
            <label htmlFor="login-method">로그인 방식</label>
            <select id="login-method" value={method} onChange={(e) => setMethod(e.target.value as 'claudeai' | 'console')}>
              <option value="claudeai">Claude 구독 (Pro, Max, Team 등)</option>
              <option value="console">Anthropic Console (API 과금)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="login-email">이메일 (선택)</label>
            <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="로그인 페이지에 미리 채웁니다" autoComplete="off" />
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary">Claude로 로그인</button>
          <span className="muted small">브라우저가 열립니다. Probe는 비밀번호나 토큰을 보지 않습니다.</span>
        </div>
      </form>
    </>
  );
}

/** The browser step happens outside Probe: open the page, then paste back the code it shows. */
function LoginPanel({ claude }: { claude: ClaudeAgentStatus }) {
  const [code, setCode] = useState('');
  const { login } = claude;

  return (
    <div className="login-steps">
      <ol>
        <li>
          <span>브라우저에서 로그인합니다. 자동으로 열리지 않았다면 아래 링크를 여세요.</span>
          {login.url ? (
            <span className="actions">
              <a className="btn btn-sm" href={login.url} target="_blank" rel="noreferrer noopener">
                <Icon name="external" size={14} />
                로그인 페이지 열기
              </a>
              <CopyButton text={login.url} label="링크 복사" />
            </span>
          ) : (
            <span className="muted small">로그인 주소를 기다리는 중…</span>
          )}
        </li>
        <li>
          <span>로그인 후 화면에 나오는 코드를 붙여넣습니다.</span>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(() => api.submitClaudeCode(code)).then((ok) => ok && setCode(''));
            }}
          >
            <label htmlFor="login-code" className="sr">
              로그인 코드
            </label>
            <input id="login-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="코드 붙여넣기" autoComplete="off" spellCheck={false} disabled={!login.needsCode} />
            <button className="btn btn-primary" disabled={!login.needsCode || !code.trim()}>
              확인
            </button>
          </form>
        </li>
      </ol>
      {login.message && <p className="muted" role="status">{login.message}</p>}
      <div className="actions">
        <button className="btn" onClick={() => void attempt(api.cancelClaudeLogin)}>
          취소
        </button>
      </div>
    </div>
  );
}

function Permissions({ claude }: { claude: ClaudeAgentStatus }) {
  return (
    <div className="field">
      <span className="label">백그라운드 작업이 할 수 있는 일</span>
      <div className="chips" aria-label="허용된 도구">
        {claude.allowedTools.map((t) => (
          <code key={t} className="chip chip-allow">
            {t.replace('mcp__claude_ai_', '')}
          </code>
        ))}
        {claude.deniedTools.map((t) => (
          <code key={t} className="chip chip-deny" title="차단됨">
            {t}
          </code>
        ))}
      </div>
      <span className="hint">초록은 허용, 빗금은 차단. 승인할 사람이 없는 백그라운드 작업이라 파일 읽기·쓰기만 허용하고 셸과 웹은 막습니다.</span>
    </div>
  );
}
