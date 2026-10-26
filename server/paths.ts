import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = resolve(process.env.PROBE_HOME ?? join(ROOT, 'data'));
export const DB_FILE = join(HOME, 'probe.db');
export const KEY_FILE = join(HOME, 'master.key');

export const serviceDir = (id: string) => join(HOME, 'services', id);
export const docsDir = (id: string) => join(serviceDir(id), 'docs');
export const knowledgeDir = (id: string) => join(serviceDir(id), 'knowledge');
export const testsDir = (id: string) => join(serviceDir(id), 'tests');
export const runsDir = (runId: string) => join(HOME, 'runs', runId);

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

ensureDir(HOME);
