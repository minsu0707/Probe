/**
 * Move a file to the computer's own trash (Windows Recycle Bin, macOS Trash, freedesktop trash),
 * so a deleted file can be put back from there. Throws when it could not, and the file stays where
 * it was: callers must not fall back to deleting for good.
 *
 * `recycler.move` is replaceable so tests never touch the real Recycle Bin.
 */
import { spawnSync } from 'node:child_process';

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(cmd, args, { env, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`휴지통으로 옮기지 못했습니다${r.stderr ? `: ${r.stderr.trim().split('\n')[0]}` : ''}`);
};

export const recycler = {
  move(path: string): void {
    if (process.platform === 'win32') {
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:PROBE_RECYCLE, 'OnlyErrorDialogs', 'SendToRecycleBin')"], { ...process.env, PROBE_RECYCLE: path });
    } else if (process.platform === 'darwin') {
      run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete POSIX file (item 1 of argv)', '-e', 'end run', path]);
    } else {
      run('gio', ['trash', path]);
    }
  },
};

export const moveToRecycleBin = (path: string): void => recycler.move(path);
