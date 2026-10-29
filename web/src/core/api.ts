/**
 * Typed client for the Probe HTTP API. Every call returns parsed JSON (or text for the .enc
 * export) and throws `ApiError` with a message safe to show the user.
 */
import type { SessionPrefs } from '../../../shared/session-prefs.ts';
import type { AnswerVerdict } from '../../../shared/models.ts';
import type { ClaudeAgentStatus, ClaudeProfile, ClaudeUsage, Defect, DefectStatus, Doc, Job, KnowledgeFile, LogLine, LoginState, QueuedMessage, RunSummary, SecretMeta, ServiceOverview, Session, SessionKind, SessionMessage, Severity, TestCase, UsageWindow } from '../../../shared/models.ts';

export type { ClaudeAgentStatus, ClaudeProfile, ClaudeUsage, Defect, Doc, Job, KnowledgeFile, LogLine, LoginState, QueuedMessage, RunSummary, SecretMeta, ServiceOverview, Session, SessionKind, SessionMessage, TestCase, UsageWindow };

export interface McpStatus {
  installed: boolean;
  registered: boolean;
  stale: boolean;
  command: string;
}
export interface McpResult extends McpStatus {
  ok: boolean;
  output: string;
}

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. Probe 서버가 실행 중인지 확인하세요.');
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `요청 실패 (${res.status})`);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  health: () => call<{ app: 'probe'; version: string; pid: number; root: string; browser: 'msedge' | 'chrome' | 'chromium'; busy: string | null }>('/api/health'),

  // agents
  claude: () => call<ClaudeAgentStatus>('/api/agents/claude'),
  setClaudeProfile: (profile: ClaudeProfile) => call<ClaudeAgentStatus>('/api/agents/claude/profile', json('PUT', { profile })),
  startClaudeLogin: (b: { method?: 'claudeai' | 'console'; email?: string }) => call<LoginState>('/api/agents/claude/login', json('POST', b)),
  submitClaudeCode: (code: string) => call<LoginState>('/api/agents/claude/login/code', json('POST', { code })),
  cancelClaudeLogin: () => call<void>('/api/agents/claude/login/cancel', json('POST')),
  refreshClaudeUsage: () => call<ClaudeAgentStatus>('/api/agents/claude/usage/refresh', json('POST')),
  claudeLogout: () => call<ClaudeAgentStatus>('/api/agents/claude/logout', json('POST')),

  // services
  services: () => call<ServiceOverview[]>('/api/services'),
  createService: (b: { name: string; baseUrl?: string; notes?: string; readOnly?: boolean }) => call<ServiceOverview>('/api/services', json('POST', b)),
  updateService: (id: string, b: { name?: string; baseUrl?: string | null; notes?: string | null; readOnly?: boolean; conventions?: string | null }) => call<ServiceOverview>(`/api/services/${id}`, json('PATCH', b)),
  deleteService: (id: string) => call<void>(`/api/services/${id}`, json('DELETE')),

  // environment variables
  env: (id: string) => call<SecretMeta[]>(`/api/services/${id}/env`),
  importEnv: (id: string, text: string, passphrase?: string) => call<{ keys: string[]; encrypted: boolean }>(`/api/services/${id}/env`, json('POST', { text, passphrase })),
  revealSecret: (id: string, key: string) => call<string>(`/api/services/${id}/env/${encodeURIComponent(key)}/value`),
  deleteSecret: (id: string, key: string) => call<void>(`/api/services/${id}/env/${encodeURIComponent(key)}`, json('DELETE')),
  exportEnc: (id: string, passphrase: string) => call<string>(`/api/services/${id}/env/export`, json('POST', { passphrase })),

  // documents (the file itself is the request body, not multipart)
  docs: (id: string) => call<{ docs: Doc[]; supported: string[] }>(`/api/services/${id}/docs`),
  uploadDoc: (id: string, file: File) => call<Doc>(`/api/services/${id}/docs?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file }),
  addDrive: (id: string, url: string, label?: string) => call<Doc>(`/api/services/${id}/docs/drive`, json('POST', { url, label })),
  deleteDoc: (id: string, docId: string) => call<void>(`/api/services/${id}/docs/${docId}`, json('DELETE')),

  // learning
  learn: (id: string, b: { explore?: boolean; writeTests?: boolean } = {}) => call<Job>(`/api/services/${id}/learn`, json('POST', b)),
  cancelLearn: (id: string) => call<void>(`/api/services/${id}/learn/cancel`, json('POST')),
  jobs: (id: string) => call<Job[]>(`/api/services/${id}/jobs`),
  knowledge: (id: string) => call<KnowledgeFile[]>(`/api/services/${id}/knowledge`),
  saveKnowledge: (id: string, name: string, content: string) => call<void>(`/api/services/${id}/knowledge/${encodeURIComponent(name)}`, json('PUT', { content })),

  // integrations
  mcp: () => call<McpStatus>('/api/integrations/mcp'),
  installMcp: () => call<McpResult>('/api/integrations/mcp', json('POST')),
  removeMcp: () => call<McpResult>('/api/integrations/mcp', json('DELETE')),

  // sessions
  sessions: (serviceId: string) => call<Session[]>(`/api/services/${serviceId}/sessions`),
  session: (id: string) => call<{ session: Session; messages: SessionMessage[]; queue: QueuedMessage[] }>(`/api/sessions/${id}`),
  createSession: (serviceId: string, b: { kind: SessionKind; message?: string; parallel?: boolean }) => call<Session>(`/api/services/${serviceId}/sessions`, json('POST', b)),
  createBackup: (b: { passphrase: string; includeClaudeContext: boolean }) => call<{ id: string; name: string; size: number }>('/api/backup/create', json('POST', b)),
  /** The backup file itself is the body; the passphrase travels in a header, URL-encoded because header values are ASCII. */
  stageRestore: (file: File, passphrase: string) => call<{ createdAt: number; appVersion: string; services: number }>('/api/backup/restore', { method: 'POST', headers: { 'x-backup-passphrase': encodeURIComponent(passphrase), 'content-type': 'application/octet-stream' }, body: file }),
  restartApp: () => call<{ restarting: boolean }>('/api/restart', json('POST')),
  sessionPrefs: (serviceId: string) => call<SessionPrefs>(`/api/services/${serviceId}/session-prefs`),
  setSessionPrefs: (serviceId: string, b: Partial<SessionPrefs>) => call<SessionPrefs>(`/api/services/${serviceId}/session-prefs`, json('PUT', b)),
  sendMessage: (id: string, text: string) => call<Session>(`/api/sessions/${id}/messages`, json('POST', { text })),
  sendQueuedNow: (id: string) => call<void>(`/api/sessions/${id}/queue/send`, json('POST')),
  removeQueued: (id: string, queuedId: number) => call<void>(`/api/sessions/${id}/queue/${queuedId}`, json('DELETE')),
  cancelSession: (id: string) => call<void>(`/api/sessions/${id}/cancel`, json('POST')),
  renameSession: (id: string, title: string) => call<Session>(`/api/sessions/${id}`, json('PATCH', { title })),
  deleteSession: (id: string) => call<void>(`/api/sessions/${id}`, json('DELETE')),

  // runs
  runs: (serviceId?: string) => call<RunSummary[]>(`/api/runs${serviceId ? `?serviceId=${serviceId}` : ''}`),
  run: (id: string) => call<{ run: RunSummary; log: LogLine[] }>(`/api/runs/${id}`),
  deleteRuns: (ids: string[]) => call<{ removed: string[] }>('/api/runs/delete', json('POST', { ids })),
  startRun: (id: string, b: { grep?: string; tests?: { file: string; line: number }[]; title?: string; headed?: boolean } = {}) => call<RunSummary>(`/api/services/${id}/runs`, json('POST', b)),
  testCases: (id: string) => call<{ cases: TestCase[]; errors: string[] }>(`/api/services/${id}/tests`),
  deleteTests: (id: string, tests: { file: string; line: number }[]) => call<{ removed: number }>(`/api/services/${id}/tests/delete`, json('POST', { tests })),
  stopRun: (id: string) => call<void>(`/api/runs/${id}/stop`, json('POST')),

  // defects
  defects: (serviceId?: string) => call<Defect[]>(`/api/defects${serviceId ? `?serviceId=${serviceId}` : ''}`),
  answerDefect: (id: string, b: { verdict: AnswerVerdict; note?: string }) => call<Defect>(`/api/defects/${id}/answer`, json('PUT', b)),
  clearAnswer: (id: string) => call<Defect>(`/api/defects/${id}/answer`, json('DELETE')),
  updateDefect: (id: string, b: { status?: DefectStatus; severity?: Severity; title?: string }) => call<Defect>(`/api/defects/${id}`, json('PATCH', b)),
};
