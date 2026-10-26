/** Starting the Playwright process for a run. No state here: arguments in, child process out. */
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PORT, testsDir } from '../../config.ts';
import { runtimeEnv } from '../secrets/service.ts';
import { detectBrowserChannel } from './browser.ts';

const require = createRequire(import.meta.url);

/** Spec files Playwright would pick up (`*.spec.ts`, `*.test.js`, …). */
export function listSpecFiles(serviceId: string): string[] {
  return readdirSync(join(testsDir(serviceId), 'specs'), { recursive: true })
    .map(String)
    .filter((f) => /\.(spec|test)\.[cm]?[jt]s$/.test(f));
}

export interface LaunchOptions {
  serviceId: string;
  runId: string;
  token: string;
  grep?: string;
  file?: string;
  headed?: boolean;
}

/**
 * Run Playwright's own CLI with the current Node binary (no `npx`, no shell). It is spawned
 * inside the service's test workspace with the decrypted credentials as environment
 * variables. PROBE_* tell the reporter and fixture where to send events.
 */
export function launchPlaywright(o: LaunchOptions): ChildProcess {
  const dir = testsDir(o.serviceId);
  const args = [require.resolve('@playwright/test/cli'), 'test', '--config', join(dir, 'playwright.config.ts')];
  if (o.grep) args.push('--grep', o.grep);
  if (o.headed) args.push('--headed');
  if (o.file) args.push(o.file);

  return spawn(process.execPath, args, {
    cwd: dir,
    env: {
      ...process.env,
      ...runtimeEnv(o.serviceId),
      PROBE_API: `http://127.0.0.1:${PORT}`,
      PROBE_RUN_ID: o.runId,
      PROBE_TOKEN: o.token,
      FORCE_COLOR: '0',
      // Read by the generated playwright.config.ts; empty means Playwright's bundled Chromium.
      PROBE_BROWSER_CHANNEL: detectBrowserChannel() ?? '',
    },
    windowsHide: true,
  });
}
