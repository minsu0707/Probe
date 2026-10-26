/**
 * Typed client for the Probe HTTP API. Every call returns parsed JSON (or text for the .enc
 * export) and throws `ApiError` with a message safe to show the user.
 */
import type { ClaudeAgentStatus, ClaudeProfile, ClaudeUsage, Defect, DefectStatus, Doc, Job, KnowledgeFile, LogLine, LoginState, RunSummary, SecretMeta, ServiceOverview, Session, SessionKind, SessionMessage, Severity, UsageWindow } from '../../../shared/models.ts';

export type { ClaudeAgentStatus, ClaudeProfile, ClaudeUsage, Defect, Doc, Job, KnowledgeFile, LogLine, LoginState, RunSummary, SecretMeta, ServiceOverview, Session, SessionKind, SessionMessage, UsageWindow };

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
  health: () => call<{ app: 'probe'; version: string; pid: number; root: string; browser: 'msedge' | 'chrome' | 'chromium' }>('/api/health'),

  // agents
  claude: () => call<ClaudeAgentStatus>('/api/agents/claude'),
  setClaudeProfile: (profile: ClaudeProfile) => call<ClaudeAgentStatus>('/api/agents/claude/profile', json('PUT', { profile })),
  startClaudeLogin: (b: { method?: 'claudeai' | 'console'; email?: string }) => call<LoginState>('/api/agents/claude/login', json('POST', b)),
  submitClaudeCode: (code: string) => call<LoginState>('/api/agents/claude/login/code', json('POST', { code })),
  cancelClaudeLogin: () => call<void>('/api/agents/claude/login/cancel', json('POST')),
  claudeLogout: () => call<ClaudeAgentStatus>('/api/agents/claude/logout', json('POST')),

  // services
  services: () => call<ServiceOverview[]>('/api/services'),
  createService: (b: { name: string; baseUrl?: string; notes?: string }) => call<ServiceOverview>('/api/services', json('POST', b)),
  updateService: (id: string, b: { name?: string; baseUrl?: string | null; notes?: string | null }) => call<ServiceOverview>(`/api/services/${id}`, json('PATCH', b)),
  deleteService: (id: string) => call<void>(`/api/services/${id}`, json('DELETE')),

  // environment variables
  env: (id: string) => call<SecretMeta[]>(`/api/services/${id}/env`),
  importEnv: (id: string, text: string, passphrase?: string) => call<{ keys: string[]; encrypted: boolean }>(`/api/services/${id}/env`, json('POST', { text, passphrase })),
  deleteSecret: (id: string, key: string) => call<void>(`/api/services/${id}/env/${encodeURIComponent(key)}`, json('DELETE')),
  exportEnc: (id: string, passphrase: string) => call<string>(`/api/services/${id}/env/export`, json('POST', { passphrase })),

  // documents (the file itself is the request body, not multipart)
  docs: (id: string) => call<{ docs: Doc[]; supported: string[] }>(`/api/services/${id}/docs`),
  uploadDoc: (id: string, file: File) => call<Doc>(`/api/services/${id}/docs?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file }),
  addDrive: (id: string, url: string, label?: string) => call<Doc>(`/api/services/${id}/docs/drive`, json('POST', { url, label })),
  deleteDoc: (id: string, docId: string) => call<void>(`/api/services/${id}/docs/${docId}`, json('DELETE')),

  // learning
  learn: (id: string) => call<Job>(`/api/services/${id}/learn`, json('POST')),
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
  session: (id: string) => call<{ session: Session; messages: SessionMessage[] }>(`/api/sessions/${id}`),
  createSession: (serviceId: string, b: { kind: SessionKind; message?: string }) => call<Session>(`/api/services/${serviceId}/sessions`, json('POST', b)),
  sendMessage: (id: string, text: string) => call<Session>(`/api/sessions/${id}/messages`, json('POST', { text })),
  cancelSession: (id: string) => call<void>(`/api/sessions/${id}/cancel`, json('POST')),
  deleteSession: (id: string) => call<void>(`/api/sessions/${id}`, json('DELETE')),

  // runs
  runs: (serviceId?: string) => call<RunSummary[]>(`/api/runs${serviceId ? `?serviceId=${serviceId}` : ''}`),
  run: (id: string) => call<{ run: RunSummary; log: LogLine[] }>(`/api/runs/${id}`),
  startRun: (id: string, b: { grep?: string; headed?: boolean } = {}) => call<RunSummary>(`/api/services/${id}/runs`, json('POST', b)),
  stopRun: (id: string) => call<void>(`/api/runs/${id}/stop`, json('POST')),

  // defects
  defects: (serviceId?: string) => call<Defect[]>(`/api/defects${serviceId ? `?serviceId=${serviceId}` : ''}`),
  updateDefect: (id: string, b: { status?: DefectStatus; severity?: Severity; title?: string }) => call<Defect>(`/api/defects/${id}`, json('PATCH', b)),
};
