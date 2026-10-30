import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made: string[] = [];

// A test that opens the database cannot delete its folder on Windows while it still runs, so those folders
// outlive the process. The next run removes what earlier runs left (anything older than a few minutes).
const STALE_MS = 5 * 60_000;
for (const name of readdirSync(tmpdir())) {
  if (!/^probe-(?:test|bak|count)-/.test(name)) continue;
  const dir = join(tmpdir(), name);
  try {
    if (Date.now() - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* in use by a run that is still going */
  }
}
process.on('exit', () => {
  // Best effort: a folder still held open (the database) is left for the next run of the OS temp cleaner.
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* in use */
    }
  }
});

/** A temp folder that is removed when this test process ends; tests used to leave thousands behind. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/**
 * Modules that touch the database or key file read PROBE_HOME when first imported, so a test
 * must call this before its first dynamic `import()` of them. Each test file is its own
 * process under `node --test`, so one temp home per file is isolated.
 */
export function isolatedHome(): string {
  const home = tempDir('probe-test-');
  process.env.PROBE_HOME = home;
  return home;
}
