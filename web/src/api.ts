import type { Defect, Job, RunSummary } from '../../server/types.ts';

export type { Defect, Job, RunSummary };

export interface ServiceOverview {
  id: string;
  name: string;
  baseUrl: string | null;
  notes: string | null;
  createdAt: number;
  secretCount: number;
  docCount: number;
  unlearnedDocs: number;
  knowledgeCount: number;
  openDefects: number;
  lastRun: RunSummary | null;
  activeRun: RunSummary | null;
  learning: boolean;
}

export interface SecretMeta {
  key: string;
  sensitive: boolean;
  value?: string;
}

export interface Doc {
  id: string;
  kind: 'file' | 'drive';
  name: string;
  ref: string;
  size: number;
  learnedAt: number | null;
  addedAt: number;
}

export interface KnowledgeFile {
  name: string;
  content: string;
  updatedAt: number;
}

export interface LogLine {
  id?: number;
  ts: number;
  kind: 'test' | 'step' | 'page' | 'view' | 'result' | 'system';
  text: string;
  status?: string | null;
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

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  services: () => call<ServiceOverview[]>('/api/services'),
  createService: (b: { name: string; baseUrl?: string; notes?: string }) => call<ServiceOverview>('/api/services', json('POST', b)),
  updateService: (id: string, b: { name?: string; baseUrl?: string | null; notes?: string | null }) => call<ServiceOverview>(`/api/services/${id}`, json('PATCH', b)),
  deleteService: (id: string) => call<void>(`/api/services/${id}`, json('DELETE')),

  env: (id: string) => call<SecretMeta[]>(`/api/services/${id}/env`),
  importEnv: (id: string, text: string, passphrase?: string) => call<{ keys: string[]; encrypted: boolean }>(`/api/services/${id}/env`, json('POST', { text, passphrase })),
  deleteSecret: (id: string, key: string) => call<void>(`/api/services/${id}/env/${encodeURIComponent(key)}`, json('DELETE')),
  exportEnc: (id: string, passphrase: string) => call<string>(`/api/services/${id}/env/export`, json('POST', { passphrase })),

  docs: (id: string) => call<{ docs: Doc[]; supported: string[] }>(`/api/services/${id}/docs`),
  uploadDoc: (id: string, file: File) => call<Doc>(`/api/services/${id}/docs?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file }),
  addDrive: (id: string, url: string, label?: string) => call<Doc>(`/api/services/${id}/docs/drive`, json('POST', { url, label })),
  deleteDoc: (id: string, docId: string) => call<void>(`/api/services/${id}/docs/${docId}`, json('DELETE')),

  learn: (id: string) => call<Job>(`/api/services/${id}/learn`, json('POST')),
  cancelLearn: (id: string) => call<void>(`/api/services/${id}/learn/cancel`, json('POST')),
  jobs: (id: string) => call<Job[]>(`/api/services/${id}/jobs`),
  knowledge: (id: string) => call<KnowledgeFile[]>(`/api/services/${id}/knowledge`),
  saveKnowledge: (id: string, name: string, content: string) => call<void>(`/api/services/${id}/knowledge/${encodeURIComponent(name)}`, json('PUT', { content })),

  runs: (serviceId?: string) => call<RunSummary[]>(`/api/runs${serviceId ? `?serviceId=${serviceId}` : ''}`),
  run: (id: string) => call<{ run: RunSummary; log: LogLine[] }>(`/api/runs/${id}`),
  startRun: (id: string, b: { grep?: string; headed?: boolean } = {}) => call<RunSummary>(`/api/services/${id}/runs`, json('POST', b)),
  stopRun: (id: string) => call<void>(`/api/runs/${id}/stop`, json('POST')),

  defects: (serviceId?: string) => call<Defect[]>(`/api/defects${serviceId ? `?serviceId=${serviceId}` : ''}`),
  updateDefect: (id: string, b: { status?: Defect['status']; severity?: Defect['severity']; title?: string }) => call<Defect>(`/api/defects/${id}`, json('PATCH', b)),
};
