/**
 * SQLite access. The schema is created on import, so any module can query immediately.
 * Modules keep their SQL in their own `repository.ts`; this file only provides the
 * connection and thin typed helpers.
 */
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE } from '../config.ts';
import { SCHEMA } from './schema.ts';

export const db = new DatabaseSync(DB_FILE);
db.exec(SCHEMA);

// Columns added after the first release. CREATE TABLE IF NOT EXISTS does not touch an existing table.
const addColumn = (table: string, column: string, definition: string) => {
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};
addColumn('services', 'read_only', 'INTEGER NOT NULL DEFAULT 0');

type Param = string | number | null;

export const all = <T>(sql: string, ...args: Param[]): T[] => db.prepare(sql).all(...args) as T[];
export const get = <T>(sql: string, ...args: Param[]): T | undefined => db.prepare(sql).get(...args) as T | undefined;
export const run = (sql: string, ...args: Param[]) => db.prepare(sql).run(...args);

/** Run `fn` atomically: commit if it returns, roll back if it throws. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * A crash or restart leaves runs and jobs marked "running" forever. Call once at startup
 * to close them out so the UI doesn't show a ghost run.
 */
export function recoverInterrupted(now = Date.now()): void {
  run(`UPDATE runs SET status = 'error', ended_at = ? WHERE status IN ('starting','running')`, now);
  run(`UPDATE jobs SET status = 'failed', ended_at = ? WHERE status = 'running'`, now);
  run(`UPDATE sessions SET status = 'failed', updated_at = ? WHERE status = 'running'`, now);
}
