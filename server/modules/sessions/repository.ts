import { all, get, run } from '../../core/db.ts';
import type { Session, SessionKind, SessionMessage } from '../../../shared/models.ts';

interface Row {
  id: string;
  service_id: string;
  title: string;
  kind: SessionKind;
  status: Session['status'];
  claude_session_id: string;
  started: number;
  created_at: number;
  updated_at: number;
}

const toSession = (r: Row): Session => ({ id: r.id, serviceId: r.service_id, title: r.title, kind: r.kind, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });

export const findById = (id: string): Session | undefined => {
  const row = get<Row>('SELECT * FROM sessions WHERE id = ?', id);
  return row && toSession(row);
};

/** The CLI-side identity of a session, which the public Session shape deliberately leaves out. */
export const cli = (id: string): { claudeSessionId: string; started: boolean } | undefined => {
  const row = get<Row>('SELECT claude_session_id, started FROM sessions WHERE id = ?', id);
  return row && { claudeSessionId: row.claude_session_id, started: row.started === 1 };
};

export const forService = (serviceId: string): Session[] => all<Row>('SELECT * FROM sessions WHERE service_id = ? ORDER BY updated_at DESC', serviceId).map(toSession);

export const runningIn = (serviceId: string): Session | undefined => {
  const row = get<Row>('SELECT * FROM sessions WHERE service_id = ? AND status = ?', serviceId, 'running');
  return row && toSession(row);
};

export const insert = (s: { id: string; serviceId: string; title: string; kind: SessionKind; claudeSessionId: string; now: number }): void =>
  void run('INSERT INTO sessions (id, service_id, title, kind, status, claude_session_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', s.id, s.serviceId, s.title, s.kind, 'idle', s.claudeSessionId, s.now, s.now);

export const setStatus = (id: string, status: Session['status'], now: number): void => void run('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?', status, now, id);
export const markStarted = (id: string): void => void run('UPDATE sessions SET started = 1 WHERE id = ?', id);
export const remove = (id: string): void => void run('DELETE FROM sessions WHERE id = ?', id);

export function addMessage(sessionId: string, role: SessionMessage['role'], text: string, ts: number): SessionMessage {
  const { lastInsertRowid } = run('INSERT INTO session_messages (session_id, ts, role, text) VALUES (?,?,?,?)', sessionId, ts, role, text);
  return { id: Number(lastInsertRowid), sessionId, ts, role, text };
}

export const messages = (sessionId: string): SessionMessage[] =>
  all<{ id: number; session_id: string; ts: number; role: SessionMessage['role']; text: string }>('SELECT * FROM session_messages WHERE session_id = ? ORDER BY id', sessionId).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    ts: r.ts,
    role: r.role,
    text: r.text,
  }));
