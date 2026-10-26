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
