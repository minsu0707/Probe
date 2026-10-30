import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTemporarySpec } from '../shared/temp-spec.ts';

test('exploration files are temporary, however they are spelled', () => {
  for (const f of ['99-scratch.spec.ts', 'zz-probe-경로탐색.spec.ts', 'sub/zz-probe-배합일지.spec.ts', 'my_tmp.spec.ts', 'debug-login.spec.ts', 'sandbox.spec.ts', 'a\\temp.spec.ts']) assert.equal(isTemporarySpec(f), true, f);
});

test('real specs are not', () => {
  for (const f of ['e2e-01-제주감귤에이드.spec.ts', 'login.spec.ts', 'template.spec.ts', 'attempt-count.spec.ts', 'scratchpad-notes.spec.ts', 'debugger.spec.ts']) assert.equal(isTemporarySpec(f), false, f);
});
