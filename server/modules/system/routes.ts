/**
 * Process-level endpoints used by the launcher scripts and the MCP server, not by the UI.
 *
 *  GET  /api/health    "is a Probe server answering on this port?" (version, and what work is running)
 *  POST /api/shutdown  stop the server; refused while work is running unless ?force=1
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { ROOT } from '../../config.ts';
import { conflict } from '../../core/errors.ts';
import { isLearning } from '../learning/service.ts';
import { activeRun } from '../runs/service.ts';
import { detectBrowserChannel } from '../runs/browser.ts';
import { isSessionRunning } from '../sessions/service.ts';
import { listServices } from '../services/service.ts';

const version: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** Delay so the HTTP response is flushed before the process exits. */
const EXIT_DELAY_MS = 150;
/** desktop/main.ts relaunches the app when the server exits with this code. */
const RESTART_EXIT_CODE = 75;

/** What would be lost by stopping now, in words a person can read. */
function busyWith(): string | null {
  if (activeRun()) return 'a test run is in progress';
  if (listServices().some((s) => isLearning(s.id))) return 'a learning job is in progress';
  if (listServices().some((s) => isSessionRunning(s.id))) return 'a Claude session is working';
  return null;
}

export const systemRoutes = new Hono()
  // `app` lets a launcher tell Probe apart from some other program that holds the port.
  // `root` lets the settings page show the real install path instead of a placeholder;
  // `browser` tells it which browser tests will run in.
  .get('/health', (c) => c.json({ app: 'probe', version, pid: process.pid, root: ROOT, browser: detectBrowserChannel() ?? 'chromium', busy: busyWith() }))
  // Used after a restore: the desktop shell sees this exit code and starts Probe again, which finishes the restore.
  .post('/restart', (c) => {
    const busy = busyWith();
    if (busy) throw conflict(`Not restarting: ${busy}. Stop it first.`);
    setTimeout(() => process.exit(RESTART_EXIT_CODE), EXIT_DELAY_MS);
    return c.json({ restarting: true }, 202);
  })
  .post('/shutdown', (c) => {
    const busy = busyWith();
    if (busy && c.req.query('force') !== '1') throw conflict(`Not stopping: ${busy}. Stop it first, or use force.`);
    setTimeout(() => process.exit(0), EXIT_DELAY_MS);
    return c.json({ stopping: true }, 202);
  });
