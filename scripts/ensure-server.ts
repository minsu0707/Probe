/**
 * Start the Probe server if it isn't running. Shared by `Probe.cmd` (scripts/launch.ts),
 * the Windows autostart entry and the MCP server, so "start Probe" behaves the same everywhere.
 *
 * The server is started detached with its output going to `data/probe.log`: it must outlive
 * whatever started it (a closed console, an ended Claude session).
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, statSync, truncateSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { HOME, PORT, ROOT, WEB_DIST } from '../server/config.ts';

const require = createRequire(import.meta.url);

export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const LOG_FILE = join(HOME, 'probe.log');

/** Start fresh instead of letting an unattended log grow forever. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const START_TIMEOUT_MS = 15_000;

export type PortStatus = 'probe' | 'other' | 'down';

/** Is a Probe server on our port, something else, or nothing? */
export async function portStatus(): Promise<PortStatus> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json().catch(() => null);
    return body?.app === 'probe' ? 'probe' : 'other';
  } catch (e) {
    // A refused connection means nobody is listening; anything else (timeout, reset) means something is.
    const code = (e as { cause?: { code?: string } }).cause?.code;
    return code === 'ECONNREFUSED' ? 'down' : 'other';
  }
}

/** The web app is built once; a fresh clone has no dist/ yet. */
function ensureWebBuilt(): void {
  if (existsSync(join(WEB_DIST, 'index.html'))) return;
  // stderr, not stdout: when the MCP server calls this, stdout is the protocol channel.
  console.error('First run: building the web app…');
  const result = spawnSync(process.execPath, [require.resolve('vite/bin/vite.js'), 'build'], { cwd: ROOT, stdio: ['ignore', process.stderr.fd, process.stderr.fd] });
  if (result.status !== 0) throw new Error('Could not build the web app. Run `npm install` and `npm run build` in the Probe folder, then try again.');
}

/** @returns whether this call started the server (false if it was already running). */
export async function ensureServer(): Promise<boolean> {
  const status = await portStatus();
  if (status === 'probe') return false;
  if (status === 'other') throw new Error(`Port ${PORT} is in use by another program. Stop it, or start Probe on a different port by setting the PORT environment variable.`);

  ensureWebBuilt();
  if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) truncateSync(LOG_FILE, 0);
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [join(ROOT, 'server', 'main.ts')], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.unref();
  closeSync(log);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if ((await portStatus()) === 'probe') return true;
  }
  throw new Error(`Probe did not start within ${START_TIMEOUT_MS / 1000} seconds. See ${LOG_FILE} for the reason.`);
}

/** Open a URL in the default browser. Failure is harmless: the URL is also printed. */
export function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
}
