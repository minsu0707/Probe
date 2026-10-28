import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The count reads the specs of one service; point Probe at a throwaway data folder first.
process.env.PROBE_HOME = mkdtempSync(join(tmpdir(), 'probe-count-'));
const { countTestCases } = await import('../server/modules/runs/cases.ts');
const { testsDir } = await import('../server/config.ts');

test('counts declared tests, ignoring describe blocks and method calls named test', () => {
  const specs = join(testsDir('svc'), 'specs', 'nested');
  mkdirSync(specs, { recursive: true });
  writeFileSync(
    join(specs, 'a.spec.ts'),
    ["test.describe('group', () => {", "  test('one', async () => {});", "  test.skip('two', async () => {});", "  await helper.test('not a test');", '});'].join('\n'),
  );
  writeFileSync(join(specs, 'notes.ts'), "test('ignored: not a spec file', () => {});");
  assert.equal(countTestCases('svc'), 2);
});

test('no specs folder means no tests', () => {
  assert.equal(countTestCases('nothing-here'), 0);
});
