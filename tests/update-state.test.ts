import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UpdateState } from '../shared/models.ts';
import { briefError, reduceUpdate } from '../desktop/update-state.ts';

const idle: UpdateState = { phase: 'idle', currentVersion: '1.0.0', checkedAt: null };

test('a check that finds a version downloads it and ends ready', () => {
  let s = reduceUpdate(idle, { type: 'checking' });
  assert.equal(s.phase, 'checking');
  s = reduceUpdate(s, { type: 'available', version: '1.1.0' });
  assert.deepEqual(s, { phase: 'downloading', currentVersion: '1.0.0', version: '1.1.0', percent: 0 });
  s = reduceUpdate(s, { type: 'progress', percent: 42.4 });
  assert.equal(s.phase === 'downloading' && s.percent, 42);
  s = reduceUpdate(s, { type: 'downloaded', version: '1.1.0' });
  assert.deepEqual(s, { phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' });
});

test('no update: back to idle with the check time', () => {
  assert.deepEqual(reduceUpdate({ phase: 'checking', currentVersion: '1.0.0' }, { type: 'none', at: 5 }), { phase: 'idle', currentVersion: '1.0.0', checkedAt: 5 });
});

test('a downloaded update survives later checks and failures', () => {
  const ready: UpdateState = { phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' };
  for (const ev of [{ type: 'checking' }, { type: 'none', at: 1 }, { type: 'error', message: 'offline' }] as const) assert.deepEqual(reduceUpdate(ready, ev), ready);
});

test('progress outside a download is ignored and percent is clamped', () => {
  assert.deepEqual(reduceUpdate(idle, { type: 'progress', percent: 50 }), idle);
  const dl: UpdateState = { phase: 'downloading', currentVersion: '1.0.0', version: '2', percent: 0 };
  assert.equal(reduceUpdate(dl, { type: 'progress', percent: 140 }).phase === 'downloading' && (reduceUpdate(dl, { type: 'progress', percent: 140 }) as { percent: number }).percent, 100);
});

test('errors become one short line', () => {
  assert.equal(briefError(new Error('net::ERR_INTERNET_DISCONNECTED\n    at foo (bar.js:1)')), 'net::ERR_INTERNET_DISCONNECTED');
  assert.equal(briefError('plain').length > 0, true);
});

test('installing is reachable from ready and final', () => {
  const ready: UpdateState = { phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' };
  const installing = reduceUpdate(ready, { type: 'installing', version: '1.1.0' });
  assert.deepEqual(installing, { phase: 'installing', currentVersion: '1.0.0', version: '1.1.0' });
  for (const ev of [{ type: 'checking' }, { type: 'none', at: 1 }, { type: 'error', message: 'x' }] as const) assert.deepEqual(reduceUpdate(installing, ev), installing);
});

test('a release whose latest.yml is not up yet is not shown as a failure', () => {
  const idle = { phase: 'idle', currentVersion: '1.0.0', checkedAt: 5 } as const;
  const gap = 'Cannot find latest.yml in the latest release artifacts (https://github.com/x/y/releases/download/v1.0.1/latest.yml): HttpError: 404';
  assert.deepEqual(reduceUpdate({ phase: 'checking', currentVersion: '1.0.0' }, { type: 'error', message: gap }), { phase: 'idle', currentVersion: '1.0.0', checkedAt: null });
  assert.deepEqual(reduceUpdate(idle, { type: 'error', message: gap }), idle);
  assert.equal(reduceUpdate(idle, { type: 'error', message: 'offline' }).phase, 'error', 'other errors still show');
});
