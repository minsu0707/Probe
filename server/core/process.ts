import { spawnSync, type ChildProcess } from 'node:child_process';

/**
 * Stop a child and everything it started. Playwright spawns browsers, so killing only
 * the parent would leave them running. Windows has no process groups, hence taskkill.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}
