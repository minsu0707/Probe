import { copyFileSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, join, resolve, sep } from 'node:path';
import { ensureDir, runDir } from '../../config.ts';

/**
 * Copy a failure screenshot or trace out of Playwright's output folder, which Playwright
 * empties on the next run, into the run's permanent folder. Returns the stored file name.
 *
 * The source path comes from the reporter, so it is only trusted if it sits inside
 * `allowedRoot` (the service's test workspace). That keeps a forged ingest event from
 * making the server copy arbitrary files off disk.
 */
export function keepAttachment(runId: string, source: string | undefined, allowedRoot: string): string | null {
  if (!source) return null;
  const abs = resolve(source);
  if (!abs.startsWith(resolve(allowedRoot) + sep) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  const name = `${randomBytes(4).toString('hex')}-${basename(abs).replace(/[^\w.-]/g, '_')}`;
  copyFileSync(abs, join(ensureDir(runDir(runId)), name));
  return name;
}
