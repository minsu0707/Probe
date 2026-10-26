import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../core/api.ts';
import { settingsHref, SETTINGS_SECTIONS, type SettingsSection } from '../../app/router.ts';
import { CopyButton, Icon, type IconName } from '../../ui/index.ts';
import { ClaudeAgentCard } from './ClaudeAgentCard.tsx';

interface SectionDef {
  id: SettingsSection;
  label: string;
  icon: IconName;
  blurb: string;
}

const SECTIONS: Record<SettingsSection, SectionDef> = {
  agent: { id: 'agent', label: '에이전트', icon: 'learn', blurb: '테스트를 쓰고 문서를 학습하는 AI 에이전트의 계정과 권한.' },
  security: { id: 'security', label: '자격 증명 · 보안', icon: 'lock', blurb: '올린 환경 변수가 어떻게 보관되고 어디까지 전달되는지.' },
  browser: { id: 'browser', label: '브라우저', icon: 'monitor', blurb: '테스트가 실행되는 브라우저.' },
  general: { id: 'general', label: '일반', icon: 'settings', blurb: 'Probe를 켜는 방법과 데이터 위치.' },
  integrations: { id: 'integrations', label: '연동', icon: 'external', blurb: 'Claude Code와 Google Drive 연결.' },
};

/**
 * 설정: a full page with its own left menu. Nothing here is a stored preference yet; the
 * sections explain how Probe is wired, because users decide whether to upload secrets based on
 * what they read here.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const def = SECTIONS[section];
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="설정 메뉴">
        <h1>설정</h1>
        {SETTINGS_SECTIONS.map((id) => (
          <a key={id} href={settingsHref(id)} className={`svc${id === section ? ' svc-on' : ''}`} aria-current={id === section ? 'page' : undefined}>
            <Icon name={SECTIONS[id].icon} />
            <span className="svc-text">
              <span className="svc-name">{SECTIONS[id].label}</span>
            </span>
          </a>
        ))}
      </nav>
      <div className="settings-body">
        <div className="page-head">
          <div>
            <h1>{def.label}</h1>
            <p className="muted">{def.blurb}</p>
          </div>
        </div>
        <div className="stack narrow" key={section}>
          {section === 'agent' && <ClaudeAgentCard />}
          {section === 'security' && <SecuritySection />}
          {section === 'browser' && <BrowserSection />}
          {section === 'general' && <GeneralSection />}
          {section === 'integrations' && <IntegrationsSection />}
        </div>
      </div>
    </div>
  );
}

/** The server knows where it is installed and which browser it picked; fetched once per section. */
function useHealth() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  useEffect(() => void api.health().then(setHealth, () => setHealth(null)), []);
  return health;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SecuritySection() {
  return (
    <Panel title="자격 증명 보관 방식">
      <ul className="plain">
        <li>
          환경 파일의 값은 AES-256-GCM으로 암호화해 이 컴퓨터의 <code>data/probe.db</code>에 저장합니다. 암호화 키는 <code>data/master.key</code> 파일입니다.
        </li>
        <li>비밀번호, 토큰처럼 보이는 변수(이름에 pass, secret, token, key 등 포함)는 화면에 표시하지 않고, Claude에게도 이름만 전달합니다.</li>
        <li>테스트 프로세스를 시작할 때만 복호화해 환경 변수로 넣습니다. 진행 기록과 결함에 같은 값이 찍히면 ••••로 가립니다.</li>
        <li>
          서버는 <code>127.0.0.1</code>에서만 열리고, 다른 사이트에서 오는 요청은 거부합니다.
        </li>
        <li>Playwright 트레이스와 스크린샷에는 입력한 값이 담길 수 있어 가려지지 않습니다. 파일을 밖으로 공유하기 전에 확인하세요.</li>
        <li>
          <code>data</code> 폴더를 백업하거나 옮길 때는 <code>master.key</code>도 함께 옮겨야 값을 복호화할 수 있습니다.
        </li>
        <li>Claude 로그인 토큰은 Probe가 읽거나 저장하지 않습니다. 공식 Claude Code가 자기 설정 폴더에 보관합니다.</li>
      </ul>
    </Panel>
  );
}

const BROWSER_NAME = { msedge: 'Microsoft Edge', chrome: 'Google Chrome', chromium: 'Playwright Chromium' } as const;

function BrowserSection() {
  const health = useHealth();
  return (
    <Panel title="테스트 브라우저">
      <dl className="facts">
        <dt>현재 사용</dt>
        <dd><strong>{health ? BROWSER_NAME[health.browser] : '확인 중…'}</strong></dd>
      </dl>
      <p className="muted small">
        설치된 Microsoft Edge를 먼저 쓰고, 없으면 Chrome을 씁니다. 둘 다 없으면 Playwright 자체 Chromium을 쓰며, 이때는 <code>npx playwright install chromium</code>이 필요합니다. Edge와 Chrome을 쓰면 따로 내려받는 것이 없습니다.
      </p>
      <p className="muted small">
        바꾸려면 Probe를 시작하기 전에 환경 변수 <code>PROBE_BROWSER</code>를 <code>msedge</code>, <code>chrome</code>, <code>chromium</code> 중 하나로 지정하세요.
      </p>
    </Panel>
  );
}

function GeneralSection() {
  const health = useHealth();
  return (
    <>
      <Panel title="Probe 켜기">
        <ul className="plain">
          <li>
            설치한 앱은 바탕화면이나 시작 메뉴의 Probe로 엽니다. 창을 닫으면 트레이로 숨고, 트레이 메뉴의 <strong>종료</strong>를 누르면 완전히 꺼집니다.
          </li>
          <li>
            소스로 쓸 때는 Probe 폴더의 <code>Probe.cmd</code>를 더블클릭하면 서버가 켜지고 브라우저에 이 화면이 열립니다.
          </li>
          <li>
            <code>npm run autostart:on</code>을 실행하면 Windows에 로그인할 때 창 없이 자동으로 켜집니다. 끄려면 <code>npm run autostart:off</code>.
          </li>
          <li>
            끄려면 <code>Probe-stop.cmd</code> 또는 <code>npm run stop</code>. 테스트나 학습이 진행 중이면 거절합니다.
          </li>
        </ul>
      </Panel>
      <Panel title="데이터 위치">
        <dl className="facts">
          <dt>버전</dt>
          <dd>{health?.version ?? '…'}</dd>
          <dt>설치 위치</dt>
          <dd className="mono-wrap">{health?.root ?? '…'}</dd>
        </dl>
        <p className="muted small">
          서비스별 문서, 지식 문서, 테스트 코드는 데이터 폴더의 <code>services/&lt;서비스 ID&gt;/</code> 아래에 있습니다. 테스트 코드는 <code>tests/specs/</code>에 Claude가 작성합니다. 서버 로그는 <code>probe.log</code>입니다. 소스로 쓰면 데이터 폴더는 <code>data/</code>, 설치한 앱은 <code>%APPDATA%\Probe</code>이고, <code>PROBE_HOME</code> 환경 변수로 바꿀 수 있습니다.
        </p>
      </Panel>
    </>
  );
}

function IntegrationsSection() {
  const health = useHealth();
  const command = `claude mcp add --scope user probe -- node "${health?.root ?? '<Probe 폴더 전체 경로>'}\\mcp\\server.ts"`;
  return (
    <>
      <Panel title="Claude Code에서 Probe 쓰기 (MCP)">
        <p>
          Claude Code에 Probe를 MCP 서버로 등록하면 “Probe 열어줘”, “{'{서비스}'} 테스트 돌려줘” 같은 요청으로 이 대시보드가 열리고 테스트가 실행됩니다. 아래 명령을 터미널에서 한 번만 실행하세요. 경로는 이 Probe가 설치된 위치로 이미 채워져 있습니다.
        </p>
        <div className="code-line">
          <code>{command}</code>
          <CopyButton text={command} />
        </div>
        <p className="muted small">
          <code>--scope user</code>는 어느 폴더에서 Claude Code를 열어도 Probe 도구가 보이게 합니다. 등록 후 Claude가 쓸 수 있는 도구: 대시보드 열기, 서비스 조회, 지식 읽기, 테스트 실행, 결함 조회·등록·분류.
        </p>
      </Panel>
      <Panel title="Google Drive">
        <p className="muted small">
          도메인 학습에서 Drive 링크를 추가하면, 학습을 실행하는 Claude가 자기 계정에 연결된 Google Drive 커넥터로 문서를 읽습니다. 연결은 claude.ai의 설정에서 한 번 하면 됩니다. Probe는 Drive 계정 정보를 따로 받지 않습니다.
        </p>
      </Panel>
    </>
  );
}
