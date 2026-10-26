import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4317);
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = resolve(process.env.PROBE_HOME ?? join(ROOT, 'data'));

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data as T;
}

const up = () => api('/api/services').then(() => true, () => false);

async function ensureServer(): Promise<boolean> {
  if (await up()) return false;
  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.ts')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await up()) return true;
  }
  throw new Error(`Probe server did not start on port ${PORT}`);
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function resolveService(ref: string) {
  await ensureServer();
  const all = await api<any[]>('/api/services');
  const hit = all.find((s) => s.id === ref) ?? all.find((s) => s.name.toLowerCase() === ref.toLowerCase());
  if (!hit) throw new Error(`No service "${ref}". Registered: ${all.map((s) => `${s.name} (${s.id})`).join(', ') || 'none'}`);
  return hit;
}

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] });
const tool = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try {
    return ok(await fn(a));
  } catch (e) {
    return fail(e);
  }
};

const server = new McpServer({ name: 'probe', version: '0.1.0' });
const service = z.string().describe('Service name or id as shown in the dashboard');

server.registerTool(
  'open_dashboard',
  { description: 'Start the Probe test dashboard if it is not running and open it in the browser. Registered services show up immediately.' },
  tool(async () => {
    const started = await ensureServer();
    openBrowser(BASE);
    const services = await api<any[]>('/api/services');
    return { url: BASE, startedNow: started, services: services.map((s) => ({ id: s.id, name: s.name, openDefects: s.openDefects })) };
  }),
);

server.registerTool(
  'list_services',
  { description: 'List registered services with their URL, document/knowledge counts and open defect count.' },
  tool(async () => {
    await ensureServer();
    return (await api<any[]>('/api/services')).map((s) => ({ id: s.id, name: s.name, baseUrl: s.baseUrl, documents: s.docCount, unlearnedDocuments: s.unlearnedDocs, knowledgeFiles: s.knowledgeCount, openDefects: s.openDefects, running: Boolean(s.activeRun) }));
  }),
);

server.registerTool(
  'get_service',
  {
    description:
      'Everything needed to write tests for a service: where to put spec files, which environment variable names exist (values are never shown), the domain knowledge file paths, and uploaded documents. Read the knowledge files before writing specs.',
    inputSchema: { service },
  },
  tool(async ({ service: ref }: { service: string }) => {
    const s = await resolveService(ref);
    const [env, docs, knowledge] = await Promise.all([api<any[]>(`/api/services/${s.id}/env`), api<any>(`/api/services/${s.id}/docs`), api<any[]>(`/api/services/${s.id}/knowledge`)]);
    const dir = join(HOME, 'services', s.id);
    return {
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      notes: s.notes,
      specDir: join(dir, 'tests', 'specs'),
      importLine: "import { test, expect, view } from '../probe.ts';",
      envVariables: env.map((e) => (e.sensitive ? e.key : `${e.key}=${e.value}`)),
      knowledgeDir: join(dir, 'knowledge'),
      knowledgeFiles: knowledge.map((k) => k.name),
      documents: docs.docs.map((d: any) => ({ name: d.name, kind: d.kind, learned: Boolean(d.learnedAt) })),
      note: knowledge.length === 0 ? 'No domain knowledge yet. Ask the user to add documents and press "학습 시작" in the dashboard (도메인 학습 menu).' : undefined,
    };
  }),
);

server.registerTool(
  'read_knowledge',
  { description: 'Read the learned domain knowledge for a service (overview, screens, flows, rules, test points, open questions).', inputSchema: { service, file: z.string().optional().describe('One file name, e.g. flows.md. Omit for all.') } },
  tool(async ({ service: ref, file }: { service: string; file?: string }) => {
    const s = await resolveService(ref);
    const files = await api<{ name: string; content: string }[]>(`/api/services/${s.id}/knowledge`);
    const pick = file ? files.filter((f) => f.name === file) : files;
    if (pick.length === 0) throw new Error(file ? `No knowledge file ${file}. Available: ${files.map((f) => f.name).join(', ') || 'none'}` : 'No knowledge yet');
    return pick.map((f) => `# ${f.name}\n\n${f.content}`).join('\n\n---\n\n');
  }),
);

server.registerTool(
  'run_tests',
  {
    description:
      'Run the service\'s Playwright specs through the dashboard so the user can watch live. Credentials are injected by the dashboard. Waits for the run to finish (up to timeoutSec) and returns the result and any failures.',
    inputSchema: { service, grep: z.string().optional().describe('Only tests whose title matches'), file: z.string().optional().describe('Only this spec file'), timeoutSec: z.number().int().min(10).max(1800).optional() },
  },
  tool(async ({ service: ref, grep, file, timeoutSec }: { service: string; grep?: string; file?: string; timeoutSec?: number }) => {
    const s = await resolveService(ref);
    openBrowser(BASE);
    const started = await api<any>(`/api/services/${s.id}/runs`, { method: 'POST', body: JSON.stringify({ grep, file }) });
    const deadline = Date.now() + (timeoutSec ?? 600) * 1000;
    let run = started;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      run = (await api<any>(`/api/runs/${started.id}`)).run;
      if (run.endedAt) break;
    }
    const detail = await api<any>(`/api/runs/${started.id}`);
    const defects = await api<any[]>(`/api/defects?runId=${started.id}`);
    return {
      runId: run.id,
      status: run.endedAt ? run.status : 'still running (timed out waiting; check the dashboard)',
      totals: run.totals,
      failures: defects.map((d) => ({ defectId: d.id, severity: d.severity, test: d.title, feature: d.feature, page: d.page, error: d.error.split('\n').slice(0, 8).join('\n') })),
      systemNotes: detail.log.filter((l: any) => l.kind === 'system').map((l: any) => l.text),
    };
  }),
);

server.registerTool(
  'list_defects',
  { description: 'List defects for a service. Failed tests become "candidate" defects; the user confirms or dismisses them.', inputSchema: { service, status: z.enum(['candidate', 'confirmed', 'false_positive', 'fixed']).optional() } },
  tool(async ({ service: ref, status }: { service: string; status?: string }) => {
    const s = await resolveService(ref);
    const list = await api<any[]>(`/api/defects?serviceId=${s.id}${status ? `&status=${status}` : ''}`);
    return list.map((d) => ({ id: d.id, status: d.status, severity: d.severity, title: d.title, feature: d.feature, page: d.page, occurrences: d.occurrences, error: d.error.split('\n').slice(0, 4).join('\n') }));
  }),
);

server.registerTool(
  'report_defect',
  {
    description: 'File a defect you found while exploring or reading code, when no assertion failed. Be specific: what you did, what you expected, what happened.',
    inputSchema: { service, title: z.string(), detail: z.string(), severity: z.enum(['critical', 'major', 'minor']).optional(), page: z.string().optional(), feature: z.string().optional() },
  },
  tool(async ({ service: ref, ...rest }: { service: string; title: string; detail: string; severity?: string; page?: string; feature?: string }) => {
    const s = await resolveService(ref);
    return api('/api/defects', { method: 'POST', body: JSON.stringify({ serviceId: s.id, ...rest }) });
  }),
);

server.registerTool(
  'update_defect',
  { description: 'Change a defect\'s status or severity.', inputSchema: { defectId: z.string(), status: z.enum(['candidate', 'confirmed', 'false_positive', 'fixed']).optional(), severity: z.enum(['critical', 'major', 'minor']).optional() } },
  tool(async ({ defectId, ...patch }: { defectId: string; status?: string; severity?: string }) => {
    await ensureServer();
    return api(`/api/defects/${defectId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }),
);

server.registerTool(
  'start_learning',
  { description: 'Start the learning job: Claude reads the uploaded documents and Drive links and writes the knowledge files. The user normally presses the button in the dashboard.', inputSchema: { service } },
  tool(async ({ service: ref }: { service: string }) => {
    const s = await resolveService(ref);
    return api(`/api/services/${s.id}/learn`, { method: 'POST' });
  }),
);

await server.connect(new StdioServerTransport());
