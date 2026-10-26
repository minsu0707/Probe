import { all, get, run } from '../../core/db.ts';
import type { Doc } from '../../../shared/models.ts';

interface Row {
  id: string;
  service_id: string;
  kind: Doc['kind'];
  name: string;
  ref: string;
  mime: string | null;
  size: number;
  learned_at: number | null;
  added_at: number;
}

const toDoc = (r: Row): Doc => ({ id: r.id, serviceId: r.service_id, kind: r.kind, name: r.name, ref: r.ref, mime: r.mime, size: r.size, learnedAt: r.learned_at, addedAt: r.added_at });

export const findByService = (serviceId: string): Doc[] => all<Row>('SELECT * FROM documents WHERE service_id = ? ORDER BY added_at DESC', serviceId).map(toDoc);

export function findOne(serviceId: string, docId: string): Doc | undefined {
  const row = get<Row>('SELECT * FROM documents WHERE id = ? AND service_id = ?', docId, serviceId);
  return row && toDoc(row);
}

export const refExists = (serviceId: string, ref: string): boolean => Boolean(get('SELECT 1 FROM documents WHERE service_id = ? AND ref = ?', serviceId, ref));

export function insert(d: Omit<Doc, 'learnedAt' | 'mime'>): Doc {
  run('INSERT INTO documents (id, service_id, kind, name, ref, mime, size, added_at) VALUES (?,?,?,?,?,?,?,?)', d.id, d.serviceId, d.kind, d.name, d.ref, null, d.size, d.addedAt);
  return findOne(d.serviceId, d.id)!;
}

export const remove = (docId: string): void => void run('DELETE FROM documents WHERE id = ?', docId);

/** Called after a successful learning job: everything currently attached has been read. */
export const markAllLearned = (serviceId: string, at: number): void => void run('UPDATE documents SET learned_at = ? WHERE service_id = ?', at, serviceId);

export const count = (serviceId: string): number => get<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE service_id = ?', serviceId)!.n;
export const countUnlearned = (serviceId: string): number => get<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE service_id = ? AND learned_at IS NULL', serviceId)!.n;
