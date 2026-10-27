[English](README.md) · **한국어**

# Probe

내 PC에서 도는 테스트 자동화 대시보드입니다. Claude가 Playwright 테스트를 쓰고, Probe는 서비스와 자격 증명을 보관하고, 문서에서 도메인을 학습하고, 테스트를 실행하고, 진행 상황을 실시간으로 보여줍니다.

## 설치 (한 번만)

Probe 폴더 안(이 README가 있는 폴더)에서 실행합니다.

```
npm install
npm run build
```

Node 24 이상(TypeScript를 바로 실행하고 내장 `node:sqlite`를 씁니다)과, `PATH`에 Claude Code CLI가 필요합니다. 학습은 `claude -p`를 실행하며, **설정 → Claude Code**에서 로그인합니다(브라우저가 열리고, 거기에 나오는 코드를 붙여넣습니다). 하단 상태 줄에 5시간·7일 사용량이 보입니다(마지막 백그라운드 작업이 보고한 값). 기본값은 Probe 전용 로그인(`data/claude`)이라 개인 Claude Code와 섞이지 않고, 버튼 한 번으로 기존 로그인을 쓰도록 바꿀 수 있습니다.

선택 사항: 평소 쓰는 Claude Code가 Probe를 열고 테스트를 돌려주게 하려면 **설정 → 연동 → 등록하기**를 누릅니다(`claude mcp add`를 대신 실행하고 출력을 보여줍니다). 직접 하려면 아무 폴더에서나 한 번 실행하면 됩니다. 경로는 이 폴더의 전체 경로로 바꾸세요(대시보드 설정 화면에 실제 경로가 채워진 명령이 있습니다).

```
claude mcp add --scope user probe -- node "C:\전체\경로\probe\mcp\server.ts"
```

## 켜기

| 방법 | 동작 |
|---|---|
| **`Probe.cmd`** 더블클릭 | 서버가 꺼져 있으면 켜고 `http://127.0.0.1:4317`에서 대시보드를 엽니다. 이미 켜져 있으면 브라우저만 엽니다. |
| `npm run shortcut` | 같은 동작을 하는 "Probe" 바로가기를 바탕화면에 만듭니다. |
| `npm run autostart:on` | Windows에 로그인할 때 서버를 창과 브라우저 없이 자동으로 켭니다. 되돌리려면 `npm run autostart:off`. |
| Claude에게 "Probe 열어줘" | 위 MCP를 등록했다면 `Probe.cmd`와 같습니다. |
| `npm start` | 현재 터미널에서 서버를 실행합니다. |

끄려면 `Probe-stop.cmd` 또는 `npm run stop`을 실행합니다. 테스트나 학습이 진행 중이면 거절하고, `--force`를 붙이면 그래도 끕니다. 서버 로그는 `data/probe.log`입니다.

## 데스크톱 앱 (설치 파일)

```
npm run dist       # release/Probe-Setup-<버전>.exe 생성
npm run pack       # 같은 앱을 풀어진 폴더로 생성: release/win-unpacked/Probe.exe (테스트용)
npm run desktop    # 소스에서 데스크톱 앱 실행
```

설치 파일은 사용자 단위(관리자 권한 불필요)로 설치되고, 시작 메뉴와 바탕화면에 바로가기를 만들며, Probe 전용 창으로 열립니다. 창을 닫으면 트레이로 숨어서 실행이 계속되고, 트레이 메뉴의 **종료**를 누르면 서버까지 완전히 종료됩니다. 트레이 메뉴에서 "Windows 로그인 시 자동 시작"도 켤 수 있습니다. 설치된 앱의 데이터는 `%APPDATA%\Probe`에 저장됩니다.

테스트는 기본적으로 설치된 Microsoft Edge(없으면 Chrome)로 실행하므로 따로 내려받는 것이 없습니다. Playwright 자체 브라우저를 쓰려면 `PROBE_BROWSER=chromium`을 지정하고 `npx playwright install chromium`을 실행하세요.

설치 파일에는 코드 서명이 없어서 Windows SmartScreen이 "알 수 없는 게시자" 경고를 띄울 수 있습니다. "추가 정보 → 실행"을 누르면 됩니다. npm은 설치 스크립트를 기본으로 막기 때문에, `package.json`의 `allowScripts`에서 Electron의 스크립트만 허용해 두었습니다.

## 업데이트

설치한 앱은 시작할 때, 30분마다, 그리고 창으로 돌아올 때(5분에 한 번까지) GitHub Releases에서 새 버전을 확인하고, 있으면 백그라운드로 내려받습니다. 작업이 없고 창이 앞에 있지 않을 때 저절로 재시작해서 설치하며, **설정 → 일반 → 재시작해서 설치**를 누르거나 앱을 종료할 때도 설치됩니다. 기록은 데이터 폴더의 `update.log`에 남습니다. 서비스와 로그인 정보는 `%APPDATA%\Probe`에 있어서 그대로 유지됩니다.

새 버전을 배포하려면(관리자): 작업을 커밋한 뒤 `npm run release`(또는 `-- minor`, `-- major`, `-- 1.4.0`)를 실행합니다. 버전을 올리고 타입 검사와 테스트를 돌린 다음, 푸시하고 설치 파일을 만들어 `gh` 로그인으로 GitHub Release에 올립니다.

## 사용

왼쪽 사이드바에 서비스 목록이 있습니다(`+`로 추가). 서비스를 열면 탭이 나오고, 일하는 중인 탭에는 실시간 표시가 붙습니다. 맨 아래 상태 줄에는 서버, Claude, 진행 중인 작업이 보입니다.

| 탭 | 하는 일 |
|---|---|
| 개요 | 이름·주소·메모, `.env` 또는 암호로 보호한 `.enc` 파일 올리기, 서비스 삭제. |
| 도메인 학습 | 문서를 올리거나 Drive 링크를 추가하고 학습 시작을 누릅니다. Claude가 출처가 달린 지식 문서를 쓰고, 테스트를 쓰기 전에 읽습니다. |
| Claude 세션 | **테스트 작성**은 Claude가 지식 문서를 읽고 `tests/specs/`에 테스트를 쓰게 합니다. 이어서 대화하며 고쳐 나갑니다(`--resume`로 같은 세션을 이어갑니다). Claude는 파일 읽기·쓰기만 할 수 있고 셸과 웹은 쓰지 못합니다. 쓴 테스트는 **테스트 실행**으로 돌립니다. 서비스마다 한 번에 한 세션만 일합니다. |
| 실시간 모니터링 | 현재 페이지·기능·화면·단계, 집계, 라이브 브라우저 화면, 진행 기록. |
| 결과 · 결함 | 실패한 테스트가 스크린샷·트레이스가 붙은 결함 후보로 만들어지고, 같은 원인은 한 건으로 묶입니다. |

**설정**은 왼쪽 메뉴가 있는 전용 화면입니다: 에이전트(Claude 계정과 권한), 자격 증명 · 보안, 브라우저, 일반, 연동(MCP, Drive).

화면은 한국어입니다.

## 개발

```
npm run dev        # 자동 재시작 서버
npm run web        # Vite 개발 서버 :5173 (:4317로 프록시)
npm run typecheck
npm test           # 단위 테스트, 약 1초
npm run smoke      # 실제 서버와 Playwright로 종단 간 테스트, 약 20초
```

먼저 [`docs/ARCHITECTURE.ko.md`](docs/ARCHITECTURE.ko.md)를 읽으세요. 모듈 구조, 의존 규칙, 테스트 한 번이 시스템을 흐르는 과정, 기능 추가 방법을 설명합니다.

## 구조

```
shared/    서버·리포터·웹이 같이 쓰는 계약
server/    core/ (db, crypto, hub) · http/ · modules/<기능>/{repository,service,routes}
reporter/  Playwright 리포터와 픽스처
mcp/       Claude용 MCP 서버
web/src/   app/ · core/ · ui/ · features/<기능>/ · styles/
tests/     단위 테스트          scripts/  스모크 테스트
data/      git 제외: probe.db, master.key, 서비스별 docs/knowledge/tests
```

`data/`에는 암호화된 자격 증명과 그것을 여는 키가 있습니다. `master.key`는 `probe.db`와 함께 백업하세요.

Claude가 테스트를 어떻게 써야 하는지 알려주는 스킬은 `claude-skill/SKILL.md`에 있습니다. Claude를 실행하는 작업공간의 `.claude/skills/probe/`로 복사해서 쓰세요.
