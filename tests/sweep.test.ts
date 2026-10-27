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

test('a spec Claude empties is kept in the trash, and restoring puts it back', async () => {
  const { listTrash, restoreTrashed } = await import('../server/modules/runs/trash.ts');
  const { snapshotSpecs } = await import('../server/modules/sessions/sweep.ts');
  const svc = (await import('../server/modules/services/service.ts')).createService({ name: 'Trashy', baseUrl: 'http://127.0.0.1:9' }).id;
  const specs = join(ensureDir(testsDir(svc)), 'specs');
  mkdirSync(specs, { recursive: true });
  writeFileSync(join(specs, 'gone.spec.ts'), "test('a', async () => {});\n");
  const before = snapshotSpecs(svc);
  writeFileSync(join(specs, 'gone.spec.ts'), '// probe:delete\n');
  sweepDeletedSpecs(svc, before);
  assert.ok(!existsSync(join(specs, 'gone.spec.ts')));
  const [item] = listTrash(svc);
  assert.equal(item.file, 'gone.spec.ts');
  restoreTrashed(svc, item.id);
  assert.match((await import('node:fs')).readFileSync(join(specs, 'gone.spec.ts'), 'utf8'), /test\('a'/);
  assert.equal(listTrash(svc).length, 0);
});

test('a test block is cut out with its comment and can be restored', async () => {
  const { cutTest } = await import('../server/modules/runs/trash.ts');
  const src = "import x from 'y';\n\n// 근거 문서\ntest('a (b)', async ({ page }) => {\n  const s = `}${1}`;\n});\n\ntest('c', () => {});\n";
  const cut = cutTest(src, 4)!;
  assert.equal(cut.removed, "// 근거 문서\ntest('a (b)', async ({ page }) => {\n  const s = `}${1}`;\n});");
  assert.equal(cut.rest, "import x from 'y';\n\ntest('c', () => {});\n");
  assert.equal(cutTest(src, 1), null);
});

test('usage from before a reset reads 0%, not the old figure', async () => {
  const { freshUsage } = await import('../server/modules/agents/usage.ts');
  const u = freshUsage({ fiveHour: { utilization: 0.8, resetsAt: 1000 }, sevenDay: { utilization: 0.3, resetsAt: 9000 }, at: 0 }, 5000);
  assert.equal(u.fiveHour?.utilization, 0);
  assert.equal(u.sevenDay?.utilization, 0.3);
});
