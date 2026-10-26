import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Modules that touch the database or key file read PROBE_HOME when first imported, so a test
 * must call this before its first dynamic `import()` of them. Each test file is its own
 * process under `node --test`, so one temp home per file is isolated.
 */
export function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'probe-test-'));
  process.env.PROBE_HOME = home;
  return home;
}
