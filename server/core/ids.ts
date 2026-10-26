import { randomUUID } from 'node:crypto';

/** Short id for rows people see in URLs and logs. 8 hex chars is plenty for a single-user tool. */
export const newId = () => randomUUID().slice(0, 8);
