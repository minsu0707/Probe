import { all, run } from '../../core/db.ts';
import { isSensitiveKey } from './classify.ts';

export interface SecretRow {
  key: string;
  /** Encrypted with the master key. */
  value: string;
  sensitive: boolean;
}

interface Row {
  key: string;
  value: string;
  sensitive: number;
}

// The rule is applied on every read, not only when a file is uploaded, so a name the rule learns
// later (like PW) is hidden for values stored before it did.
const toRow = (r: Row): SecretRow => ({ key: r.key, value: r.value, sensitive: r.sensitive === 1 || isSensitiveKey(r.key) });

export const findByService = (serviceId: string): SecretRow[] =>
  all<Row>('SELECT key, value, sensitive FROM secrets WHERE service_id = ? ORDER BY key', serviceId).map(toRow);

export const count = (serviceId: string): number => all<{ n: number }>('SELECT COUNT(*) AS n FROM secrets WHERE service_id = ?', serviceId)[0].n;

/** Insert, or overwrite a key that already exists. */
export function upsert(serviceId: string, row: SecretRow): void {
  run(
    `INSERT INTO secrets (service_id, key, value, sensitive) VALUES (?,?,?,?)
     ON CONFLICT(service_id, key) DO UPDATE SET value = excluded.value, sensitive = excluded.sensitive`,
    serviceId,
    row.key,
    row.value,
    row.sensitive ? 1 : 0,
  );
}

export const remove = (serviceId: string, key: string): void => void run('DELETE FROM secrets WHERE service_id = ? AND key = ?', serviceId, key);
