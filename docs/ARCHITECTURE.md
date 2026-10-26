**English** · [한국어](ARCHITECTURE.ko.md)

# Probe architecture

Probe is a test-automation dashboard that runs on one PC. Claude writes the Playwright tests; Probe stores services, credentials and domain documents, runs the tests, and shows progress on screen.

## 1. Overview

```
 User ── "open Probe" ──▶ Claude Code
                              │ MCP (stdio)
                              ▼
                       mcp/server.ts ──── HTTP ────┐
                                                   ▼
 Browser ◀── WebSocket /ws ── server/ (Hono + SQLite) ◀── HTTP /api ── Browser (React)
                              │   ▲
                    spawn     │   │ POST /api/ingest (events, frames)
                              ▼   │
                       Playwright process
                       └ reporter/ (probe-reporter.ts, fixture.ts)
                              │
                              ▼
                       Service under test

 Learn button ──▶ server ── spawn ──▶ `claude -p` ──▶ data/services/<id>/knowledge/*.md
```

There are three kinds of process: the **server** (always one), **Playwright** (one per run, started by the server) and **claude -p** (one per learning job, started by the server). The MCP server is a thin translator that calls the server; it holds no state.

## 2. Folder layout

```
shared/          Contracts used by server, reporter and web. No runtime code.
  models.ts        Data shapes (Service, RunSummary, Defect …)
  events.ts        IngestEvent (Playwright → server), ServerMessage (server → browser)
server/
  main.ts          Entry point: open DB → prepare workspaces → start HTTP + WebSocket
  config.ts        Paths and port. File locations are defined only here
  core/            Feature-independent foundation: db, schema, crypto, errors, hub, process, ids
  http/            App assembly (app), security guard, body validation, static files
  modules/<name>/  Vertical slice per feature (see section 3)
reporter/        Playwright side: probe-reporter (sends events), fixture (page, frames), transport
mcp/             MCP server for Claude
desktop/         Electron shell (window, tray, server lifecycle) and icons
web/src/
  app/             Shell: App, Sidebar (services), ServiceTabs, StatusBar, router
  core/            api (HTTP client), store (state), socket (WebSocket), format
  ui/              Reusable components (Pill, Modal, FileDrop, Markdown …)
  features/<name>/ One folder per screen: services, learn, monitor, results, settings
  styles/          tokens → base → shell → components → pages → responsive
tests/           Unit tests for pure logic (node:test)
scripts/        Launchers (launch, stop, autostart, shortcut) and the end-to-end smoke test
```

## 3. Server modules

Every module has the same three layers.

| Layer | File | Responsibility | Does not |
|---|---|---|---|
| repository | `repository.ts` | SQL and row ↔ object mapping | decide rules, broadcast |
| service | `service.ts` | Business rules, validation, broadcasting | touch SQL or HTTP |
| routes | `routes.ts` | URL ↔ service calls, input validation | decide rules |

Pure computation (no side effects) lives in its own file. It is easy to test, and changing a rule means opening one place.

| Module | Responsibility | Pure logic |
|---|---|---|
| `services` | Register, edit, delete services; workspace folders; the list summary (`overview.ts`) | `normalizeUrl` |
| `secrets` | Import/export .env and .enc; environment for the test process | `classify.ts` (which keys are sensitive) |
| `documents` | Store files and Drive links; extract text from Office files | `ooxml.ts` |
| `learning` | Run `claude -p`, show progress, read and edit knowledge files | `prompt.ts`, `stream.ts` |
| `agents` | Detect the Claude CLI, sign in from the app, choose the profile, tool policy for background jobs, last reported usage | `claude-cli.ts` |
| `sessions` | Conversations with Claude about a service ("테스트 작성", chat). One `claude -p` per message, continued with `--session-id` / `--resume`; one running turn per service | `service.ts`, `prompt.ts` |
| `runs` | Start/stop Playwright, receive events, aggregate state | `reduce.ts`, `redact.ts` |
| `defects` | Turn failures into defects, merge duplicates, triage | `classify.ts` |

### Dependency direction

```
routes → service → repository → core
                 ↘ another module's service (only in the directions below)

services  ←  secrets, documents, learning, runs      (check the service exists)
defects   ←  runs                                    (record failures)
secrets   ←  runs                                    (env vars, values to mask)
documents ←  learning                                (document list)
agents    ←  learning, sessions                      (signed-in check, environment, tool policy, usage)
learning  ←  sessions                                (stream parser, knowledge files)
services/overview.ts reads all of the above → nothing imports overview
```

A cycle means the design is wrong. A new feature importing `services` is fine; `services` importing a new feature is not (`overview.ts` is the one exception).

## 4. What happens during one run

1. The user presses **Run tests** (or Claude calls the MCP tool `run_tests`). → `runs/service.startRun`
2. The service creates a run row, issues a run token and prepares the list of secret values to mask (`redactionForms`).
3. `launcher.launchPlaywright` spawns the Playwright CLI inside the service workspace, passing decrypted environment variables and `PROBE_API/RUN_ID/TOKEN`.
4. Inside Playwright, `reporter/` posts events to `POST /api/ingest/:runId` (token in a header). The fixture posts a small JPEG to `/frame` every 1.2 seconds.
5. For each batch, `runs/ingest.ingestEvents` does: `scrubDeep` (mask secrets) → `reduceEvents` (pure, updates state) → store and broadcast log lines → `defects.recordFailure` for failures → `persist`.
6. The browser receives WebSocket messages in `core/socket.ts` and applies them to `core/store.ts`. Screens subscribe to the store.
7. When the process exits, `finishRun` settles the result. A run in which no test executed is an **error**, not a pass.

The authoritative state of a live run is in memory (`runs/live.ts`); every change is also written to the database. After a server restart, `recoverInterrupted()` closes rows left as "running".

## 5. Security model

| Threat | Defence | Where |
|---|---|---|
| Another web page calls localhost (DNS rebinding) | `Host` header check | `http/guard.ts`, `main.ts` (WebSocket) |
| Cross-site write requests | `Origin` check on writes | `http/guard.ts` |
| Only the DB file leaks | Values are AES-256-GCM; the key is a separate file | `core/crypto.ts` |
| Password printed in logs or defects | Mask values in test-process output | `runs/redact.ts` |
| Secret values shown on screen or sent to Claude | Sensitive variables return their name only | `secrets/service.listSecrets` |
| Forged ingest events copying arbitrary files | Attachment paths must be inside the service workspace | `defects/attachments.ts` |
| Malicious HTML in knowledge documents | Everything escaped; http(s) links only | `web/src/ui/markdown.ts` |
| Anthropic credentials | Probe never handles them: it runs the official `claude` CLI. The sign-in code the user pastes is written to the CLI's stdin and neither stored nor logged | `agents/service.ts` |
| Learning job using a shell or the web | `--disallowedTools Bash WebFetch WebSearch` | `learning/prompt.ts` |

Known limitation: Playwright traces (`.zip`) and screenshots can contain typed values and are not masked.

## 6. How to add a feature

**A server feature** (for example, notifications)
1. Create `server/modules/notifications/` with `repository.ts`, `service.ts`, `routes.ts`. Put any computation in a pure file.
2. If it needs a table, add `CREATE TABLE IF NOT EXISTS` to `core/schema.ts`.
3. Mount it in `http/app.ts`: `app.route('/api', notificationsRoutes)`.
4. For changes the browser must know about, add a type to `ServerMessage` in `shared/events.ts` and send it with `core/hub.broadcast`.

**A screen**
1. Create the page component in `web/src/features/<name>/`. Add server calls to `core/api.ts`.
2. Add it as a tab of a service (`TABS` in `app/router.ts`, `TAB_DEFS` in `app/ServiceTabs.tsx`, the switch in `app/App.tsx`), or as a settings section (`SETTINGS_SECTIONS`, `SECTIONS` in `features/settings/SettingsPage.tsx`).
3. Put shared styles in `components.css` and screen-only styles in `pages.css`. Use only the variables in `tokens.css` for colour.

**An MCP tool**: add a `registerTool` call in `mcp/server.ts`. Never return a secret value.

## 7. Testing

| Kind | Command | Scope |
|---|---|---|
| Unit | `npm test` | Pure logic and service rules against a temporary DB. About a second |
| End-to-end | `npm run smoke` | Real server, real Playwright, a demo site. About 20 seconds |
| Types | `npm run typecheck` | Server, web, reporter and MCP |

Unit tests use `isolatedHome()` from `tests/helpers.ts` to work in a temporary folder, so they never touch the real `data/`. Pure logic (`reduce`, `redact`, `classify`, `ooxml`, `markdown`, `stream`, `prompt`) is tested directly; rules that need the DB are tested against a temporary one, as in `services.test.ts`.

## 8. What was left out on purpose

- **ORM / DI container / state-management library.** With six tables and five screens the cost outweighs the benefit.
- **Database migrations.** The schema has never changed. When it first does, introduce `schema_version` (see the header of `core/schema.ts`).
- **Multiple users / authentication.** This is a one-person tool on one PC. Access control is the localhost binding plus `guard.ts`.
- **Electron packaging.** A server plus a browser window is enough for now. The server is already an independent process, so wrapping it later is easy.
