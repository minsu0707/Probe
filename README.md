# Probe

Local test-automation dashboard. Claude writes the Playwright specs; Probe stores services and credentials, learns the domain from documents, runs the tests, and shows the run live.

## Setup (once)

```
npm install
npm run build
claude mcp add probe -- node "<this folder>\mcp\server.ts"
```

Requires Node 24+ (runs TypeScript directly and uses the built-in `node:sqlite`) and the Claude Code CLI on `PATH` (the "학습 시작" button runs `claude -p`, using your existing login).

## Use

Ask Claude "Probe 열어줘". The MCP server starts the dashboard on `http://127.0.0.1:4317` and opens it. Or run `npm start`.

| Menu | What it does |
|---|---|
| 서비스 | Register a service, drop a `.env` or passphrase-protected `.enc` file. |
| 도메인 학습 | Upload documents or add Drive links, press 학습 시작. Claude writes cited knowledge files that it reads before writing tests. |
| 실시간 모니터링 | Current page, feature, screen and step; counts; live browser frame; progress log. |
| 결과 · 결함 | Failed tests become deduplicated defect candidates with screenshot and trace. |

Frontend development: `npm run dev` (server) and `npm run web` (Vite on :5173, proxies to :4317).

## Layout

- `server/` Hono API, SQLite, run engine, learning job. `mcp/` stdio MCP server. `reporter/` Playwright reporter and fixture.
- `data/` (git-ignored): `probe.db`, `master.key`, and per service `docs/`, `knowledge/`, `tests/specs/`. Back up `master.key` with the database.
- The Claude skill that tells Claude how to write specs lives in `claude-skill/SKILL.md` (copy it to `.claude/skills/probe/` in the workspace where you run Claude).
