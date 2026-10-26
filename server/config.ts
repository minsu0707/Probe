/**
 * Process-wide configuration: where data lives and which port to listen on.
 * Everything else asks this file for paths so the layout is defined once.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The probe/ folder (this file lives in probe/server/). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PORT = Number(process.env.PORT ?? 4317);

/** Root of everything Probe stores. Override with PROBE_HOME to relocate or to isolate tests. */
export const HOME = resolve(process.env.PROBE_HOME ?? join(ROOT, 'data'));
export const DB_FILE = join(HOME, 'probe.db');
export const KEY_FILE = join(HOME, 'master.key');

/** Built web app served by the HTTP layer. */
export const WEB_DIST = join(ROOT, 'dist');

/** Per-service workspace: `docs/` (uploads), `knowledge/` (learned), `tests/` (Playwright). */
export const serviceDir = (serviceId: string) => join(HOME, 'services', serviceId);
export const docsDir = (serviceId: string) => join(serviceDir(serviceId), 'docs');
export const knowledgeDir = (serviceId: string) => join(serviceDir(serviceId), 'knowledge');
export const testsDir = (serviceId: string) => join(serviceDir(serviceId), 'tests');

/** Artifacts kept from a run (failure screenshots, traces). */
export const runDir = (runId: string) => join(HOME, 'runs', runId);

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

ensureDir(HOME);
