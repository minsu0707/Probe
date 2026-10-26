import { all, get, run } from '../../core/db.ts';
import type { Job } from '../../../shared/models.ts';

interface Row {
  id: string;
  service_id: string;
  kind: Job['kind'];
  status: Job['status'];
  started_at: number;
  ended_at: number | null;
  log: string;
  summary: string | null;
}

const toJob = (r: Row): Job => ({ id: r.id, serviceId: r.service_id, kind: r.kind, status: r.status, startedAt: r.started_at, endedAt: r.ended_at, log: JSON.parse(r.log), summary: r.summary });

export const findById = (id: string): Job | undefined => {
  const row = get<Row>('SELECT * FROM jobs WHERE id = ?', id);
  return row && toJob(row);
};

export const findRunning = (serviceId: string): Job | undefined => {
  const row = get<Row>('SELECT * FROM jobs WHERE service_id = ? AND status = ?', serviceId, 'running');
  return row && toJob(row);
};

export const recent = (serviceId: string, limit: number): Job[] => all<Row>('SELECT * FROM jobs WHERE service_id = ? ORDER BY started_at DESC LIMIT ?', serviceId, limit).map(toJob);

export const insert = (id: string, serviceId: string, startedAt: number): void =>
  void run('INSERT INTO jobs (id, service_id, kind, status, started_at, log) VALUES (?,?,?,?,?,?)', id, serviceId, 'learn', 'running', startedAt, '[]');

export const saveLog = (id: string, lines: string[]): void => void run('UPDATE jobs SET log = ? WHERE id = ?', JSON.stringify(lines), id);

export const close = (id: string, status: Job['status'], endedAt: number, summary: string | null, lines: string[]): void =>
  void run('UPDATE jobs SET status = ?, ended_at = ?, summary = ?, log = ? WHERE id = ?', status, endedAt, summary, JSON.stringify(lines), id);

export const markCancelled = (id: string, endedAt: number): void => void run('UPDATE jobs SET status = ?, ended_at = ? WHERE id = ?', 'cancelled', endedAt, id);

export const isLearning = (serviceId: string): boolean => Boolean(findRunning(serviceId));
