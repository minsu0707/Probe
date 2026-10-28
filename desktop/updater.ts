/**
 * Self-update of the installed app, from the GitHub Releases of this project (electron-updater).
 *
 * New versions are downloaded in the background. They are installed when the user chooses to (the
 * popup, the settings button, the tray item), or by themselves only if the user turned on
 * "자동 설치" in Settings: then at a quiet moment, never while a test run or Claude session works.
 * Default is off.
 *
 * PROBE_UPDATE_URL points the app at any folder or server that holds `latest.yml` and the
 * installer, which is how the update flow is tested without publishing a release.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, Notification, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/models.ts';
import { briefError, reduceUpdate, type UpdateEvent } from './update-state.ts';

const { autoUpdater } = electronUpdater;

const FIRST_CHECK_DELAY_MS = 15_000; // let the window and server settle first
const CHECK_EVERY_MS = 5 * 60 * 1000; // a release shows up without pressing anything; this is one small file from github.com
/** Coming back to the window checks too (a release may have landed while it sat in the background), but not more often than this. */
const FOCUS_CHECK_GAP_MS = 60 * 1000;
const IDLE_POLL_MS = 30_000;
/** Lets the page paint its "installing" screen before the window goes away. */
const PAINT_DELAY_MS = 1500;

const testFeed = process.env.PROBE_UPDATE_URL;
/** Dev runs have no installer to replace; a test feed makes the flow testable anywhere. */
const enabled = app.isPackaged || Boolean(testFeed);

let state: UpdateState = enabled ? { phase: 'idle', currentVersion: app.getVersion(), checkedAt: null } : { phase: 'unsupported', currentVersion: app.getVersion() };
let getWindow: () => BrowserWindow | null = () => null;
let beforeInstall: () => Promise<boolean> = async () => true;
let isSafeToRestart: () => Promise<boolean> = async () => false;

const autoFile = () => join(process.env.PROBE_HOME ?? app.getPath('userData'), 'auto-update');
/** The "자동 설치" setting; off until the user turns it on. */
export function autoInstallEnabled(): boolean {
  try {
    return readFileSync(autoFile(), 'utf8').trim() === 'on';
  } catch {
    return false;
  }
}
function setAutoInstall(on: boolean): boolean {
  try {
    writeFileSync(autoFile(), on ? 'on' : 'off');
  } catch {
    /* keep the old value */
  }
  if (autoInstallEnabled() && state.phase === 'ready' && !testFeed) void installWhenSafe();
  return autoInstallEnabled();
}

/** One line per update event in <data>/update.log, so "it didn't update" can be answered from the file. */
function log(line: string): void {
  try {
    appendFileSync(join(process.env.PROBE_HOME ?? app.getPath('userData'), 'update.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never break updating */
  }
}

function apply(ev: UpdateEvent): void {
  if (ev.type !== 'progress') log(JSON.stringify(ev));
  state = reduceUpdate(state, ev);
  getWindow()?.webContents.send('update:state', state);
}

export const updateState = (): UpdateState => state;

export async function checkForUpdate(): Promise<UpdateState> {
  // A downloaded update does not stop the checks: a newer release may have come out since.
  if (!enabled || state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing') return state;
  apply({ type: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    apply({ type: 'error', message: briefError(e) });
  }
  return state;
}

/** Quit and run the installer, after `beforeInstall` has stopped the server. False if nothing is ready or the user declined. */
export async function installUpdate(): Promise<boolean> {
  if (state.phase !== 'ready' || state.newerVersion) return false; // a newer one is on its way: install that, not this
  if (!(await beforeInstall())) return false;
  const version = state.version;
  log(`installing v${version}`);
  apply({ type: 'installing', version });
  // The window may be hidden (auto-update while it sits in the tray), so say it in a notification too.
  new Notification({ title: 'Probe를 업데이트하는 중', body: `v${version}을(를) 설치합니다. 1~2분 걸리고, 끝나면 자동으로 다시 열립니다.` }).show();
  await new Promise((r) => setTimeout(r, PAINT_DELAY_MS));
  // Not silent: unpacking the installer takes a minute or two (it is ~250 MB), and with no window at all
  // it looks as if the app just vanished. The installer's own progress window shows it is working, and
  // the new version starts by itself when it is done.
  autoUpdater.quitAndInstall(false, true);
  return true;
}

/**
 * Restart into the new version by itself, but only at a moment nobody would notice: no test run,
 * learning job or Claude session working, and the window is hidden, minimized or not in front.
 * Until then it keeps asking every 30 s; the banner and the settings button work in the meantime.
 */
let autoLoopRunning = false;
async function installWhenSafe(): Promise<void> {
  if (autoLoopRunning) return;
  autoLoopRunning = true;
  try {
    await autoInstallLoop();
  } finally {
    autoLoopRunning = false;
  }
}

async function autoInstallLoop(): Promise<void> {
  while (state.phase === 'ready' && autoInstallEnabled()) {
    if (!state.newerVersion && (await isSafeToRestart())) {
      log('installing: idle');
      if (await installUpdate()) return;
    }
    await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
  }
}

/** After an update the new version opens by itself; say so, once, so it is clear the update worked. */
function announceUpdateDone(): void {
  const file = join(process.env.PROBE_HOME ?? app.getPath('userData'), 'last-version');
  let previous = '';
  try {
    previous = readFileSync(file, 'utf8').trim();
  } catch {
    /* first run */
  }
  try {
    writeFileSync(file, app.getVersion());
  } catch {
    return;
  }
  if (previous && previous !== app.getVersion()) {
    log(`updated ${previous} -> ${app.getVersion()}`);
    new Notification({ title: 'Probe가 업데이트되었습니다', body: `v${previous} → v${app.getVersion()}` }).show();
  }
}

/**
 * Wire the updater. `confirmInstall` runs before the app quits to install (it stops the server,
 * which is a second Probe.exe the installer could not replace); returning false cancels.
 */
export function initUpdater(opts: { window: () => BrowserWindow | null; confirmInstall: () => Promise<boolean>; safeToRestart: () => Promise<boolean> }): void {
  getWindow = opts.window;
  beforeInstall = opts.confirmInstall;
  isSafeToRestart = opts.safeToRestart;

  ipcMain.handle('update:get', () => state);
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('update:get-auto', () => autoInstallEnabled());
  ipcMain.handle('update:set-auto', (_e, on: boolean) => setAutoInstall(Boolean(on)));

  if (!enabled) return;
  if (testFeed) autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
  autoUpdater.autoDownload = true;
  // Installing is the user's click, or the "자동 설치" setting. Quitting alone never installs.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', (i) => apply({ type: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => apply({ type: 'none', at: Date.now() }));
  autoUpdater.on('download-progress', (p) => apply({ type: 'progress', percent: p.percent }));
  autoUpdater.on('update-downloaded', (i) => {
    apply({ type: 'downloaded', version: i.version });
    if (!testFeed && autoInstallEnabled()) void installWhenSafe();
  });
  autoUpdater.on('error', (e) => apply({ type: 'error', message: briefError(e) }));

  log(`start v${app.getVersion()}${testFeed ? ` (test feed ${testFeed})` : ''}`);
  announceUpdateDone();
  setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  let lastCheckAt = Date.now();
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheckAt < FOCUS_CHECK_GAP_MS) return;
    lastCheckAt = Date.now();
    void checkForUpdate();
  });
}
