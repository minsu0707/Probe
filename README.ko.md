[English](README.md) · **한국어**

# Probe

내 PC에서 도는 테스트 자동화 대시보드입니다. Claude가 Playwright 테스트를 쓰고, Probe는 서비스와 자격 증명을 보관하고, 문서에서 도메인을 학습하고, 테스트를 실행하고, 진행 상황을 실시간으로 보여줍니다.

## 설치 (한 번만)

```
npm install
npm run build
claude mcp add probe -- node "<이 폴더>\mcp\server.ts"
```

Node 24 이상(TypeScript를 바로 실행하고 내장 `node:sqlite`를 씁니다)과, `PATH`에 Claude Code CLI가 필요합니다. "학습 시작" 버튼은 `claude -p`를 실행하며 이미 로그인된 Claude를 그대로 씁니다.

## 사용

Claude에게 "Probe 열어줘"라고 하면 MCP 서버가 대시보드를 `http://127.0.0.1:4317`에 띄우고 엽니다. 직접 띄우려면 `npm start`를 실행하세요.

| 메뉴 | 하는 일 |
|---|---|
| 서비스 | 서비스를 등록하고 `.env` 또는 암호로 보호한 `.enc` 파일을 올립니다. |
| 도메인 학습 | 문서를 올리거나 Drive 링크를 추가하고 학습 시작을 누릅니다. Claude가 출처가 달린 지식 문서를 쓰고, 테스트를 쓰기 전에 읽습니다. |
| 실시간 모니터링 | 현재 페이지·기능·화면·단계, 집계, 라이브 브라우저 화면, 진행 기록. |
| 결과 · 결함 | 실패한 테스트가 스크린샷·트레이스가 붙은 결함 후보로 만들어지고, 같은 원인은 한 건으로 묶입니다. |

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
