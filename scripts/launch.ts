/**
 * Start Probe (if needed) and open the dashboard. This is what `Probe.cmd` runs.
 *
 *   node scripts/launch.ts             start if needed, open the browser
 *   node scripts/launch.ts --no-open   start if needed, don't open the browser (used by autostart)
 */
import { BASE_URL, LOG_FILE, ensureServer, openBrowser } from './ensure-server.ts';

try {
  const started = await ensureServer();
  console.log(started ? `Probe started: ${BASE_URL}` : `Probe is already running: ${BASE_URL}`);
  if (!process.argv.includes('--no-open')) openBrowser(BASE_URL);
} catch (e) {
  console.error(`\nProbe could not start.\n${(e as Error).message}\nLog: ${LOG_FILE}`);
  // Keep the window open when started by double-click, so the message can be read.
  if (process.stdin.isTTY && !process.argv.includes('--no-pause')) {
    console.error('\nPress Enter to close.');
    await new Promise((r) => process.stdin.once('data', r));
  }
  process.exit(1);
}
