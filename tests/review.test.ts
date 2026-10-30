import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSkips, followUpFor, specsChanged } from '../server/modules/sessions/review.ts';

const before = new Map([['old.spec.ts', "test.skip(true, 'x')"]]);

test('skips are found only in files written this turn', () => {
  const after = new Map([
    ['old.spec.ts', "test.skip(true, 'x')"], // untouched: not this turn's work
    ['e2e-01.spec.ts', "test('a', async () => {\n  test.skip(true, '값 없음');\n  // TODO locator\n});"],
  ]);
  const skips = findSkips(after, before);
  assert.deepEqual(skips.map((s) => [s.file, s.line]), [['e2e-01.spec.ts', 2], ['e2e-01.spec.ts', 3]]);
  assert.equal(specsChanged(after, before), true);
  assert.equal(specsChanged(before, before), false);
});

test('a follow-up is sent for skips only; specs that were never run are the owner to run, not Claude', () => {
  assert.equal(followUpFor({ skips: [] }), null);
  const skip = [{ file: 'a.spec.ts', line: 4, text: 'test.skip(true)' }];
  const message = followUpFor({ skips: skip })!;
  assert.match(message, /a.spec.ts:4/);
  assert.doesNotMatch(message, /call run_tests|Run them now/);
  assert.match(message, /Do not run the tests/);
});
