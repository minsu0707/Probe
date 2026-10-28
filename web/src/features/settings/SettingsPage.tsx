import { useEffect, useState } from 'react';
import { api } from '../../core/api.ts';
import { setTheme, useTheme } from '../../core/theme.ts';
import { settingsHref, SETTINGS_SECTIONS, type SettingsSection } from '../../app/router.ts';
import { Icon, type IconName } from '../../ui/index.ts';
import { ClaudeAgentCard } from './ClaudeAgentCard.tsx';
import { McpRows } from './McpCard.tsx';
import { Group, Row } from './Rows.tsx';
import { AutoInstallRow, UpdateRows } from './UpdateCard.tsx';

const SECTIONS: Record<SettingsSection, { label: string; icon: IconName }> = {
  agent: { label: '에이전트', icon: 'learn' },
  security: { label: '자격 증명 · 보안', icon: 'lock' },
  browser: { label: '브라우저', icon: 'monitor' },
  general: { label: '일반', icon: 'settings' },
  integrations: { label: '연동', icon: 'external' },
};

/**
 * 설정: its own left menu, and rows instead of paragraphs. Most of it is read-only: it says how
 * Probe is wired, because users decide whether to upload secrets based on what they read here.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="설정 메뉴">
        <span className="eyebrow">설정</span>
        {SETTINGS_SECTIONS.map((id) => (
          <a key={id} href={settingsHref(id)} className={`svc${id === section ? ' svc-on' : ''}`} aria-current={id === section ? 'page' : undefined}>
            <Icon name={SECTIONS[id].icon} />
            <span className="svc-text">
              <span className="svc-name">{SECTIONS[id].label}</span>
            </span>
          </a>
        ))}
      </nav>
      <div className="settings-body" key={section}>
        <h1>{SECTIONS[section].label}</h1>
        {section === 'agent' && <ClaudeAgentCard />}
        {section === 'security' && <SecuritySection />}
        {section === 'browser' && <BrowserSection />}
        {section === 'general' && <GeneralSection />}
        {section === 'integrations' && <IntegrationsSection />}
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

function SecuritySection() {
  return (
    <Group>
      <Row title="암호화 저장" desc={<>환경 파일의 값은 AES-256-GCM으로 암호화해 <code>data/probe.db</code>에 저장합니다. 키는 <code>data/master.key</code>.</>} />
      <Row title="화면과 Claude에는 이름만" desc="비밀번호, 토큰처럼 보이는 변수(이름에 pass, secret, token, key 등)는 표시하지 않고 Claude에게는 이름만 전달합니다." />
      <Row title="실행할 때만 복호화" desc="테스트를 시작할 때만 환경 변수로 넣습니다. 진행 기록과 결함에 같은 값이 찍히면 ••••로 가립니다." />
      <Row title="이 컴퓨터에서만" desc={<>서버는 <code>127.0.0.1</code>에서만 열리고, 다른 사이트에서 오는 요청은 거부합니다.</>} />
      <Row title="트레이스와 스크린샷" desc="입력한 값이 담길 수 있어 가려지지 않습니다. 밖으로 공유하기 전에 확인하세요." />
      <Row title="백업과 이동" desc={<><code>data</code> 폴더를 옮길 때는 <code>master.key</code>도 함께 옮겨야 값을 복호화할 수 있습니다.</>} />
      <Row title="Claude 로그인" desc="토큰은 Probe가 읽거나 저장하지 않습니다. 공식 Claude Code가 자기 설정 폴더에 보관합니다." />
    </Group>
  );
}

const BROWSER_NAME = { msedge: 'Microsoft Edge', chrome: 'Google Chrome', chromium: 'Playwright Chromium' } as const;

function BrowserSection() {
  const health = useHealth();
  return (
    <Group>
      <Row title="테스트 브라우저" desc="설치된 Edge를 먼저, 없으면 Chrome을, 둘 다 없으면 Playwright 자체 Chromium을 씁니다.">
        <span className="set-val">{health ? BROWSER_NAME[health.browser] : '…'}</span>
      </Row>
      <Row title="바꾸기" desc={<>시작 전에 환경 변수 <code>PROBE_BROWSER</code>를 <code>msedge</code>, <code>chrome</code>, <code>chromium</code> 중 하나로 지정합니다. Chromium은 <code>npx playwright install chromium</code>이 필요합니다.</>} />
    </Group>
  );
}

function ThemeRow() {
  const theme = useTheme();
  return (
    <Row title="테마" desc="밝은 화면과 어두운 화면 중에서 고릅니다. 고르기 전에는 Windows 설정을 따릅니다.">
      <div className="theme-toggle" role="radiogroup" aria-label="테마">
        {(['light', 'dark'] as const).map((t) => (
          <button key={t} role="radio" aria-checked={theme === t} aria-label={t === 'light' ? '밝은 테마' : '어두운 테마'} title={t === 'light' ? '밝은 테마' : '어두운 테마'} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
            <Icon name={t === 'light' ? 'sun' : 'moon'} size={16} />
          </button>
        ))}
      </div>
    </Row>
  );
}

function GeneralSection() {
  const health = useHealth();
  return (
    <>
      <Group title="화면">
        <ThemeRow />
      </Group>
      <Group title="업데이트">
        <UpdateRows version={health?.version} />
        <AutoInstallRow />
      </Group>
      <Group title="실행">
        <Row title="설치한 앱" desc="바탕화면이나 시작 메뉴의 Probe. 창을 닫으면 트레이로 숨고, 트레이 메뉴의 종료로 완전히 꺼집니다." />
        <Row title="소스로 실행" desc={<><code>Probe.cmd</code> 더블클릭. 끄려면 <code>Probe-stop.cmd</code>. Windows 로그인 때 자동으로 켜려면 <code>npm run autostart:on</code>.</>} />
      </Group>
      <Group title="데이터">
        <Row title="설치 위치">
          <span className="set-val">{health?.root ?? '…'}</span>
        </Row>
        <Row title="데이터 폴더" desc={<>서비스별 문서, 지식 문서, 테스트 코드가 <code>services/&lt;ID&gt;/</code> 아래에 있고 로그는 <code>probe.log</code>입니다. 소스 실행은 <code>data/</code>, 설치한 앱은 <code>%APPDATA%\Probe</code>. <code>PROBE_HOME</code>으로 바꿀 수 있습니다.</>} />
      </Group>
    </>
  );
}

function IntegrationsSection() {
  return (
    <>
      <Group title="Claude Code">
        <McpRows />
      </Group>
      <Group title="Google Drive">
        <Row title="문서 읽기" desc="도메인 학습에서 Drive 링크를 추가하면 Claude가 자기 계정에 연결된 Drive 커넥터로 읽습니다. claude.ai 설정에서 한 번 연결하세요. Probe는 Drive 계정 정보를 받지 않습니다." />
      </Group>
    </>
  );
}
