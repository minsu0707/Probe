import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewNeed } from '../shared/need.ts';

const need = (error: string, shot = true) => reviewNeed({ error, page: '/#product', feature: 'e2e-01-제주감귤에이드', hasScreenshot: shot });

test('a rejected request names the rule that rejected it and asks whether the rejection is right', () => {
  const n = need('Error: POST /api/product-revisions → 409 {"ok":false,"code":"DUPLICATE_DRAFT","message":"이 제품의 작성 중 개정이 이미 있습니다.","detail":{"existingId":"PRV-1","state":"DRAFT"}}\n\nexpect(received).toBeTruthy()');
  assert.equal(n.headline, 'POST /api/product-revisions → 409 DUPLICATE_DRAFT');
  assert.match(n.happened, /작성 중 개정이 이미 있습니다/);
  assert.match(n.happened, /DRAFT/);
  assert.match(n.checks[0], /맞는 응답인지/);
});

test('an unimplemented API is said to be unimplemented, not called a failure of the test', () => {
  const n = need('Error: GET /api/materials/MAT-1 → 501 {"ok":false,"code":"NOT_IMPLEMENTED","message":"아직 구현되지 않았습니다."}');
  assert.match(n.why, /구현되지 않은 API/);
  assert.match(n.checks[1], /오탐/);
});

test("a test's own dump is recognised as a printout, with what it printed", () => {
  const n = need('Error: PRD=PRD-069662 URL=https://x/#product NAV:["M0 홈","M1 제품 개발"] CARDS:["개발 과제"]');
  assert.match(n.headline, /화면 정보 출력 후 멈춤/);
  assert.match(n.headline, /PRD·URL 외 2/);
  assert.match(n.why, /일부러 실패시킨/);
  assert.ok(n.checks.some((c) => c.includes('스크린샷')));

  assert.match(need('Error: DOM:<td><button id="prd-add">제품 등록</button></td>').headline, /DOM/);
});

test('expected and received values are put side by side', () => {
  const n = need('Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: "100"\nReceived: "90"');
  assert.ok(n.checks.some((c) => c.includes('100')) && n.checks.some((c) => c.includes('90')));
  assert.match(n.why, /올바른 값을 모릅니다/);
});

test('a missing screenshot is said so instead of pointing at one', () => {
  assert.ok(need('Error: expect(received).toBe(expected)\n\nExpected: "1"\nReceived: "2"', false).checks.some((c) => c.includes('스크린샷이 없습니다')));
});

test('twelve failures of one test get different headlines', () => {
  const errors = [
    'Error: POST /api/a → 409 {"code":"FROZEN"}',
    'Error: GET /api/b → 501 {"code":"NOT_IMPLEMENTED"}',
    'Error: DOM:<div>',
    'Error: URL:https://x BODY:abc',
    'TimeoutError: locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for getByRole(\'button\', { name: \'원료 등록\' })',
  ];
  assert.equal(new Set(errors.map((e) => need(e).headline)).size, errors.length);
});

test('an error of no known shape still gets its first line and a place to look', () => {
  const n = need('Error: 뭔가 이상함', true);
  assert.match(n.headline, /뭔가 이상함/);
  assert.ok(n.checks.length >= 1);
});
