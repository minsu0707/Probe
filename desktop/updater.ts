/**
 * Self-update of the installed app, from the GitHub Releases of this project (electron-updater).
 *
 * New versions are downloaded in the background and installed the next time the app quits or the
 * user chooses "지금 재시작해서 업데이트". It never restarts on its own: a test run or a Claude
 * session may be in progress.
 *
 * PROBE_UPDATE_URL points the app at any folder or server that holds `latest.yml` and the
 * installer, which is how the update flow is tested without publishing a release.
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/models.ts';
import { briefError, reduceUpdate, type UpdateEvent } from './update-state.ts';

const { autoUpdater } = electronUpdater;

const FIRST_CHECK_DELAY_MS = 15_000; // let the window and server settle first
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const testFeed = process.env.PROBE_UPDATE_URL;
/** Dev runs have no installer to replace; a test feed makes the flow testable anywhere. */
const enabled = app.isPackaged || Boolean(testFeed);

let state: UpdateState = enabled ? { phase: 'idle', currentVersion: app.getVersion(), checkedAt: null } : { phase: 'unsupported', currentVersion: app.getVersion() };
let getWindow: () => BrowserWindow | null = () => null;
let beforeInstall: () => Promise<boolean> = async () => true;

function apply(ev: UpdateEvent): void {
  state = reduceUpdate(state, ev);
  getWindow()?.webContents.send('update:state', state);
}

export const updateState = (): UpdateState => state;

export async function checkForUpdate(): Promise<UpdateState> {
  if (!enabled || state.phase === 'checking' || state.phase === 'downloading') return state;
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
  if (state.phase !== 'ready') return false;
  if (!(await beforeInstall())) return false;
  autoUpdater.quitAndInstall(true, true); // silent, and start the new version afterwards
  return true;
}

/**
 * Wire the updater. `confirmInstall` runs before the app quits to install (it stops the server,
 * which is a second Probe.exe the installer could not replace); returning false cancels.
 */
export function initUpdater(opts: { window: () => BrowserWindow | null; confirmInstall: () => Promise<boolean> }): void {
  getWindow = opts.window;
  beforeInstall = opts.confirmInstall;

  ipcMain.handle('update:get', () => state);
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:install', () => installUpdate());

  if (!enabled) return;
  if (testFeed) autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
  autoUpdater.autoDownload = true;
  // A test feed must never install anything: the installer would replace the real installed app.
  autoUpdater.autoInstallOnAppQuit = !testFeed;
  autoUpdater.on('update-available', (i) => apply({ type: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => apply({ type: 'none', at: Date.now() }));
  autoUpdater.on('download-progress', (p) => apply({ type: 'progress', percent: p.percent }));
  autoUpdater.on('update-downloaded', (i) => apply({ type: 'downloaded', version: i.version }));
  autoUpdater.on('error', (e) => apply({ type: 'error', message: briefError(e) }));

  setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
