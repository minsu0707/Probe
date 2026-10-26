/**
 * Database schema. Every statement is idempotent (`IF NOT EXISTS`), and child tables
 * cascade from `services`, so deleting a service removes everything that belongs to it.
 *
 * There are no migrations yet. When the schema first needs to change, add a
 * `schema_version` table here instead of editing these statements in place.
 */
export const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  -- Environment variables. \`value\` is always encrypted; \`sensitive\` controls whether
  -- the UI may ever display it.
  CREATE TABLE IF NOT EXISTS secrets (
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    sensitive INTEGER NOT NULL,
    PRIMARY KEY (service_id, key)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,            -- 'file' | 'drive'
    name TEXT NOT NULL,
    ref TEXT NOT NULL,             -- file name under docs/, or the Drive URL
    mime TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    learned_at INTEGER,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    totals TEXT NOT NULL,          -- JSON RunTotals
    current TEXT NOT NULL          -- JSON RunCurrent
  );

  CREATE TABLE IF NOT EXISTS run_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT
  );
  CREATE INDEX IF NOT EXISTS run_log_run ON run_log(run_id, id);

  CREATE TABLE IF NOT EXISTS defects (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL,
    page TEXT,
    feature TEXT,
    error TEXT NOT NULL,
    screenshot TEXT,
    trace TEXT,
    occurrences INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS defects_fp ON defects(service_id, fingerprint);

  -- Small app-wide preferences (e.g. which Claude profile to use).
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Claude conversations. claude_session_id is the CLI's own id, used with --session-id/--resume;
  -- started flips to 1 once the CLI has created it, so the next turn resumes instead of creating.
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    claude_session_id TEXT NOT NULL,
    started INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS session_messages_s ON session_messages(session_id, id);

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    log TEXT NOT NULL DEFAULT '[]', -- JSON string[]
    summary TEXT
  );
`;
