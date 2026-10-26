import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoute, serviceHref } from '../web/src/app/router.ts';

test('a service route carries the service and tab', () => {
  assert.deepEqual(parseRoute('#/s/abc/monitor'), { page: 'service', serviceId: 'abc', tab: 'monitor' });
});

test('a service route without a valid tab opens the overview', () => {
  assert.deepEqual(parseRoute('#/s/abc'), { page: 'service', serviceId: 'abc', tab: 'overview' });
  assert.deepEqual(parseRoute('#/s/abc/nope'), { page: 'service', serviceId: 'abc', tab: 'overview' });
});

test('settings default to the agent section', () => {
  assert.deepEqual(parseRoute('#/settings'), { page: 'settings', section: 'agent' });
  assert.deepEqual(parseRoute('#/settings/browser'), { page: 'settings', section: 'browser' });
});

test('anything else, including the old page routes, is home', () => {
  for (const hash of ['', '#', '#/', '#/learn', '#/s']) assert.deepEqual(parseRoute(hash), { page: 'home' });
});

test('ids survive a round trip through the hash', () => {
  const href = serviceHref('a b/c', 'learn');
  assert.deepEqual(parseRoute(href), { page: 'service', serviceId: 'a b/c', tab: 'learn' });
});
