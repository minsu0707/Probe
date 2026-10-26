/**
 * Which browser the tests run in.
 *
 * Playwright's own Chromium is a ~150 MB download, which an installed desktop app shouldn't
 * require. Windows always has Edge (also Chromium-based), so Edge is preferred, then Chrome.
 * If neither exists the bundled Chromium is used, which needs `npx playwright install chromium`.
 *
 * Override with PROBE_BROWSER = msedge | chrome | chromium.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserChannel = 'msedge' | 'chrome';

/** Where the browsers live on Windows. Program Files first: a machine-wide install wins. */
function windowsCandidates(): { channel: BrowserChannel; path: string }[] {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((r): r is string => Boolean(r));
  return roots.flatMap((root) => [
    { channel: 'msedge' as const, path: join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { channel: 'chrome' as const, path: join(root, 'Google', 'Chrome', 'Application', 'chrome.exe') },
  ]);
}

/** @returns the Playwright channel to use, or undefined for the bundled Chromium. */
export function detectBrowserChannel(env: NodeJS.ProcessEnv = process.env): BrowserChannel | undefined {
  const forced = env.PROBE_BROWSER?.toLowerCase();
  if (forced === 'chromium') return undefined;
  if (forced === 'msedge' || forced === 'chrome') return forced;
  if (process.platform !== 'win32') return undefined; // Linux/macOS: keep Playwright's default

  const found = windowsCandidates().filter((c) => existsSync(c.path));
  return found.find((c) => c.channel === 'msedge')?.channel ?? found.find((c) => c.channel === 'chrome')?.channel;
}
