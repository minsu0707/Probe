import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const { testsDir, ensureDir } = await import('../server/config.ts');
const { sweepDeletedSpecs } = await import('../server/modules/sessions/sweep.ts');

test('only marked or empty files under tests/specs are removed', () => {
  const specs = join(ensureDir(testsDir('svc1')), 'specs');
  mkdirSync(join(specs, 'sub'), { recursive: true });
  writeFileSync(join(specs, 'old.spec.ts'), '// probe:delete\n');
  writeFileSync(join(specs, 'empty.spec.ts'), '  \n');
  writeFileSync(join(specs, 'sub', 'nested.spec.ts'), '// probe:delete');
  writeFileSync(join(specs, 'keep.spec.ts'), "import { test } from '../probe.ts';\n// probe:delete is only a marker when it is the whole file\n");
  writeFileSync(join(testsDir('svc1'), 'playwright.config.ts'), '');

  assert.deepEqual(sweepDeletedSpecs('svc1').sort(), ['empty.spec.ts', 'old.spec.ts', 'sub/nested.spec.ts']);
  assert.ok(existsSync(join(specs, 'keep.spec.ts')));
  assert.ok(existsSync(join(testsDir('svc1'), 'playwright.config.ts')), 'files outside specs/ are never touched');
  assert.deepEqual(sweepDeletedSpecs('svc1'), []);
  assert.deepEqual(sweepDeletedSpecs('no-such-service'), []);
});
