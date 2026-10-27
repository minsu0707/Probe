/**
 * Claude's tools here can read and write files but not delete them. To remove a spec it
 * overwrites the file with the marker below (or empties it), and Probe deletes it when the turn
 * ends. Only files under tests/specs/ are ever touched, and only if they hold nothing but the marker.
 *
 * Nothing is lost for good: the specs are read before the turn (`snapshotSpecs`), and a file that
 * gets removed is saved to the service's trash with its earlier content.
 */
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { testsDir } from '../../config.ts';
import { trashFileContent } from '../runs/trash.ts';

export const DELETE_MARKER = '// probe:delete';
const MAX_DEPTH = 4;
const MAX_BYTES = 1024;

const rel = (root: string, path: string) => relative(root, path).split(sep).join('/');

/** Contents of every spec file now (path relative to specs/), taken before Claude's turn. */
export function snapshotSpecs(serviceId: string): Map<string, string> {
  const root = join(testsDir(serviceId), 'specs');
  const out = new Map<string, string>();
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(path, depth + 1);
      } else if (e.isFile()) out.set(rel(root, path), readFileSync(path, 'utf8'));
    }
  };
  walk(root, 0);
  return out;
}

/** Moves marked or empty files in the service's specs folder to the trash; returns their paths relative to it. */
export function sweepDeletedSpecs(serviceId: string, before: ReadonlyMap<string, string> = new Map()): string[] {
  const root = join(testsDir(serviceId), 'specs');
  const removed: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no specs folder yet
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) walk(path, depth + 1);
      } else if (e.isFile() && statSync(path).size <= MAX_BYTES) {
        const text = readFileSync(path, 'utf8').trim();
        if (text === '' || text === DELETE_MARKER) {
          const name = rel(root, path);
          const old = before.get(name);
          if (old !== undefined) trashFileContent(serviceId, name, old);
          rmSync(path, { force: true });
          removed.push(name);
        }
      }
    }
  };
  walk(root, 0);
  return removed;
}
