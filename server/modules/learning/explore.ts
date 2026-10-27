/**
 * Phase one of a learning job that includes the live service: run the explorer (explorer.ts) in
 * its own process, with the service's sign-in handed over by name-matched variables, and leave its
 * notes in ./explore for Claude to read in phase two. Claude itself never touches the browser.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceDir } from '../../config.ts';
import { detectBrowserChannel } from '../runs/browser.ts';
import { listSecrets, runtimeEnv } from '../secrets/service.ts';
import { pickLogins } from './explore-helpers.ts';

/** More than this is a lot of waiting for little extra information. */
const MAX_ACCOUNTS = 8;

const EXPLORER = fileURLToPath(new URL('./explorer.ts', import.meta.url));
const STDERR_TAIL = 1500;

export const exploreDir = (serviceId: string): string => join(serviceDir(serviceId), 'explore');

export interface ExploreResult {
  ok: boolean;
  pages: number;
  note: string;
}

/** What the last exploration left behind, or null when there is none. */
export function exploreSummary(serviceId: string): { pages: number; signedIn: boolean; stoppedBy: string; accounts?: { name: string; signedIn: boolean; pages: number }[] } | null {
  try {
    if (!existsSync(join(exploreDir(serviceId), 'pages.md'))) return null;
    return JSON.parse(readFileSync(join(exploreDir(serviceId), 'summary.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Starts the explorer; `onChild` receives the process so a cancel request can kill it. */
export function exploreService(serviceId: string, baseUrl: string, progress: (line: string) => void, onChild: (c: ChildProcess) => void): Promise<ExploreResult> {
  const env = runtimeEnv(serviceId);
  const accounts = pickLogins(listSecrets(serviceId).map((s) => s.key))
    .slice(0, MAX_ACCOUNTS)
    .map((p) => ({ name: p.name, user: env[p.userKey] ?? '', pass: env[p.passKey] ?? '' }));

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [EXPLORER], {
      cwd: serviceDir(serviceId),
      env: {
        ...process.env,
        PROBE_EXPLORE_URL: baseUrl,
        PROBE_EXPLORE_OUT: exploreDir(serviceId),
        PROBE_EXPLORE_ACCOUNTS: JSON.stringify(accounts),
        PROBE_BROWSER_CHANNEL: detectBrowserChannel() ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    onChild(child);

    let pages = 0;
    let stderr = '';
    let pending = '';
    child.stderr!.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-STDERR_TAIL)));
    child.stdout!.on('data', (d: Buffer) => {
      pending += d.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const ev = JSON.parse(line) as { type: string; text?: string; pages?: number };
          if (ev.type === 'progress' && ev.text) progress(ev.text);
          if (ev.type === 'done') pages = ev.pages ?? pages;
        } catch {
          /* not one of ours */
        }
      }
    });
    child.on('error', (e) => resolve({ ok: false, pages: 0, note: `둘러보기를 시작하지 못했습니다: ${e.message}` }));
    child.on('close', (code) => {
      const summary = exploreSummary(serviceId);
      if (code === 0 && summary) return resolve({ ok: true, pages: summary.pages, note: `${summary.pages}개 화면을 둘러봤습니다${summary.accounts && summary.accounts.length > 1 ? ` (계정 ${summary.accounts.length}개: ${summary.accounts.map((a) => `${a.name} ${a.signedIn ? a.pages : '로그인 실패'}`).join(', ')})` : ''}` });
      resolve({ ok: false, pages: pages, note: `둘러보기가 끝나지 않았습니다${stderr ? `: ${stderr.trim().split('\n').slice(-2).join(' ')}` : ''}` });
    });
  });
}
