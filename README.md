**English** · [한국어](README.ko.md)

# Probe

Local test-automation dashboard. Claude writes the Playwright specs; Probe stores services and credentials, learns the domain from documents, runs the tests, and shows the run live.

## Setup (once)

Run these inside the Probe folder (the folder that contains this README):

```
npm install
npm run build
```

Requires Node 24+ (runs TypeScript directly and uses the built-in `node:sqlite`) and the Claude Code CLI on `PATH`. Learning runs `claude -p`; sign in under **설정 → Claude Code** (a browser opens, then you paste the code it shows). The status bar shows your 5-hour and 7-day usage, as last reported by a background job. By default Probe keeps its own sign-in in `data/claude`, separate from your personal Claude Code; one click switches to your existing login instead.

Optional: let your own Claude Code open Probe and run tests for you. Press **설정 → 연동 → 등록하기** (it runs `claude mcp add` for you and shows the output), or register it by hand once, from any folder. Replace the path with the full path of this folder (the settings page in the dashboard shows the command with your real path filled in):

```
claude mcp add --scope user probe -- node "C:\full\path\to\probe\mcp\server.ts"
```

## Start

| How | What happens |
|---|---|
| Double-click **`Probe.cmd`** | Starts the server if needed and opens the dashboard at `http://127.0.0.1:4317`. If it is already running, it only opens the browser. |
| `npm run shortcut` | Puts a "Probe" shortcut on the Desktop that does the same. |
| `npm run autostart:on` | Starts the server (no window, no browser) when you log in to Windows. Undo with `npm run autostart:off`. |
| Ask Claude "open Probe" | Same as `Probe.cmd`, if you registered the MCP server above. |
| `npm start` | Runs the server in the current terminal. |

To stop it: `Probe-stop.cmd` or `npm run stop`. It refuses while a test run or learning job is active; add `--force` to stop anyway. The server log is `data/probe.log`.

## Desktop app (installer)

```
npm run dist       # builds release/Probe-Setup-<version>.exe
npm run pack       # same app as an unpacked folder: release/win-unpacked/Probe.exe (for testing)
npm run desktop    # run the desktop app from source
```

The installer is per-user (no admin rights), adds Start-menu and Desktop shortcuts, and starts Probe in its own window. Closing the window hides it to the tray so runs continue; **종료** in the tray menu quits and stops the server. The tray menu also has "start at Windows login". Installed builds keep their data in `%APPDATA%\Probe`.

Tests run in the installed Microsoft Edge (or Chrome) by default, so nothing extra is downloaded. Set `PROBE_BROWSER=chromium` to use Playwright's own browser (`npx playwright install chromium`).

The installer is not code-signed, so Windows SmartScreen may warn about an unknown publisher: choose "More info → Run anyway". Because npm blocks install scripts by default, `npm install` approves only Electron's (`allowScripts` in `package.json`).

## Updates

The installed app checks GitHub Releases when it starts and every 6 hours, downloads a newer version in the background, and installs it when you quit the app or press **설정 → 일반 → 재시작해서 설치**. It never restarts by itself while work is running. Your services and sign-ins live in `%APPDATA%\Probe` and are kept.

To publish a version (maintainers): commit your work, then `npm run release` (or `-- minor`, `-- major`, `-- 1.4.0`). It bumps the version, runs typecheck and tests, pushes, builds the installer and uploads it to a GitHub Release using your `gh` login.

## Use

The sidebar lists your services (`+` adds one). Each service opens its own tabs, with a live badge on the tab that is busy; a status bar at the bottom shows the server, Claude and any running work.

| Tab | What it does |
|---|---|
| 개요 (Overview) | Name, address, notes; drop a `.env` or passphrase-protected `.enc` file; delete the service. |
| 도메인 학습 (Domain learning) | Upload documents or add Drive links, press Start learning. Claude writes cited knowledge files that it reads before writing tests. |
| Claude 세션 (Claude sessions) | **테스트 작성** asks Claude to read the knowledge files and write specs into `tests/specs/`; keep talking to it to refine them (the session is resumed with `--resume`). Claude can read and write files only: no shell, no web. Press **테스트 실행** to run what it wrote. One session works per service at a time. |
| 실시간 모니터링 (Live monitor) | Current page, feature, screen and step; counts; live browser frame; progress log. |
| 결과 · 결함 (Results · Defects) | Failed tests become deduplicated defect candidates with screenshot and trace. |

**설정 (Settings)** is a full page with its own menu: 에이전트 (Claude account and permissions), 자격 증명 · 보안, 브라우저, 일반, 연동 (MCP, Drive).

The interface is in Korean.

## Develop

```
npm run dev        # server with auto-restart
npm run web        # Vite dev server on :5173 (proxies to :4317)
npm run typecheck
npm test           # unit tests, ~1 s
npm run smoke      # end-to-end against a real server and Playwright, ~20 s
```

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first: it explains the module layout, the dependency rules, how one test run flows through the system, and how to add a feature.

## Layout

```
shared/    contracts shared by server, reporter and web
server/    core/ (db, crypto, hub) · http/ · modules/<feature>/{repository,service,routes}
reporter/  Playwright reporter and fixture
mcp/       MCP server for Claude
web/src/   app/ · core/ · ui/ · features/<feature>/ · styles/
tests/     unit tests          scripts/  smoke test
data/      git-ignored: probe.db, master.key, per-service docs/knowledge/tests
```

`data/` holds the encrypted credentials and the key that opens them. Back up `master.key` together with `probe.db`.

The Claude skill that tells Claude how to write specs is in `claude-skill/SKILL.md`; copy it to `.claude/skills/probe/` in the workspace where you run Claude.
