import { spawnSync, type ChildProcess } from 'node:child_process';

/**
 * The desktop app runs the server by starting its own executable with ELECTRON_RUN_AS_NODE=1
 * (so it behaves as plain Node). That flag is inherited by every child. Playwright's Node
 * process needs it (its `process.execPath` is the app), but a native program such as the
 * `claude` CLI must not see it, so those spawns use this cleaned copy of the environment.
 */
export function envWithoutElectronFlag(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _drop, ...rest } = env;
  return rest;
}

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
