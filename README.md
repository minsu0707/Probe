**English** · [한국어](README.ko.md)

# Probe

Local test-automation dashboard. Claude writes the Playwright specs; Probe stores services and credentials, learns the domain from documents, runs the tests, and shows the run live.

## Setup (once)

```
npm install
npm run build
claude mcp add probe -- node "<this folder>\mcp\server.ts"
```

Requires Node 24+ (runs TypeScript directly and uses the built-in `node:sqlite`) and the Claude Code CLI on `PATH` (the "학습 시작" / Start learning button runs `claude -p`, using your existing login).

## Use

Ask Claude "open Probe". The MCP server starts the dashboard on `http://127.0.0.1:4317` and opens it. Or run `npm start`.

| Menu | What it does |
|---|---|
| 서비스 (Services) | Register a service, drop a `.env` or passphrase-protected `.enc` file. |
| 도메인 학습 (Domain learning) | Upload documents or add Drive links, press Start learning. Claude writes cited knowledge files that it reads before writing tests. |
| 실시간 모니터링 (Live monitor) | Current page, feature, screen and step; counts; live browser frame; progress log. |
| 결과 · 결함 (Results · Defects) | Failed tests become deduplicated defect candidates with screenshot and trace. |

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
