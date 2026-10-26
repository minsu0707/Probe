[English](ARCHITECTURE.md) · **한국어**

# Probe 아키텍처

Probe는 한 대의 PC에서 도는 테스트 자동화 대시보드입니다. Claude가 Playwright 테스트를 쓰고, Probe는 서비스·자격 증명·도메인 문서를 보관하고, 테스트를 실행하고, 진행 상황을 화면에 보여줍니다.

## 1. 한 장 요약

```
 사용자 ── "Probe 열어줘" ──▶ Claude Code
                                  │ MCP (stdio)
                                  ▼
                           mcp/server.ts ──── HTTP ────┐
                                                       ▼
 브라우저 ◀── WebSocket /ws ── server/ (Hono + SQLite) ◀── HTTP /api ── 브라우저(React)
                                  │   ▲
                       spawn      │   │ POST /api/ingest (이벤트, 프레임)
                                  ▼   │
                         Playwright 프로세스
                         └ reporter/ (probe-reporter.ts, fixture.ts)
                                  │
                                  ▼
                           테스트 대상 서비스

 학습 버튼 ──▶ server ── spawn ──▶ `claude -p` ──▶ data/services/<id>/knowledge/*.md
```

프로세스는 세 종류입니다. **서버**(항상 하나), **Playwright**(실행마다 하나, 서버가 띄움), **claude -p**(학습마다 하나, 서버가 띄움). MCP 서버는 서버를 부르는 얇은 번역기이고 상태가 없습니다.

## 2. 폴더 구조

```
shared/          서버·리포터·웹이 같이 쓰는 계약. 런타임 코드 없음.
  models.ts        데이터 모양 (Service, RunSummary, Defect …)
  events.ts        IngestEvent(Playwright→서버), ServerMessage(서버→브라우저)
server/
  main.ts          진입점: DB 열기 → 작업공간 준비 → HTTP+WebSocket 시작
  config.ts        경로와 포트. 파일 위치는 여기서만 정의
  core/            기능과 무관한 기반: db, schema, crypto, errors, hub, process, ids
  http/            앱 조립(app), 보안 가드(guard), 본문 검증(validate), 정적 파일(static)
  modules/<기능>/  기능 단위 세로 슬라이스 (아래 3번)
reporter/        Playwright 쪽: probe-reporter(이벤트 전송), fixture(페이지·프레임), transport
mcp/             Claude용 MCP 서버
desktop/         Electron 셸(창, 트레이, 서버 수명 관리)과 아이콘
web/src/
  app/             셸: App, Sidebar, Topbar, router
  core/            api(HTTP 클라이언트), store(상태), socket(WebSocket), format
  ui/              재사용 컴포넌트 (Pill, Modal, FileDrop, Markdown …)
  features/<기능>/ 화면 단위: services, learn, monitor, results, settings
  styles/          tokens → base → shell → components → pages → responsive
tests/           순수 로직 단위 테스트 (node:test)
scripts/        실행 스크립트(launch, stop, autostart, shortcut)와 종단 간 스모크 테스트
```

## 3. 서버 모듈

각 모듈은 같은 세 층으로 나뉩니다.

| 층 | 파일 | 책임 | 하지 않는 일 |
|---|---|---|---|
| repository | `repository.ts` | SQL과 행↔객체 변환 | 규칙 판단, 브로드캐스트 |
| service | `service.ts` | 업무 규칙, 검증, 브로드캐스트 | SQL, HTTP |
| routes | `routes.ts` | URL ↔ service 호출, 입력 검증 | 규칙 판단 |

순수 계산(부수효과 없음)은 별도 파일로 뺐습니다. 테스트하기 쉽고, 규칙을 바꿀 때 한 곳만 보면 됩니다.

| 모듈 | 맡은 일 | 순수 로직 |
|---|---|---|
| `services` | 서비스 등록·수정·삭제, 작업공간 폴더, 목록용 요약(`overview.ts`) | `normalizeUrl` |
| `secrets` | .env/.enc 가져오기·내보내기, 테스트 프로세스용 환경 변수 | `classify.ts` (민감 키 판별) |
| `documents` | 파일·Drive 링크 보관, Office 파일 텍스트 추출 | `ooxml.ts` |
| `learning` | `claude -p` 실행, 진행 표시, 지식 문서 읽기·수정 | `prompt.ts`, `stream.ts` |
| `agents` | Claude CLI 감지, 앱 안 로그인, 프로필 선택, 백그라운드 작업의 도구 정책 | `claude-cli.ts` |
| `runs` | Playwright 실행·중단, 이벤트 수신, 상태 집계 | `reduce.ts`, `redact.ts` |
| `defects` | 실패 → 결함 변환, 중복 병합, 분류 | `classify.ts` |

### 의존 방향

```
routes → service → repository → core
                 ↘ 다른 모듈의 service (아래 표의 방향으로만)

services  ←  secrets, documents, learning, runs      (서비스 존재 확인)
defects   ←  runs                                    (실패 기록)
secrets   ←  runs                                    (환경 변수, 마스킹 값)
documents ←  learning                                (자료 목록)
agents    ←  learning                                (로그인 확인, 환경, 도구 정책)
services/overview.ts 는 위 모듈을 모두 읽는다 → 아무도 overview를 import하지 않는다
```

순환이 생기면 설계가 틀린 것입니다. 새 기능이 `services`를 import하는 것은 괜찮지만, `services`가 새 기능을 import해서는 안 됩니다 (`overview.ts`만 예외).

## 4. 실행 한 번의 흐름

1. 사용자가 **테스트 실행**을 누른다 (또는 Claude가 MCP `run_tests`). → `runs/service.startRun`
2. 서비스가 실행 행을 만들고, 실행 토큰을 발급하고, 비밀 값 목록(`redactionForms`)을 준비한다.
3. `launcher.launchPlaywright`가 서비스 작업공간에서 Playwright CLI를 spawn한다. 복호화된 환경 변수와 `PROBE_API/RUN_ID/TOKEN`을 넘긴다.
4. Playwright 안에서 `reporter/`가 이벤트를 `POST /api/ingest/:runId`로 보낸다 (헤더에 토큰). 픽스처는 1.2초마다 작은 JPEG를 `/frame`으로 보낸다.
5. `runs/ingest.ingestEvents`가 이벤트 묶음마다:
   `scrubDeep`(비밀 가림) → `reduceEvents`(순수, 상태 갱신) → 로그 저장·방송 → 실패는 `defects.recordFailure` → `persist`.
6. 브라우저는 WebSocket 메시지를 `core/socket.ts`에서 받아 `core/store.ts`에 반영한다. 화면은 store를 구독한다.
7. 프로세스가 끝나면 `finishRun`이 결과를 확정한다. 한 개도 실행되지 않았으면 **통과가 아니라 오류**다.

실행 중인 run의 권위 있는 상태는 메모리(`runs/live.ts`)에 있고, 모든 변경은 DB에도 저장됩니다. 서버가 재시작되면 `recoverInterrupted()`가 "실행 중"으로 남은 행을 닫습니다.

## 5. 보안 모델

| 위협 | 대응 | 위치 |
|---|---|---|
| 같은 PC의 다른 웹페이지가 localhost를 호출 (DNS rebinding) | `Host` 헤더 검사 | `http/guard.ts`, `main.ts`(WebSocket) |
| 다른 사이트에서 오는 쓰기 요청 | 쓰기에 `Origin` 검사 | `http/guard.ts` |
| DB 파일만 유출 | 값은 AES-256-GCM, 키는 별도 파일 | `core/crypto.ts` |
| 비밀번호가 로그·결함에 찍힘 | 테스트 프로세스 출력에서 값 마스킹 | `runs/redact.ts` |
| 비밀 값이 화면·Claude에 노출 | 민감 변수는 이름만 반환 | `secrets/service.listSecrets` |
| 가짜 ingest 이벤트로 임의 파일 복사 | 첨부 경로는 서비스 작업공간 안만 허용 | `defects/attachments.ts` |
| 지식 문서의 악성 HTML | 전부 이스케이프, http(s) 링크만 | `web/src/ui/markdown.ts` |
| Anthropic 자격 증명 | Probe는 다루지 않습니다. 공식 `claude` CLI를 실행할 뿐이고, 사용자가 붙여넣은 로그인 코드는 CLI의 stdin으로만 전달하며 저장하거나 기록하지 않습니다 | `agents/service.ts` |
| 학습 작업이 셸·웹 사용 | `--disallowedTools Bash WebFetch WebSearch` | `learning/prompt.ts` |

알려진 한계: Playwright 트레이스(`.zip`)와 스크린샷에는 입력한 값이 들어갈 수 있고 마스킹되지 않습니다.

## 6. 기능을 추가하는 방법

**새 서버 기능** (예: 알림)
1. `server/modules/notifications/`에 `repository.ts`, `service.ts`, `routes.ts`를 만든다. 계산이 있으면 순수 함수 파일로 뺀다.
2. 테이블이 필요하면 `core/schema.ts`에 `CREATE TABLE IF NOT EXISTS`를 추가한다.
3. `http/app.ts`에 `app.route('/api', notificationsRoutes)`를 추가한다.
4. 브라우저가 알아야 하는 변화는 `shared/events.ts`의 `ServerMessage`에 타입을 추가하고 `core/hub.broadcast`로 보낸다.

**새 화면**
1. `web/src/features/<기능>/`에 페이지 컴포넌트를 만든다. 서버 호출은 `core/api.ts`에 함수를 추가한다.
2. `app/router.ts`의 `ROUTES`와 `app/App.tsx`, `app/Sidebar.tsx`에 등록한다.
3. 스타일은 공용이면 `components.css`, 화면 전용이면 `pages.css`에 둔다. 색은 `tokens.css`의 변수만 쓴다.

**새 MCP 도구**: `mcp/server.ts`에 `registerTool`을 추가한다. 비밀 값은 반환하지 않는다.

## 7. 테스트

| 종류 | 명령 | 범위 |
|---|---|---|
| 단위 | `npm test` | 순수 로직 + 임시 DB를 쓰는 서비스 규칙. 1초 안팎 |
| 종단 간 | `npm run smoke` | 실제 서버, 실제 Playwright, 데모 사이트. 약 20초 |
| 타입 | `npm run typecheck` | 서버·웹·리포터·MCP 전체 |

단위 테스트는 `tests/helpers.ts`의 `isolatedHome()`으로 임시 폴더를 쓰므로 실제 `data/`를 건드리지 않습니다. 순수 로직(`reduce`, `redact`, `classify`, `ooxml`, `markdown`, `stream`, `prompt`)을 먼저 테스트하고, DB가 필요한 규칙은 `services.test.ts`처럼 임시 DB로 검증합니다.

## 8. 의도적으로 하지 않은 것

- **ORM / DI 컨테이너 / 상태 관리 라이브러리**: 테이블 6개, 화면 5개 규모에서 비용이 이득보다 큽니다.
- **DB 마이그레이션**: 아직 스키마가 바뀐 적이 없습니다. 처음 바뀔 때 `schema_version`을 도입하세요 (`core/schema.ts` 머리말 참고).
- **다중 사용자 / 인증**: 한 사람이 자기 PC에서 쓰는 도구입니다. 접근 제어는 localhost 바인딩과 `guard.ts`가 전부입니다.
- **Electron 포장**: 서버 + 브라우저 창으로 충분해서 미뤘습니다. 서버가 이미 독립 프로세스라 나중에 감싸기 쉽습니다.
