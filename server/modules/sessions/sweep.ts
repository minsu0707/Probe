/**
 * Claude's tools here can read and write files but not delete them. To remove a spec it
 * overwrites the file with the marker below (or empties it), and Probe deletes it when the turn
 * ends. Only files under tests/specs/ are ever touched, and only if they hold nothing but the marker.
 */
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { testsDir } from '../../config.ts';

export const DELETE_MARKER = '// probe:delete';
const MAX_DEPTH = 4;
const MAX_BYTES = 1024;

/** Removes marked or empty files in the service's specs folder; returns their paths relative to it. */
export function sweepDeletedSpecs(serviceId: string): string[] {
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
          rmSync(path, { force: true });
          removed.push(relative(root, path).split(sep).join('/'));
        }
      }
    }
  };
  walk(root, 0);
  return removed;
}
