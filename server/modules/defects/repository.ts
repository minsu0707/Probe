import { all, get, run } from '../../core/db.ts';
import type { AnswerVerdict, Defect, DefectAnswer } from '../../../shared/models.ts';
import { guessCause } from './classify.ts';

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
  follows_id: string | null;
}

const toDefect = (r: Row, answer: DefectAnswer | null = null): Defect => ({
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
  cause: guessCause(r.error),
  followsId: r.follows_id,
  answer,
});

interface AnswerRow {
  service_id: string;
  fingerprint: string;
  verdict: AnswerVerdict;
  note: string;
  subject: string;
  answered_at: number;
}
const toAnswer = (a: AnswerRow): DefectAnswer => ({ verdict: a.verdict, note: a.note, answeredAt: a.answered_at });
export const answerFor = (serviceId: string, fingerprint: string): DefectAnswer | null => {
  const row = get<AnswerRow>('SELECT * FROM defect_answers WHERE service_id = ? AND fingerprint = ?', serviceId, fingerprint);
  return row ? toAnswer(row) : null;
};

export const findById = (id: string): Defect | undefined => {
  const row = get<Row>('SELECT * FROM defects WHERE id = ?', id);
  return row && toDefect(row, answerFor(row.service_id, row.fingerprint));
};

export function saveAnswer(serviceId: string, fingerprint: string, a: { verdict: AnswerVerdict; note: string; subject: string; now: number }): void {
  run(
    `INSERT INTO defect_answers (service_id, fingerprint, verdict, note, subject, answered_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(service_id, fingerprint) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, subject = excluded.subject, answered_at = excluded.answered_at`,
    serviceId, fingerprint, a.verdict, a.note, a.subject, a.now,
  );
}
export const removeAnswer = (serviceId: string, fingerprint: string): void => void run('DELETE FROM defect_answers WHERE service_id = ? AND fingerprint = ?', serviceId, fingerprint);

/** The newest answers of a service, for Claude's standing instructions. */
export const recentAnswers = (serviceId: string, limit: number): { subject: string; verdict: AnswerVerdict; note: string }[] =>
  all<AnswerRow>('SELECT * FROM defect_answers WHERE service_id = ? ORDER BY answered_at DESC LIMIT ?', serviceId, limit).map((a) => ({ subject: a.subject, verdict: a.verdict, note: a.note }));

/** The defect a new identical failure should be merged into: still open or dismissed as a false alarm (so it stays dismissed), most recently seen. */
export const findOpenByFingerprint = (serviceId: string, fingerprint: string): Defect | undefined => {
  const row = get<Row>(`SELECT * FROM defects WHERE service_id = ? AND fingerprint = ? AND status IN ('candidate','confirmed','false_positive') ORDER BY last_seen DESC LIMIT 1`, serviceId, fingerprint);
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
  const rows = all<Row>(`SELECT * FROM defects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_seen DESC LIMIT ${limit}`, ...args);
  const answers = new Map(all<AnswerRow>('SELECT * FROM defect_answers').map((a) => [`${a.service_id}|${a.fingerprint}`, toAnswer(a)]));
  return rows.map((r) => toDefect(r, answers.get(`${r.service_id}|${r.fingerprint}`) ?? null));
}

export type NewDefect = Omit<Defect, 'occurrences' | 'cause' | 'followsId' | 'answer'> & { followsId?: string | null };

export function insert(d: NewDefect): void {
  run(
    `INSERT INTO defects (id, service_id, run_id, fingerprint, title, severity, status, page, feature, error, screenshot, trace, occurrences, first_seen, last_seen, follows_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    d.id, d.serviceId, d.runId, d.fingerprint, d.title, d.severity, d.status, d.page, d.feature, d.error, d.screenshot, d.trace, d.firstSeen, d.lastSeen, d.followsId ?? null,
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

export const removeMany = (serviceId: string, ids: string[]): string[] =>
  ids.filter((id) => Number(run('DELETE FROM defects WHERE id = ? AND service_id = ?', id, serviceId).changes) > 0);

export const countOpen = (serviceId: string): number => get<{ n: number }>(`SELECT COUNT(*) AS n FROM defects WHERE service_id = ? AND status IN ('candidate','confirmed')`, serviceId)!.n;

/** Distinct by fingerprint: the same failure repeated in one run is one defect. */
export const countForRun = (runId: string): number => get<{ n: number }>('SELECT COUNT(DISTINCT fingerprint) AS n FROM defects WHERE run_id = ?', runId)!.n;
