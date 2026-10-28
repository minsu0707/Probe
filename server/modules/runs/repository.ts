import { all, get, run } from '../../core/db.ts';
import type { LogLine, RunStatus, RunSummary, TestStatus } from '../../../shared/models.ts';

interface Row {
  id: string;
  service_id: string;
  title: string;
  status: RunStatus;
  started_at: number;
  ended_at: number | null;
  totals: string;
  current: string;
}

/** `defects` is filled in by the service layer; it lives in another table. */
const toSummary = (r: Row): RunSummary => ({
  id: r.id,
  serviceId: r.service_id,
  title: r.title,
  status: r.status,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  totals: JSON.parse(r.totals),
  current: JSON.parse(r.current),
  defects: 0,
});

export const insertRun = (s: RunSummary): void =>
  void run('INSERT INTO runs (id, service_id, title, status, started_at, totals, current) VALUES (?,?,?,?,?,?,?)', s.id, s.serviceId, s.title, s.status, s.startedAt, JSON.stringify(s.totals), JSON.stringify(s.current));

export const saveRun = (s: RunSummary): void => void run('UPDATE runs SET status = ?, ended_at = ?, totals = ?, current = ? WHERE id = ?', s.status, s.endedAt, JSON.stringify(s.totals), JSON.stringify(s.current), s.id);

export const findRun = (id: string): RunSummary | undefined => {
  const row = get<Row>('SELECT * FROM runs WHERE id = ?', id);
  return row && toSummary(row);
};

export const listRuns = (serviceId: string | undefined, limit: number): RunSummary[] =>
  (serviceId ? all<Row>('SELECT * FROM runs WHERE service_id = ? ORDER BY started_at DESC LIMIT ?', serviceId, limit) : all<Row>('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?', limit)).map(toSummary);

export const deleteRun = (id: string): void => void run('DELETE FROM runs WHERE id = ?', id); // run_log goes with it (cascade)

export const appendLog = (runId: string, line: { ts: number; kind: string; text: string; status?: TestStatus }): void =>
  void run('INSERT INTO run_log (run_id, ts, kind, text, status) VALUES (?,?,?,?,?)', runId, line.ts, line.kind, line.text, line.status ?? null);

export const logAfter = (runId: string, afterId: number, limit: number): LogLine[] =>
  all<LogLine>('SELECT id, ts, kind, text, status FROM run_log WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?', runId, afterId, limit);
