import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MASK, redactionForms, scrub, scrubDeep } from '../server/modules/runs/redact.ts';

test('masks every occurrence of a secret', () => {
  const forms = redactionForms(['hunter22']);
  assert.equal(scrub('Fill "hunter22" then hunter22 again', forms), `Fill "${MASK}" then ${MASK} again`);
});

test('masks a secret that contains quotes after JSON serialization', () => {
  const secret = 'pa"ss\\word';
  const event = { type: 'step', title: `Fill "${secret}"` };
  const clean = scrubDeep(event, redactionForms([secret]));
  assert.ok(!JSON.stringify(clean).includes('pa'), 'no fragment of the secret may remain');
  assert.equal(clean.type, 'step');
});

test('a longer secret that contains a shorter one is masked whole', () => {
  const forms = redactionForms(['abcd', 'abcd1234']);
  assert.equal(scrub('value=abcd1234', forms), `value=${MASK}`);
});

test('with nothing to redact the value is returned untouched', () => {
  const v = { a: 1 };
  assert.equal(scrubDeep(v, []), v);
});

test('text without secrets is unchanged', () => {
  assert.equal(scrub('Click "Login"', redactionForms(['hunter22'])), 'Click "Login"');
});
