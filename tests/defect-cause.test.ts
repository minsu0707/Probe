import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guessCause } from '../server/modules/defects/classify.ts';
import { isolatedHome } from './helpers.ts';

test('the error text gives a first guess at who is wrong', () => {
  // the test's own fault
  assert.equal(guessCause("Error: expect(locator).toBeVisible() failed\nLocator: getByRole('button')\nError: strict mode violation: getByRole('button') resolved to 2 elements"), 'test');
  assert.equal(guessCause('Error: expect(locator).toBeVisible() failed\nExpected: visible\nError: element(s) not found'), 'test');
  assert.equal(guessCause('Test timeout of 30000ms exceeded.'), 'test');
  // every failed expect() has a "waiting for locator" line in its call log; that alone says nothing
  assert.equal(guessCause("Error: expect(locator).toHaveText(expected) failed\nExpected: '안녕'\nReceived: 'hello'\nCall log:\n  - waiting for locator('h1')"), 'app');
  // the page answered with another value
  assert.equal(guessCause('Error: expect(locator).toBeDisabled() failed\nExpected: disabled\nReceived: enabled'), 'app');
  assert.equal(guessCause('expect(locator).toHaveText(expected) failed\n- Expected  - 1\n+ Received  + 1'), 'app');
  // the environment
  assert.equal(guessCause('page.goto: net::ERR_CONNECTION_REFUSED at https://x.test'), 'env');
  assert.equal(guessCause('Error: Request failed: blockedbyclient'), 'env');
  assert.equal(guessCause('Error: something odd'), 'unknown');
});

test('a failure that follows an earlier one in the same file is stored with a link to it', async () => {
  isolatedHome();
  const { createService } = await import('../server/modules/services/service.ts');
  const { recordFailure, listDefects } = await import('../server/modules/defects/service.ts');
  const s = createService({ name: 'Chain' });
  const first = recordFailure({ serviceId: s.id, runId: 'r1', testTitle: ['등록', '단계 1'], feature: '등록', page: null, error: 'Test timeout of 30000ms exceeded.' });
  const second = recordFailure({ serviceId: s.id, runId: 'r1', testTitle: ['등록', '단계 2'], feature: '등록', page: null, error: 'element(s) not found', followsId: first.id });

  assert.equal(first.followsId, null);
  assert.equal(second.followsId, first.id);
  assert.equal(second.cause, 'test');
  assert.deepEqual(listDefects({ serviceId: s.id }).map((d) => [d.title, d.followsId === first.id]).sort(), [['단계 1', false], ['단계 2', true]]);
});

test('a failure dismissed as a false alarm stays dismissed when the same failure comes back', async () => {
  isolatedHome();
  const { createService } = await import('../server/modules/services/service.ts');
  const { recordFailure, listDefects, updateDefect } = await import('../server/modules/defects/service.ts');
  const s = createService({ name: 'Dismissed' });
  const input = { serviceId: s.id, runId: 'r1', testTitle: ['목록', '필터'], feature: '목록', page: null, error: 'Expected: 1\nReceived: 2' };
  const first = recordFailure(input);
  updateDefect(first.id, { status: 'false_positive' });
  const again = recordFailure({ ...input, runId: 'r2' });

  assert.equal(again.id, first.id);
  assert.equal(again.status, 'false_positive');
  assert.equal(again.occurrences, 2);
  assert.equal(listDefects({ serviceId: s.id }).length, 1);
});
