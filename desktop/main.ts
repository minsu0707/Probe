/**
 * Desktop shell: the installed "Probe" app.
 *
 * It adds no features of its own. It starts the same server used everywhere else, shows the
 * dashboard in its own window, and lives in the system tray so tests can keep running with the
 * window closed. The server is a separate process (this executable acting as plain Node via
 * ELECTRON_RUN_AS_NODE), so a server crash can't take the window down and the server can also
 * be started without the window (Probe.cmd, the MCP server).
 *
 * Closing the window hides it to the tray. "종료" in the tray menu really quits.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import { checkForUpdate, initUpdater, installUpdate, updateState } from './updater.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4317);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 20_000;

// Installed builds keep data in %APPDATA%\Probe, away from the (replaceable) install folder.
// Dev runs (`npm run desktop`) keep using ./data unless PROBE_HOME says otherwise.
if (app.isPackaged && !process.env.PROBE_HOME) process.env.PROBE_HOME = app.getPath('userData');
const HOME = process.env.PROBE_HOME ?? join(ROOT, 'data');

app.setAppUserModelId('com.minsu0707.probe'); // groups the taskbar icon and lets notifications work

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: ChildProcess | null = null;
/** True only when this app started the server, so it only stops a server it owns. */
let ownsServer = false;
let quitting = false;

// ------------------------------------------------------------------- server

async function isProbeRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === 'probe';
  } catch {
    return false;
  }
}

async function startServer(): Promise<void> {
  if (await isProbeRunning()) return; // already up (Probe.cmd, autostart, MCP): just show it

  mkdirSync(HOME, { recursive: true });
  const log = openSync(join(HOME, 'probe.log'), 'a');
  server = spawn(process.execPath, [join(ROOT, 'server', 'main.ts')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROBE_HOME: HOME, PORT: String(PORT) },
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  closeSync(log);
  ownsServer = true;

  server.on('exit', (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox('Probe 서버가 멈췄습니다', `서버가 종료되었습니다 (코드 ${code}).\n자세한 내용: ${join(HOME, 'probe.log')}`);
    app.exit(1);
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isProbeRunning()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`서버가 ${START_TIMEOUT_MS / 1000}초 안에 시작되지 않았습니다.\n로그: ${join(HOME, 'probe.log')}`);
}

/** Port taken by something that isn't Probe: say so instead of showing a blank window. */
async function portIsForeign(): Promise<boolean> {
  try {
    await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return !(await isProbeRunning());
  } catch (e) {
    return (e as { cause?: { code?: string } }).cause?.code !== 'ECONNREFUSED';
  }
}

/**
 * Ask the server to stop. It refuses while a test run or learning job is active, in which case
 * the user decides. Returns false if the user chose to keep Probe running.
 */
async function stopServer(): Promise<boolean> {
  if (!ownsServer) return true; // a server we didn't start keeps running
  try {
    let res = await fetch(`${URL_BASE}/api/shutdown`, { method: 'POST' });
    if (res.status === 409) {
      const { error } = (await res.json()) as { error: string };
      const choice = dialog.showMessageBoxSync({ type: 'warning', buttons: ['계속 실행', '그래도 종료'], defaultId: 0, cancelId: 0, title: 'Probe', message: '작업이 진행 중입니다', detail: `${error}\n\n지금 종료하면 진행 중인 작업이 중단됩니다.` });
      if (choice === 0) return false;
      res = await fetch(`${URL_BASE}/api/shutdown?force=1`, { method: 'POST' });
    }
    return res.ok;
  } catch {
    return true; // already gone
  }
}

// ------------------------------------------------------------------- window

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false, // shown once painted, so there is no white flash
    title: 'Probe',
    icon: join(ROOT, 'desktop', 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1217' : '#edf0f3',
    autoHideMenuBar: true,
    webPreferences: { preload: join(ROOT, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  w.setMenuBarVisibility(false);
  void w.loadURL(URL_BASE);
  w.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) w.show();
  });

  // The dashboard is a local page; anything else (Drive links, docs) belongs in the real browser.
  const external = (url: string) => /^https?:\/\//.test(url) && !url.startsWith(URL_BASE);
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (external(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (external(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  w.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide(); // keep running in the tray
  });
  return w;
}

function showWindow(): void {
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// --------------------------------------------------------------------- tray

function createTray(): Tray {
  const icon = nativeImage.createFromPath(join(ROOT, 'desktop', 'assets', 'tray.png'));
  icon.addRepresentation({ scaleFactor: 2, dataURL: nativeImage.createFromPath(join(ROOT, 'desktop', 'assets', 'tray@2x.png')).toDataURL() });
  const t = new Tray(icon);
  t.setToolTip('Probe');
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Probe 열기', click: showWindow },
      { type: 'separator' },
      {
        label: 'Windows 로그인 시 자동 시작',
        type: 'checkbox',
        enabled: app.isPackaged, // a dev run would register the bare Electron binary
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      updateMenuItem(),
      { type: 'separator' },
      { label: '종료', click: () => void quit() },
    ]);
  t.on('click', showWindow);
  t.on('right-click', () => t.popUpContextMenu(menu())); // rebuilt each time so the checkbox is current
  return t;
}

/** Used by the updater just before the installer takes over: the server must be gone first. */
async function confirmInstall(): Promise<boolean> {
  if (!(await stopServer())) return false;
  quitting = true;
  return true;
}

/** No work running on the server, and the window is not in front of the user. */
async function safeToRestart(): Promise<boolean> {
  if (win?.isVisible() && win.isFocused() && !win.isMinimized()) return false;
  try {
    const res = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).busy === null;
  } catch {
    return true; // no server answering: nothing to interrupt
  }
}

function updateMenuItem(): Electron.MenuItemConstructorOptions {
  const u = updateState();
  if (u.phase === 'ready') return { label: `업데이트 설치 (v${u.version})`, click: () => void installUpdate() };
  return { label: '업데이트 확인', enabled: u.phase !== 'unsupported', click: () => void checkForUpdate() };
}

async function quit(): Promise<void> {
  if (!(await stopServer())) return;
  quitting = true;
  app.quit();
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second launch just brings the first one forward (see 'second-instance')
} else {
  app.on('second-instance', showWindow);
  Menu.setApplicationMenu(null);

  void app.whenReady().then(async () => {
    try {
      if (await portIsForeign()) throw new Error(`포트 ${PORT}을 다른 프로그램이 쓰고 있습니다.\n그 프로그램을 끄거나, PORT 환경 변수로 다른 포트를 지정하세요.`);
      await startServer();
    } catch (e) {
      dialog.showErrorBox('Probe를 시작할 수 없습니다', (e as Error).message);
      return app.exit(1);
    }
    tray = createTray();
    win = createWindow();
    initUpdater({ window: () => win, confirmInstall, safeToRestart });
  });

  // Closing the last window must not quit: the tray keeps the app alive.
  app.on('window-all-closed', () => undefined);

  // Last resort for OS shutdown or a forced quit: never leave an orphan server behind.
  app.on('before-quit', () => {
    quitting = true;
    if (ownsServer && server?.pid) {
      try {
        process.kill(server.pid);
      } catch {
        /* already exited */
      }
    }
  });
}

void tray; // referenced so the tray icon isn't garbage-collected
