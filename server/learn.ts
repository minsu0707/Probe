import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { all, get, run } from './db.ts';
import { broadcast } from './hub.ts';
import { listDocs, markLearned } from './docs.ts';
import { HttpError, requireService } from './services.ts';
import { knowledgeDir, serviceDir } from './paths.ts';
import type { Job } from './types.ts';

interface JobRow {
  id: string;
  service_id: string;
  kind: 'learn';
  status: Job['status'];
  started_at: number;
  ended_at: number | null;
  log: string;
  summary: string | null;
}

const toJob = (r: JobRow): Job => ({ id: r.id, serviceId: r.service_id, kind: r.kind, status: r.status, startedAt: r.started_at, endedAt: r.ended_at, log: JSON.parse(r.log), summary: r.summary });

export const listJobs = (serviceId: string, limit = 10): Job[] => all<JobRow>('SELECT * FROM jobs WHERE service_id = ? ORDER BY started_at DESC LIMIT ?', serviceId, limit).map(toJob);

const procs = new Map<string, ChildProcess>();

const KNOWLEDGE_FILES = ['overview.md', 'screens.md', 'flows.md', 'rules.md', 'test-points.md', 'open-questions.md'] as const;

function buildPrompt(serviceName: string, baseUrl: string | null, driveLinks: string[], hasExisting: boolean): string {
  return `You are building the domain knowledge base for QA test automation of the service "${serviceName}"${baseUrl ? ` (${baseUrl})` : ''}.

Source material:
- Local files are in ./docs. For any file that has a sibling "<name>.extracted.txt", read that text file instead of the original. Read every file; images and PDFs are readable with the Read tool. Use Glob to list them.
${driveLinks.length ? `- Google Drive links (read them with the Google Drive tools; if a link is a folder, read its readable contents):\n${driveLinks.map((l) => `  - ${l}`).join('\n')}` : '- No Google Drive links were added.'}
${hasExisting ? '- ./knowledge already holds an earlier version. Read it first, keep what is still supported by the sources, and update it. Do not drop information the user may have edited by hand unless a source contradicts it.\n' : ''}
Write these files into ./knowledge (Markdown, in the language the source documents are written in):
- overview.md: what the service is, who uses it, user roles, glossary of domain terms.
- screens.md: menu and screen inventory. For each screen: purpose, main fields and actions, who can access it.
- flows.md: business processes as numbered steps, with preconditions and the expected result of each step.
- rules.md: validation rules, permissions per role, calculations and formulas, status transitions, limits, and edge cases.
- test-points.md: prioritized test points (P0/P1/P2), each with the risk it covers, and a pointer to the screen or flow it belongs to.
- open-questions.md: contradictions between documents, gaps, and anything you could not determine.

Rules:
1. Every factual claim must name its source in brackets, for example [spec.pdf p.12] or [Drive: <title>]. Mark anything you inferred rather than read as (inferred). Never present an inference as a fact.
2. Do not invent screens, fields, rules or numbers. If the documents are silent, put the question in open-questions.md.
3. If two documents disagree, record both claims with their sources in open-questions.md and use the newer or more specific one only if the documents say which is newer.
4. Do not include credentials, tokens or personal data that appear in the documents.
5. Do not open or test the live service. This task is reading and writing files only.
6. Finish with a short summary written in Korean: what you read, what you wrote, and the three biggest gaps. If a document clearly belongs to a different service than "${serviceName}", say so first.`;
}

export function startLearn(serviceId: string): Job {
  const svc = requireService(serviceId);
  if (get('SELECT 1 FROM jobs WHERE service_id = ? AND status = ?', serviceId, 'running')) throw new HttpError(409, 'Learning is already running for this service');
  const docs = listDocs(serviceId);
  if (docs.length === 0) throw new HttpError(422, 'Add at least one document or Drive link first');

  const id = randomUUID().slice(0, 8);
  const started = Date.now();
  run('INSERT INTO jobs (id, service_id, kind, status, started_at, log) VALUES (?,?,?,?,?,?)', id, serviceId, 'learn', 'running', started, '[]');
  const lines: string[] = [];
  const push = (line: string) => {
    lines.push(line);
    if (lines.length > 400) lines.shift();
    run('UPDATE jobs SET log = ? WHERE id = ?', JSON.stringify(lines), id);
    broadcast({ type: 'job', job: toJob(get<JobRow>('SELECT * FROM jobs WHERE id = ?', id)!) });
  };

  const existing = existsSync(knowledgeDir(serviceId)) && readdirSync(knowledgeDir(serviceId)).some((f) => f.endsWith('.md'));
  const driveLinks = docs.filter((d) => d.kind === 'drive').map((d) => d.ref);
  const args = [
    '-p',
    buildPrompt(svc.name, svc.baseUrl, driveLinks, existing),
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'mcp__claude_ai_Google_Drive',
    '--disallowedTools',
    'Bash',
    'WebFetch',
    'WebSearch',
  ];
  const proc = spawn('claude', args, { cwd: serviceDir(serviceId), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  procs.set(id, proc);
  push(`자료 ${docs.length}개를 읽기 시작합니다`);

  let summary: string | null = null;
  let failed: string | null = null;
  let buf = '';
  let stderr = '';
  proc.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    const rows = buf.split('\n');
    buf = rows.pop() ?? '';
    for (const row of rows) {
      if (!row.trim()) continue;
      let ev: any;
      try {
        ev = JSON.parse(row);
      } catch {
        continue;
      }
      if (ev.type === 'assistant') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'tool_use') push(describeTool(block.name, block.input));
        }
      } else if (ev.type === 'result') {
        if (ev.is_error) failed = String(ev.result ?? 'Claude reported an error');
        else summary = String(ev.result ?? '');
      }
    }
  });
  proc.on('error', (e) => finish(id, serviceId, 'failed', null, `Could not start the claude CLI: ${e.message}`));
  proc.on('close', (code) => {
    procs.delete(id);
    const cancelled = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id)?.status === 'cancelled';
    if (cancelled) return;
    if (failed || code !== 0 || summary === null) return finish(id, serviceId, 'failed', null, failed ?? `claude exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    const written = knowledgeFiles(serviceId).length;
    if (written === 0) return finish(id, serviceId, 'failed', summary, 'Claude finished but wrote no knowledge files');
    markLearned(serviceId);
    finish(id, serviceId, 'done', summary);
  });
  return toJob(get<JobRow>('SELECT * FROM jobs WHERE id = ?', id)!);
}

function describeTool(name: string, input: any): string {
  const file = input?.file_path ?? input?.path ?? input?.pattern;
  if (name === 'Read') return `읽는 중: ${basename(String(file ?? ''))}`;
  if (name === 'Write' || name === 'Edit') return `작성 중: ${basename(String(file ?? ''))}`;
  if (name === 'Glob' || name === 'Grep') return `자료 찾는 중: ${String(file ?? '')}`;
  if (name.startsWith('mcp__') && name.includes('Drive')) return `Google Drive에서 읽는 중 (${name.split('__').pop()})`;
  return name;
}

function finish(id: string, serviceId: string, status: Job['status'], summary: string | null, errorNote?: string) {
  const cur = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!cur || cur.status !== 'running') return;
  const lines: string[] = JSON.parse(cur.log);
  if (errorNote) lines.push(errorNote);
  run('UPDATE jobs SET status = ?, ended_at = ?, summary = ?, log = ? WHERE id = ?', status, Date.now(), summary ?? errorNote ?? null, JSON.stringify(lines), id);
  broadcast({ type: 'job', job: toJob(get<JobRow>('SELECT * FROM jobs WHERE id = ?', id)!) });
  broadcast({ type: 'service', serviceId });
}

export function cancelLearn(serviceId: string) {
  const row = get<JobRow>('SELECT * FROM jobs WHERE service_id = ? AND status = ?', serviceId, 'running');
  if (!row) throw new HttpError(409, 'Nothing is running');
  run('UPDATE jobs SET status = ?, ended_at = ? WHERE id = ?', 'cancelled', Date.now(), row.id);
  const proc = procs.get(row.id);
  if (proc?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    else proc.kill('SIGTERM');
  }
  broadcast({ type: 'job', job: toJob(get<JobRow>('SELECT * FROM jobs WHERE id = ?', row.id)!) });
}

// -------------------------------------------------------------- knowledge

export interface KnowledgeFile {
  name: string;
  content: string;
  updatedAt: number;
}

export function knowledgeFiles(serviceId: string): KnowledgeFile[] {
  const dir = knowledgeDir(serviceId);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const rank = (n: string) => {
    const i = (KNOWLEDGE_FILES as readonly string[]).indexOf(n);
    return i === -1 ? 99 : i;
  };
  return names
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => ({ name, content: readFileSync(join(dir, name), 'utf8'), updatedAt: statSync(join(dir, name)).mtimeMs }));
}

export function saveKnowledge(serviceId: string, name: string, content: string) {
  requireService(serviceId);
  if (basename(name) !== name || !/^[\w.-]+\.md$/.test(name)) throw new HttpError(400, 'Knowledge files must be plain .md names');
  writeFileSync(join(knowledgeDir(serviceId), name), content);
  broadcast({ type: 'service', serviceId });
}
