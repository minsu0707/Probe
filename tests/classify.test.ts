import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorShape, failureFingerprint, guessSeverity, stripAnsi } from '../server/modules/defects/classify.ts';
import { isSensitiveKey } from '../server/modules/secrets/classify.ts';

test('a text mismatch containing "3,500" is major, not a 5xx critical', () => {
  // Regression: a bare /\b5\d\d\b/ once matched the 500 in a price.
  assert.equal(guessSeverity('Expected: "합계 3,000원"\nReceived: "합계 3,500원"'), 'major');
});

test('network failures and HTTP 5xx statuses are critical', () => {
  assert.equal(guessSeverity('page.goto: net::ERR_CONNECTION_REFUSED'), 'critical');
  assert.equal(guessSeverity('Response status code: 503'), 'critical');
  assert.equal(guessSeverity('TypeError: x is undefined'), 'critical');
});

test('visual-only assertions are minor', () => {
  assert.equal(guessSeverity('expect(locator).toHaveCSS(...) failed'), 'minor');
});

test('errors that differ only in numbers share a shape', () => {
  assert.equal(errorShape('Timeout 5000ms exceeded'), errorShape('Timeout 30000ms exceeded'));
});

test('fingerprint is stable and separates different tests and different errors', () => {
  const a = failureFingerprint('s1', ['feat', 'test'], 'Timeout 5000ms');
  assert.equal(a, failureFingerprint('s1', ['feat', 'test'], 'Timeout 6000ms'));
  assert.notEqual(a, failureFingerprint('s1', ['feat', 'other'], 'Timeout 5000ms'));
  assert.notEqual(a, failureFingerprint('s2', ['feat', 'test'], 'Timeout 5000ms'));
  assert.notEqual(a, failureFingerprint('s1', ['feat', 'test'], 'Locator not found'));
});

test('ANSI colour codes are stripped', () => {
  assert.equal(stripAnsi('\u001b[31mError\u001b[39m: x'), 'Error: x');
});

test('credential-looking variable names are sensitive; plain config is not', () => {
  for (const k of ['TEST_PASSWORD', 'API_TOKEN', 'SECRET', 'AWS_ACCESS_KEY', 'SESSION_COOKIE']) assert.equal(isSensitiveKey(k), true, k);
  for (const k of ['BASE_URL', 'TEST_USER', 'ENV', 'HEADLESS']) assert.equal(isSensitiveKey(k), false, k);
});

test('short password names are sensitive, ordinary names containing "pw" are not', () => {
  for (const k of ['ADMIN_PW', 'pw', 'DB_PW_PROD', 'USER_PSWD', 'ADMIN_PASSWORD']) assert.equal(isSensitiveKey(k), true, k);
  for (const k of ['ADMIN_ID', 'BASE_URL', 'POWER_USER', 'NEWS_PAGE']) assert.equal(isSensitiveKey(k), false, k);
});

test('the explanation names the part of the error that decided the cause', async () => {
  const { explainCause } = await import('../shared/cause.ts');
  const g = explainCause('Error: strict mode violation: getByText("저장") resolved to 3 elements');
  assert.equal(g.cause, 'test');
  assert.equal(g.matched, 'strict mode violation');
  assert.equal(explainCause('something odd').matched, null);
});

test('the explanation says what happened in this failure, not only what kind it is', async () => {
  const { explainCause } = await import('../shared/cause.ts');
  const strict = explainCause(`Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '저장' })
Error: strict mode violation: getByRole('button', { name: '저장' }) resolved to 2 elements:
    1) <button type="button" class="btn">저장</button> aka getByRole('button', { name: '저장', exact: true })
    2) <button type="button">임시 저장</button> aka locator('button').nth(1)`).detail!;
  assert.match(strict.summary, /2개/);
  assert.match(strict.points.join('\n'), /1번: <button type="button" class="btn">저장<\/button>$/m);
  assert.ok(strict.fix);

  const missing = explainCause("Error: expect(locator).toBeVisible() failed\n\nLocator: getByText('승인')\nExpected: visible\nError: element(s) not found").detail!;
  assert.match(missing.summary, /getByText\('승인'\).*보이는지/);

  const wrong = explainCause("Error: expect(locator).toHaveText(expected) failed\n\nLocator: locator('#total')\nExpected string: \"100\"\nReceived string: \"90\"").detail!;
  assert.deepEqual(wrong.points, ['기대한 값: "100"', '화면의 값: "90"']);

  assert.match(explainCause('Test timeout of 300000ms exceeded.').detail!.summary, /300초/);
  assert.equal(explainCause('something odd').detail, null);
});
