import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IngestEvent } from '../shared/events.ts';
import { emptyCurrent, emptyTotals, featureOf, pagePath, reduceEvents, type RunState } from '../server/modules/runs/reduce.ts';

const newState = (): RunState => ({
  summary: { id: 'r1', serviceId: 's1', title: 't', status: 'starting', startedAt: 0, endedAt: null, totals: emptyTotals(), current: emptyCurrent(), defects: 0 },
  active: new Map(),
});

const begin = (id: string, title: string[], file = '/x/cart.spec.ts'): IngestEvent => ({ type: 'test:begin', id, title, file, project: '' });
const end = (id: string, status: 'passed' | 'failed' | 'skipped', extra: Partial<Extract<IngestEvent, { type: 'test:end' }>> = {}): IngestEvent => ({ type: 'test:end', id, status, durationMs: 1500, retry: 0, ...extra });

test('plan sets the total and moves the run to running', () => {
  const s = newState();
  reduceEvents(s, [{ type: 'run:plan', total: 3 }]);
  assert.equal(s.summary.totals.total, 3);
  assert.equal(s.summary.status, 'running');
});

test('a test in progress shows as current and counts as running', () => {
  const s = newState();
  reduceEvents(s, [begin('a', ['장바구니', '합계']), { type: 'step', id: 'a', title: 'Click' }]);
  assert.deepEqual(s.summary.current.test, ['장바구니', '합계']);
  assert.equal(s.summary.current.feature, '장바구니');
  assert.equal(s.summary.current.step, 'Click');
  assert.equal(s.summary.totals.running, 1);
});

test('results are tallied and the finished test leaves "current"', () => {
  const s = newState();
  reduceEvents(s, [begin('a', ['t1']), end('a', 'passed'), begin('b', ['t2']), end('b', 'skipped')]);
  assert.equal(s.summary.totals.passed, 1);
  assert.equal(s.summary.totals.skipped, 1);
  assert.equal(s.summary.totals.running, 0);
  assert.equal(s.summary.current.test, null);
});

test('a failing temporary exploration spec is counted as failed but never becomes a defect', () => {
  const s = newState();
  const out = reduceEvents(s, [begin('a', ['scratch'], '/x/99-scratch.spec.ts'), end('a', 'failed', { error: 'Error: DOM:<div>' })]);
  assert.equal(s.summary.totals.failed, 1);
  assert.equal(out.failures.length, 0);
  assert.ok(out.logs.some((l) => l.kind === 'result'));
});

test('a failed test is reported as a failure with its feature and page', () => {
  const s = newState();
  const out = reduceEvents(s, [begin('a', ['장바구니', '합계']), { type: 'page', id: 'a', url: 'http://h/cart?x=1' }, end('a', 'failed', { error: 'boom' })]);
  assert.equal(s.summary.totals.failed, 1);
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0].feature, '장바구니');
  assert.equal(out.failures[0].page, '/cart?x=1');
  assert.equal(out.failures[0].end.error, 'boom');
});

test('passing and skipped tests produce no failures', () => {
  const out = reduceEvents(newState(), [begin('a', ['t']), end('a', 'passed')]);
  assert.equal(out.failures.length, 0);
});

test('a test that passed on retry counts as passed and flaky', () => {
  const s = newState();
  reduceEvents(s, [begin('a', ['t']), end('a', 'passed', { retry: 1 })]);
  assert.equal(s.summary.totals.passed, 1);
  assert.equal(s.summary.totals.flaky, 1);
});

test('navigating to the same page twice logs it once', () => {
  const s = newState();
  const out = reduceEvents(s, [begin('a', ['t']), { type: 'page', id: 'a', url: 'http://h/cart' }, { type: 'page', id: 'a', url: 'http://h/cart' }]);
  assert.equal(out.logs.filter((l) => l.kind === 'page').length, 1);
});

test('view() updates the screen and, when given, the feature', () => {
  const s = newState();
  reduceEvents(s, [begin('a', ['t']), { type: 'view', id: 'a', name: '합계 영역', feature: '장바구니' }]);
  assert.equal(s.summary.current.view, '합계 영역');
  assert.equal(s.summary.current.feature, '장바구니');
});

test('steps from a test that is no longer current do not overwrite the current step', () => {
  const s = newState();
  reduceEvents(s, [begin('a', ['t']), { type: 'step', id: 'zzz', title: 'stale' }]);
  assert.equal(s.summary.current.step, null);
});

test('run:end is reported to the caller', () => {
  assert.equal(reduceEvents(newState(), [{ type: 'run:end', status: 'passed' }]).runEnded, true);
});

test('featureOf uses describe titles, or the spec file name for top-level tests', () => {
  assert.equal(featureOf(['A', 'B', 'test'], '/x/y.spec.ts'), 'A › B');
  assert.equal(featureOf(['test'], '/x/login.spec.ts'), 'login');
});

test('pagePath drops the host and survives non-URLs', () => {
  assert.equal(pagePath('https://x.com/a/b?c=1#d'), '/a/b?c=1#d');
  assert.equal(pagePath('not a url'), 'not a url');
});
