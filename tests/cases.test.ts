import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const { flattenSuites, sourceComment, stepTitles, listTestCases } = await import('../server/modules/runs/cases.ts');
const { testsDir } = await import('../server/config.ts');
const services = await import('../server/modules/services/service.ts');

test('suites flatten into cases named by their describe blocks', () => {
  const cases = flattenSuites([
    {
      title: 'a.spec.ts',
      file: 'a.spec.ts',
      specs: [{ title: '루트 테스트', file: 'a.spec.ts', line: 3 }],
      suites: [{ title: '로그인', specs: [{ title: '성공', file: 'a.spec.ts', line: 8, tags: ['@P0'] }], suites: [{ title: '오류', specs: [{ title: '잘못된 암호', file: 'a.spec.ts', line: 14 }] }] }],
    },
  ]);
  assert.deepEqual(cases.map((c) => [c.id, c.feature]), [['a.spec.ts:3', '(그룹 없음)'], ['a.spec.ts:8', '로그인'], ['a.spec.ts:14', '로그인 › 오류']]);
  assert.deepEqual(cases[1].tags, ['@P0']);
});

test('the comment above a test is its source', () => {
  const lines = ['test.describe("x", () => {', '  // rules.md: 합계', '  // 소수점 둘째 자리', '  test("a", () => {});', '  test("b", () => {});'];
  assert.equal(sourceComment(lines, 4), 'rules.md: 합계 소수점 둘째 자리');
  assert.equal(sourceComment(lines, 5), null);
});

test('Playwright lists the specs of a service, and file:line runs only that test', async () => {
  const s = services.createService({ name: 'Listed', baseUrl: 'http://127.0.0.1:9' });
  const specs = join(testsDir(s.id), 'specs');
  mkdirSync(specs, { recursive: true });
  writeFileSync(
    join(specs, 'shop.spec.ts'),
    `import { test, expect } from '../probe.ts';
test.describe('장바구니', () => {
  // rules.md: 합계
  test('합계 계산', async () => { expect(1).toBe(1); });
  test('수량 변경', async () => { expect(1).toBe(1); });
});
`,
  );
  const { cases, errors } = await listTestCases(s.id);
  assert.deepEqual(errors, []);
  assert.deepEqual(cases.map((c) => [c.title, c.feature, c.line, c.source]), [['합계 계산', '장바구니', 4, 'rules.md: 합계'], ['수량 변경', '장바구니', 5, null]]);

  // The argument a selected run passes: only the second test runs.
  const require = createRequire(import.meta.url);
  const r = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', join(testsDir(s.id), 'playwright.config.ts'), '--reporter=json', `${cases[1].file}:${cases[1].line}`], { cwd: testsDir(s.id), encoding: 'utf8' });
  const ran = [...r.stdout.matchAll(/"title": "(합계 계산|수량 변경)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ran)], ['수량 변경']);
});

test('the steps of a test are read from its source, up to the next test', () => {
  const lines = [
    "test('첫째', async ({ page }) => {",
    "  await test.step('단계 1: 로그인', async () => {});",
    '  await test.step(`단계 2: "등록"`, async () => {});',
    '  await test.step(',
    String.raw`    '단계 3: it\'s done',`,
    '    async () => {},',
    '  );',
    '});',
    "test('둘째', async () => {",
    "  await test.step('다른 시나리오', async () => {});",
    '});',
  ];
  assert.deepEqual(stepTitles(lines, 1), ['단계 1: 로그인', '단계 2: "등록"', String.raw`단계 3: it\'s done`]);
  assert.deepEqual(stepTitles(lines, 9), ['다른 시나리오']);
  assert.deepEqual(stepTitles(["test('x', async () => {});"], 1), []);
});
