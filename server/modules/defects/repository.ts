import { all, get, run } from '../../core/db.ts';
import type { Defect } from '../../../shared/models.ts';

interface Row {
  id: string;
  service_id: string;
  run_id: string;
  fingerprint: string;
  title: string;
  severity: Defect['severity'];
  status: Defect['status'];
  page: string | null;
  feature: string | null;
  error: string;
  screenshot: string | null;
  trace: string | null;
  occurrences: number;
  first_seen: number;
  last_seen: number;
}

const toDefect = (r: Row): Defect => ({
  id: r.id,
  serviceId: r.service_id,
  runId: r.run_id,
  fingerprint: r.fingerprint,
  title: r.title,
  severity: r.severity,
  status: r.status,
  page: r.page,
  feature: r.feature,
  error: r.error,
  screenshot: r.screenshot,
  trace: r.trace,
  occurrences: r.occurrences,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
});

export const findById = (id: string): Defect | undefined => {
  const row = get<Row>('SELECT * FROM defects WHERE id = ?', id);
  return row && toDefect(row);
};

/** The defect a new identical failure should be merged into: still open, most recently seen. */
export const findOpenByFingerprint = (serviceId: string, fingerprint: string): Defect | undefined => {
  const row = get<Row>(`SELECT * FROM defects WHERE service_id = ? AND fingerprint = ? AND status IN ('candidate','confirmed') ORDER BY last_seen DESC LIMIT 1`, serviceId, fingerprint);
  return row && toDefect(row);
};

export function list(filter: { serviceId?: string; status?: string; runId?: string }, limit = 500): Defect[] {
  const where: string[] = [];
  const args: string[] = [];
  for (const [column, value] of [['service_id', filter.serviceId], ['status', filter.status], ['run_id', filter.runId]] as const) {
    if (value) {
      where.push(`${column} = ?`);
      args.push(value);
    }
  }
  return all<Row>(`SELECT * FROM defects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_seen DESC LIMIT ${limit}`, ...args).map(toDefect);
}

export type NewDefect = Omit<Defect, 'occurrences'>;

export function insert(d: NewDefect): void {
  run(
    `INSERT INTO defects (id, service_id, run_id, fingerprint, title, severity, status, page, feature, error, screenshot, trace, occurrences, first_seen, last_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    d.id, d.serviceId, d.runId, d.fingerprint, d.title, d.severity, d.status, d.page, d.feature, d.error, d.screenshot, d.trace, d.firstSeen, d.lastSeen,
  );
}

/** Another occurrence of a known defect: count it and refresh the evidence (keeping old evidence if there is none). */
export function recordOccurrence(id: string, o: { runId: string; seenAt: number; page: string | null; error: string; screenshot: string | null; trace: string | null }): void {
  run(
    'UPDATE defects SET occurrences = occurrences + 1, last_seen = ?, run_id = ?, screenshot = COALESCE(?, screenshot), trace = COALESCE(?, trace), page = COALESCE(?, page), error = ? WHERE id = ?',
    o.seenAt, o.runId, o.screenshot, o.trace, o.page, o.error, id,
  );
}

export const updateFields = (id: string, f: { status: string; severity: string; title: string }): void => void run('UPDATE defects SET status = ?, severity = ?, title = ? WHERE id = ?', f.status, f.severity, f.title, id);

export const countOpen = (serviceId: string): number => get<{ n: number }>(`SELECT COUNT(*) AS n FROM defects WHERE service_id = ? AND status IN ('candidate','confirmed')`, serviceId)!.n;

/** Distinct by fingerprint: the same failure repeated in one run is one defect. */
export const countForRun = (runId: string): number => get<{ n: number }>('SELECT COUNT(DISTINCT fingerprint) AS n FROM defects WHERE run_id = ?', runId)!.n;
