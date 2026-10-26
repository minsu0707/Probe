/**
 * Windows conveniences.
 *
 *   node scripts/windows.ts autostart on|off|status   start Probe when you log in (no window)
 *   node scripts/windows.ts shortcut                  put a "Probe" shortcut on the Desktop
 *
 * Both only create or remove one small file; nothing is installed or registered system-wide.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStartupVbs } from './startup-script.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32') {
  console.error('These helpers are for Windows. On other systems, run `npm start`.');
  process.exit(1);
}

/** PROBE_STARTUP_DIR exists so tests can run without touching the real Startup folder. */
const startupDir = process.env.PROBE_STARTUP_DIR ?? join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const startupFile = join(startupDir, 'Probe.vbs');

function autostart(action: string | undefined): void {
  if (action === 'on') {
    mkdirSync(startupDir, { recursive: true });
    writeFileSync(startupFile, buildStartupVbs({ nodePath: process.execPath, launchScript: join(ROOT, 'scripts', 'launch.ts'), root: ROOT }));
    console.log(`Probe will start when you log in.\n  ${startupFile}\nTurn off with: npm run autostart:off`);
  } else if (action === 'off') {
    rmSync(startupFile, { force: true });
    console.log('Autostart is off.');
  } else if (action === 'status') {
    console.log(existsSync(startupFile) ? `Autostart is on (${startupFile})` : 'Autostart is off');
  } else {
    console.error('Usage: autostart on|off|status');
    process.exit(1);
  }
}

/** Created with PowerShell's WScript.Shell; values go in through the environment to avoid quoting problems. */
function shortcut(): void {
  const script = `
    $desktop = [Environment]::GetFolderPath('Desktop')
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Probe.lnk'))
    $link.TargetPath = $env:PROBE_TARGET
    $link.WorkingDirectory = $env:PROBE_ROOT
    $link.WindowStyle = 7
    $link.Description = 'Start Probe and open the dashboard'
    $link.Save()
    Write-Output (Join-Path $desktop 'Probe.lnk')`;
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, PROBE_TARGET: join(ROOT, 'Probe.cmd'), PROBE_ROOT: ROOT },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`Could not create the shortcut.\n${result.stderr}`);
    process.exit(1);
  }
  console.log(`Shortcut created: ${result.stdout.trim()}`);
}

const [command, action] = process.argv.slice(2);
if (command === 'autostart') autostart(action);
else if (command === 'shortcut') shortcut();
else {
  console.error('Usage: windows.ts autostart on|off|status | shortcut');
  process.exit(1);
}
