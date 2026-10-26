---
name: probe
description: Test a service registered in the Probe dashboard. Use when the user asks to open Probe / the test dashboard, to write or run Playwright tests for a registered service, or to look at defects found in a Probe run.
---

# Probe

Probe is the user's local test dashboard (`Economy/probe`). It holds registered services, their credentials, domain documents, and shows runs live. You write the Playwright specs; Probe runs them and shows the user what is happening.

Use the `probe` MCP tools. If they are not available, tell the user to run:
`claude mcp add probe -- node "C:\Users\mylink\orca\projects\Economy\probe\mcp\server.ts"` and stop.

## Workflow

1. `open_dashboard` when the user wants to see it, or before a run so they can watch.
2. `get_service` for the service. It returns `specDir`, the env variable names, and the knowledge file list. Credentials are never shown to you; use `process.env.<NAME>`.
3. `read_knowledge` (all files) before writing any spec. If there is none, say so and ask the user to add documents and press "학습 시작" in the 도메인 학습 menu. You may still explore the live site, but say that expectations are then unsourced.
4. Write specs into `specDir` as `*.spec.ts`. Import only from the generated helper, never from `@playwright/test`:
   ```ts
   import { test, expect, view } from '../probe.ts';
   ```
5. `run_tests`. It waits for the result and returns failures. Report in Korean: what ran, what failed, what you think each failure is.

## Writing good specs

- Derive tests from `test-points.md` (P0 first), `flows.md` and `rules.md`. Put the source in the test title or a comment, for example `// rules.md: 장바구니 합계`.
- Group with `test.describe('<feature name>')`. The describe title is what the monitor shows as the feature.
- Call `await view('<screen or state>', '<feature>')` whenever the test arrives at a new screen or opens a dialog. This is what lets the user see where the test is.
- Locators: roles, labels, and visible text first; test ids if the app has them; no positional CSS. No `waitForTimeout`; use web-first assertions.
- Each test is independent and sets up its own state. Never hard-code credentials, tokens or personal data. Never print env values.
- Expected values come from the knowledge files. If the live site disagrees with the knowledge, the test should fail on the documented expectation. Do not edit the expectation to match the site. If the knowledge is marked `(inferred)`, mention that when you report the failure.
- Do not create, delete or modify real data on a production-looking URL without asking the user first.

## Reading failures

Failed tests become "candidate" defects automatically; identical failures are merged and counted.

Before calling a failure an app defect, rule out a test defect: rerun once with `grep`, look at the error and the page. If the selector or timing was wrong, fix the spec. If the app is wrong, leave the test failing, then `update_defect` with the right severity. The user confirms defects in the dashboard; do not mark them `confirmed` or `false_positive` yourself unless asked.

Use `report_defect` only for problems you found without a failing assertion, with exact steps, expected, and actual.
