import { useEffect, useState } from 'react';
import { api } from '../../core/api.ts';
import { CopyButton } from '../../ui/index.ts';

/**
 * 설정: nothing here is stored. It explains how to connect Claude and exactly how credentials
 * are handled, because users decide whether to upload secrets based on this page.
 */
export function SettingsPage() {
  // The server knows where it is installed, so the command can be copied as-is.
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => void api.health().then((h) => setRoot(h.root), () => setRoot(null)), []);

  const command = `claude mcp add --scope user probe -- node "${root ?? '<Probe 폴더 전체 경로>'}\\mcp\\server.ts"`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>설정</h1>
          <p className="muted">Claude 연결과 자격 증명이 어떻게 다뤄지는지 확인합니다.</p>
        </div>
      </div>
      <div className="stack narrow">
        <section className="panel">
          <h2>Claude 연결</h2>
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
        </section>

        <section className="panel">
          <h2>Probe 켜기</h2>
          <ul className="plain">
            <li>
              Probe 폴더의 <code>Probe.cmd</code>를 더블클릭하면 서버가 켜지고 브라우저에 이 화면이 열립니다. 이미 켜져 있으면 브라우저만 엽니다.
            </li>
            <li>
              <code>npm run shortcut</code>으로 바탕화면에 바로가기를 만들 수 있습니다.
            </li>
            <li>
              <code>npm run autostart:on</code>을 실행하면 Windows에 로그인할 때 창 없이 자동으로 켜집니다. 끄려면 <code>npm run autostart:off</code>.
            </li>
            <li>
              끄려면 <code>Probe-stop.cmd</code> 또는 <code>npm run stop</code>. 테스트나 학습이 진행 중이면 거절합니다.
            </li>
          </ul>
        </section>

        <section className="panel">
          <h2>자격 증명 보관 방식</h2>
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
          </ul>
        </section>

        <section className="panel">
          <h2>데이터 위치</h2>
          <p className="muted small">
            서비스별 문서, 지식 문서, 테스트 코드는 <code>data/services/&lt;서비스 ID&gt;/</code> 아래에 있습니다. 테스트 코드는 <code>tests/specs/</code>에 Claude가 작성합니다. 서버 로그는 <code>data/probe.log</code>입니다. 위치를 바꾸려면 서버를 <code>PROBE_HOME</code> 환경 변수와 함께 실행하세요.
          </p>
        </section>
      </div>
    </>
  );
}
