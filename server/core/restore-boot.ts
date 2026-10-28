/**
 * Finishes a restore that was prepared while the app was running. It must run before the database
 * is opened, which is why db.ts calls it first: the running server cannot swap its own files.
 *
 * A restore leaves the unpacked backup in `.restore-staging` and a `.restore-pending` marker. On the
 * next start the current data moves to `restore-undo/<time>/` (the last two are kept, so a mistake
 * can be undone by hand) and the staged data takes its place. If anything fails half way, what was
 * moved is put back.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HOME } from '../config.ts';

export const PENDING_NAME = '.restore-pending';
export const STAGING_NAME = '.restore-staging';
const KEEP_UNDO = 2;
const DATA_ITEMS = ['probe.db', 'probe.db-wal', 'probe.db-shm', 'master.key', 'services', 'runs'];

export function applyPendingRestore(home: string = HOME): boolean {
  const pending = join(home, PENDING_NAME);
  const staging = join(home, STAGING_NAME);
  if (!existsSync(pending)) return false;
  if (!existsSync(staging)) {
    rmSync(pending, { force: true });
    return false;
  }

  const undo = join(home, 'restore-undo', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(undo, { recursive: true });
  const moved: { from: string; to: string }[] = [];
  const move = (from: string, to: string) => {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    moved.push({ from, to });
  };

  try {
    const stagedClaude = join(staging, 'claude-projects');
    const claudeProjects = join(home, 'claude', 'projects');
    for (const item of DATA_ITEMS) if (existsSync(join(home, item))) move(join(home, item), join(undo, item));
    if (existsSync(stagedClaude) && existsSync(claudeProjects)) move(claudeProjects, join(undo, 'claude-projects'));

    for (const item of readdirSync(staging)) {
      if (item === 'manifest.json') continue;
      renameSync(join(staging, item), item === 'claude-projects' ? (mkdirSync(join(home, 'claude'), { recursive: true }), claudeProjects) : join(home, item));
    }
  } catch (e) {
    // Put everything back where it was, newest move first.
    for (const m of moved.reverse()) {
      try {
        if (existsSync(m.from)) rmSync(m.from, { recursive: true, force: true });
        renameSync(m.to, m.from);
      } catch {
        /* nothing more can be done; the undo folder still holds the data */
      }
    }
    throw e;
  }

  rmSync(staging, { recursive: true, force: true });
  rmSync(pending, { force: true });

  const undoRoot = join(home, 'restore-undo');
  for (const old of readdirSync(undoRoot).sort().slice(0, -KEEP_UNDO)) rmSync(join(undoRoot, old), { recursive: true, force: true });
  return true;
}
