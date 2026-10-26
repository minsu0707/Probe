import { all, get, run } from '../../core/db.ts';
import type { Service } from '../../../shared/models.ts';

interface Row {
  id: string;
  name: string;
  base_url: string | null;
  notes: string | null;
  created_at: number;
}

const toService = (r: Row): Service => ({ id: r.id, name: r.name, baseUrl: r.base_url, notes: r.notes, createdAt: r.created_at });

export const findAll = (): Service[] => all<Row>('SELECT * FROM services ORDER BY created_at').map(toService);

export function findById(id: string): Service | undefined {
  const row = get<Row>('SELECT * FROM services WHERE id = ?', id);
  return row && toService(row);
}

/** Case-insensitive, so "Shop" and "shop" can't both exist. */
export const nameTaken = (name: string): boolean => Boolean(get('SELECT 1 FROM services WHERE lower(name) = lower(?)', name));

export function insert(s: Service): void {
  run('INSERT INTO services (id, name, base_url, notes, created_at) VALUES (?,?,?,?,?)', s.id, s.name, s.baseUrl, s.notes, s.createdAt);
}

export function update(s: Pick<Service, 'id' | 'name' | 'baseUrl' | 'notes'>): void {
  run('UPDATE services SET name = ?, base_url = ?, notes = ? WHERE id = ?', s.name, s.baseUrl, s.notes, s.id);
}

/** Only sets the URL; used when an env file supplies BASE_URL for a service that has none. */
export const setBaseUrl = (id: string, baseUrl: string): void => void run('UPDATE services SET base_url = ? WHERE id = ?', baseUrl, id);

export const remove = (id: string): void => void run('DELETE FROM services WHERE id = ?', id);
