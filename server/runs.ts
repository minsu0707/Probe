import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join, resolve, sep } from 'node:path';
import { all, get, run as exec } from './db.ts';
import { broadcast } from './hub.ts';
import { HttpError, requireService, runtimeEnv, scaffold, sensitiveValues } from './services.ts';
import { ensureDir, runsDir, testsDir } from './paths.ts';
import type { Defect, IngestEvent, RunCurrent, RunStatus, RunSummary, RunTotals, ServerMessage, TestStatus } from './types.ts';

const require = createRequire(import.meta.url);

const emptyTotals = (): RunTotals => ({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, running: 0 });
const emptyCurrent = (): RunCurrent => ({ testId: null, test: null, file: null, page: null, feature: null, view: null, step: null });

interface Live {
  summary: RunSummary;
  token: string;
  proc: ChildProcess | null;
  active: Map<string, { title: string[]; file: string }>;
  frame: Buffer | null;
  frameSeq: number;
  stopped: boolean;
  gotRunEnd: boolean;
  stderrTail: string[];
  secrets: string[];
}

/** Raw and JSON-escaped forms, since events are scrubbed after serialization. */
function redactionList(serviceId: string): string[] {
  const forms = new Set<string>();
  for (const v of sensitiveValues(serviceId)) (forms.add(v), forms.add(JSON.stringify(v).slice(1, -1)));
  return [...forms].sort((a, b) => b.length - a.length);
}

const scrub = (l: Live, text: string): string => l.secrets.reduce((t, v) => t.split(v).join('••••'), text);

const live = new Map<string, Live>();

// ------------------------------------------------------------------ reads

interface RunRow {
  id: string;
  service_id: string;
  title: string;
  status: RunStatus;
  started_at: number;
  ended_at: number | null;
  totals: string;
  current: string;
}

function rowToSummary(r: RunRow): RunSummary {
  const defects = get<{ n: number }>('SELECT COUNT(DISTINCT fingerprint) AS n FROM defects WHERE run_id = ?', r.id)?.n ?? 0;
  return {
    id: r.id,
    serviceId: r.service_id,
    title: r.title,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    totals: JSON.parse(r.totals),
    current: JSON.parse(r.current),
    defects,
  };
}

export function listRuns(serviceId?: string, limit = 50): RunSummary[] {
  const rows = serviceId
    ? all<RunRow>('SELECT * FROM runs WHERE service_id = ? ORDER BY started_at DESC LIMIT ?', serviceId, limit)
    : all<RunRow>('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?', limit);
  return rows.map((r) => live.get(r.id)?.summary ?? rowToSummary(r));
}

export function getRun(id: string): RunSummary {
  const l = live.get(id);
  if (l) return l.summary;
  const r = get<RunRow>('SELECT * FROM runs WHERE id = ?', id);
  if (!r) throw new HttpError(404, `Run ${id} not found`);
  return rowToSummary(r);
}

export const activeRun = (serviceId?: string): RunSummary | undefined =>
  [...live.values()].map((l) => l.summary).find((s) => (!serviceId || s.serviceId === serviceId) && (s.status === 'running' || s.status === 'starting'));

export function runLog(id: string, afterId = 0, limit = 500) {
  return all<{ id: number; ts: number; kind: string; text: string; status: string | null }>(
    'SELECT id, ts, kind, text, status FROM run_log WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?',
    id,
    afterId,
    limit,
  );
}

export const liveFrame = (id: string) => live.get(id)?.frame ?? null;

// ----------------------------------------------------------------- writes

function persist(l: Live) {
  const s = l.summary;
  exec('UPDATE runs SET status = ?, ended_at = ?, totals = ?, current = ? WHERE id = ?', s.status, s.endedAt, JSON.stringify(s.totals), JSON.stringify(s.current), s.id);
  broadcast({ type: 'run', run: s });
}

function log(l: Live, kind: Extract<ServerMessage, { type: 'log' }>['kind'], text: string, status?: TestStatus) {
  const ts = Date.now();
  exec('INSERT INTO run_log (run_id, ts, kind, text, status) VALUES (?,?,?,?,?)', l.summary.id, ts, kind, text, status ?? null);
  broadcast({ type: 'log', runId: l.summary.id, ts, kind, text, status });
}

export interface StartOptions {
  grep?: string;
  file?: string;
  headed?: boolean;
  title?: string;
}

export function startRun(serviceId: string, opts: StartOptions = {}): RunSummary {
  const svc = requireService(serviceId);
  if (activeRun(serviceId)) throw new HttpError(409, `${svc.name} already has a run in progress`);
  scaffold(serviceId);
  const dir = testsDir(serviceId);
  const specs = readdirSync(join(dir, 'specs'), { recursive: true }).filter((f) => /\.(spec|test)\.[cm]?[jt]s$/.test(String(f)));
  if (specs.length === 0) throw new HttpError(422, `No spec files in ${join(dir, 'specs')}. Ask Claude to write tests first.`);
  if (!svc.baseUrl && !runtimeEnv(serviceId).BASE_URL) throw new HttpError(422, 'Set the service URL (or BASE_URL in the env file) before running');

  const id = randomUUID().slice(0, 8);
  const summary: RunSummary = {
    id,
    serviceId,
    title: opts.title?.trim() || (opts.grep ? `${svc.name} · ${opts.grep}` : svc.name),
    status: 'starting',
    startedAt: Date.now(),
    endedAt: null,
    totals: emptyTotals(),
    current: emptyCurrent(),
    defects: 0,
  };
  exec('INSERT INTO runs (id, service_id, title, status, started_at, totals, current) VALUES (?,?,?,?,?,?,?)', id, serviceId, summary.title, summary.status, summary.startedAt, JSON.stringify(summary.totals), JSON.stringify(summary.current));
  const l: Live = { summary, token: randomBytes(16).toString('hex'), proc: null, active: new Map(), frame: null, frameSeq: 0, stopped: false, gotRunEnd: false, stderrTail: [], secrets: redactionList(serviceId) };
  live.set(id, l);
  ensureDir(runsDir(id));

  const args = [require.resolve('@playwright/test/cli'), 'test', '--config', join(dir, 'playwright.config.ts')];
  if (opts.grep) args.push('--grep', opts.grep);
  if (opts.headed) args.push('--headed');
  if (opts.file) args.push(opts.file);

  const proc = spawn(process.execPath, args, {
    cwd: dir,
    env: {
      ...process.env,
      ...runtimeEnv(serviceId),
      PROBE_API: `http://127.0.0.1:${process.env.PORT ?? 4317}`,
      PROBE_RUN_ID: id,
      PROBE_TOKEN: l.token,
      FORCE_COLOR: '0',
    },
    windowsHide: true,
  });
  l.proc = proc;
  log(l, 'system', `Started ${specs.length} spec file${specs.length === 1 ? '' : 's'}${opts.grep ? ` matching "${opts.grep}"` : ''}`);

  const onLine = (line: string, err: boolean) => {
    if (!line.trim()) return;
    // Playwright prints load errors to either stream; keep the last lines of both for diagnostics.
    void err;
    l.stderrTail = [...l.stderrTail.slice(-29), scrub(l, line)];
  };
  for (const [stream, isErr] of [[proc.stdout, false], [proc.stderr, true]] as const) {
    let buf = '';
    stream.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const ln of lines) onLine(ln, isErr);
    });
  }
  proc.on('error', (e) => finish(l, 'error', `Could not start Playwright: ${e.message}`));
  proc.on('close', (code) => {
    if (l.gotRunEnd) return finish(l, undefined);
    if (l.stopped) return finish(l, 'stopped');
    const detail = l.stderrTail.join('\n');
    finish(l, 'error', `Playwright exited with code ${code} before reporting a result${detail ? `:\n${detail}` : ''}`);
  });
  persist(l);
  return summary;
}

function finish(l: Live, forced: RunStatus | undefined, note?: string) {
  const s = l.summary;
  if (s.endedAt) return;
  const ran = s.totals.passed + s.totals.failed + s.totals.skipped;
  if (forced) s.status = forced;
  else if (ran === 0) {
    s.status = 'error';
    note ??= `No tests ran.${l.stderrTail.length ? `\n${l.stderrTail.join('\n')}` : ''}`;
  } else s.status = s.totals.failed > 0 ? 'failed' : 'passed';
  s.endedAt = Date.now();
  s.current = { ...emptyCurrent(), page: s.current.page };
  s.totals.running = 0;
  l.active.clear();
  if (note) log(l, 'system', note);
  log(l, 'system', `Run ${s.status}: ${s.totals.passed} passed, ${s.totals.failed} failed, ${s.totals.skipped} skipped`);
  s.defects = get<{ n: number }>('SELECT COUNT(DISTINCT fingerprint) AS n FROM defects WHERE run_id = ?', s.id)?.n ?? 0;
  persist(l);
  l.frame = null;
  // Keep finished runs in memory briefly so late ingest posts don't 404, then drop.
  setTimeout(() => live.delete(s.id), 30_000).unref();
}

export function stopRun(id: string) {
  const l = live.get(id);
  if (!l || l.summary.endedAt) throw new HttpError(409, 'Run is not active');
  l.stopped = true;
  const pid = l.proc?.pid;
  if (pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else l.proc!.kill('SIGTERM');
  }
}

// ----------------------------------------------------------------- ingest

export function checkToken(runId: string, token: string | undefined): Live {
  const l = live.get(runId);
  if (!l || l.token !== token) throw new HttpError(401, 'Unknown run or bad token');
  return l;
}

export function ingestFrame(runId: string, token: string | undefined, jpeg: Buffer) {
  const l = checkToken(runId, token);
  l.frame = jpeg;
  l.frameSeq++;
  broadcast({ type: 'frame', runId, ts: Date.now() });
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
};

const featureOf = (title: string[], file: string) => (title.length > 1 ? title.slice(0, -1).join(' › ') : basename(file).replace(/\.(spec|test)\.[cm]?[jt]s$/, ''));

export function ingest(runId: string, token: string | undefined, events: IngestEvent[]) {
  const l = checkToken(runId, token);
  const s = l.summary;
  // Test code echoes what it types (Fill "…"), so redact before anything is stored or shown.
  events = events.map((e) => JSON.parse(scrub(l, JSON.stringify(e)))) as IngestEvent[];
  for (const ev of events) {
    switch (ev.type) {
      case 'run:plan':
        s.totals.total = ev.total;
        s.status = 'running';
        break;
      case 'test:begin': {
        l.active.set(ev.id, { title: ev.title, file: ev.file });
        s.status = 'running';
        s.current = { testId: ev.id, test: ev.title, file: ev.file, page: s.current.page, feature: featureOf(ev.title, ev.file), view: null, step: null };
        log(l, 'test', ev.title.join(' › '));
        break;
      }
      case 'step':
        if (s.current.testId === ev.id) s.current.step = ev.title;
        log(l, 'step', ev.title);
        break;
      case 'page': {
        const p = pathOf(ev.url);
        if (s.current.page !== p) log(l, 'page', p);
        s.current.page = p;
        break;
      }
      case 'view':
        s.current.view = ev.name;
        if (ev.feature) s.current.feature = ev.feature;
        log(l, 'view', ev.feature ? `${ev.feature} › ${ev.name}` : ev.name);
        break;
      case 'test:end': {
        const t = l.active.get(ev.id);
        l.active.delete(ev.id);
        if (ev.status === 'passed') {
          s.totals.passed++;
          if (ev.retry > 0) s.totals.flaky++;
        } else if (ev.status === 'skipped') s.totals.skipped++;
        else s.totals.failed++;
        log(l, 'result', `${(t?.title ?? []).join(' › ')} (${(ev.durationMs / 1000).toFixed(1)}s)`, ev.status);
        if (ev.status !== 'passed' && ev.status !== 'skipped' && t) recordDefect(l, t, ev);
        if (s.current.testId === ev.id) s.current = { ...s.current, testId: null, test: null, step: null, view: null };
        break;
      }
      case 'run:end':
        l.gotRunEnd = true;
        break;
    }
  }
  s.totals.running = l.active.size;
  s.defects = get<{ n: number }>('SELECT COUNT(DISTINCT fingerprint) AS n FROM defects WHERE run_id = ?', s.id)?.n ?? 0;
  persist(l);
}

// ---------------------------------------------------------------- defects

interface DefectRow {
  id: string;
  service_id: string;
  run_id: string;
  fingerprint: string;
  title: string;
  severity: Defect['severity'];
  status: Defect['status'];
  page: string | null;
  feature: string | null;
  error: string;
  screenshot: string | null;
  trace: string | null;
  occurrences: number;
  first_seen: number;
  last_seen: number;
}

const toDefect = (r: DefectRow): Defect => ({
  id: r.id,
  serviceId: r.service_id,
  runId: r.run_id,
  fingerprint: r.fingerprint,
  title: r.title,
  severity: r.severity,
  status: r.status,
  page: r.page,
  feature: r.feature,
  error: r.error,
  screenshot: r.screenshot,
  trace: r.trace,
  occurrences: r.occurrences,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
});

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

function severityOf(error: string): Defect['severity'] {
  if (/net::ERR_|status(?: code)?:?\s*5\d\d|TypeError|ReferenceError|Uncaught|crash/i.test(error)) return 'critical';
  if (/toHaveScreenshot|toHaveCSS|toHaveClass/.test(error)) return 'minor';
  return 'major';
}

/** Copy an attachment out of Playwright's output dir (which it cleans) into the run folder. */
function keepAttachment(l: Live, source: string | undefined, allowedRoot: string): string | null {
  if (!source) return null;
  const abs = resolve(source);
  if (!abs.startsWith(resolve(allowedRoot) + sep) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  const name = `${randomBytes(4).toString('hex')}-${basename(abs).replace(/[^\w.-]/g, '_')}`;
  copyFileSync(abs, join(runsDir(l.summary.id), name));
  return name;
}

function recordDefect(l: Live, t: { title: string[]; file: string }, ev: Extract<IngestEvent, { type: 'test:end' }>) {
  const s = l.summary;
  const error = stripAnsi(ev.error ?? 'Test failed without an error message').trim();
  const firstLine = error.split('\n')[0].replace(/\d+(\.\d+)?/g, 'N').replace(/0x[0-9a-f]+/gi, 'X');
  const fingerprint = createHash('sha1').update(`${s.serviceId}|${t.title.join('>')}|${firstLine}`).digest('hex').slice(0, 16);
  const shot = keepAttachment(l, ev.screenshot, testsDir(s.serviceId));
  const trace = keepAttachment(l, ev.trace, testsDir(s.serviceId));
  const now = Date.now();
  const existing = get<DefectRow>(`SELECT * FROM defects WHERE service_id = ? AND fingerprint = ? AND status IN ('candidate','confirmed') ORDER BY last_seen DESC LIMIT 1`, s.serviceId, fingerprint);
  let id: string;
  if (existing) {
    id = existing.id;
    exec(
      'UPDATE defects SET occurrences = occurrences + 1, last_seen = ?, run_id = ?, screenshot = COALESCE(?, screenshot), trace = COALESCE(?, trace), page = COALESCE(?, page), error = ? WHERE id = ?',
      now,
      s.id,
      shot,
      trace,
      s.current.page,
      error,
      id,
    );
  } else {
    id = randomUUID().slice(0, 8);
    exec(
      `INSERT INTO defects (id, service_id, run_id, fingerprint, title, severity, status, page, feature, error, screenshot, trace, occurrences, first_seen, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      id,
      s.serviceId,
      s.id,
      fingerprint,
      t.title[t.title.length - 1],
      severityOf(error),
      'candidate',
      s.current.page,
      featureOf(t.title, t.file),
      error,
      shot,
      trace,
      now,
      now,
    );
  }
  broadcast({ type: 'defect', defect: toDefect(get<DefectRow>('SELECT * FROM defects WHERE id = ?', id)!) });
}

export function listDefects(opts: { serviceId?: string; status?: string; runId?: string } = {}): Defect[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.serviceId) (where.push('service_id = ?'), args.push(opts.serviceId));
  if (opts.status) (where.push('status = ?'), args.push(opts.status));
  if (opts.runId) (where.push('run_id = ?'), args.push(opts.runId));
  return all<DefectRow>(`SELECT * FROM defects ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_seen DESC LIMIT 500`, ...args).map(toDefect);
}

export function updateDefect(id: string, patch: { status?: Defect['status']; severity?: Defect['severity']; title?: string }): Defect {
  const cur = get<DefectRow>('SELECT * FROM defects WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Defect not found');
  if (patch.status && !['candidate', 'confirmed', 'false_positive', 'fixed'].includes(patch.status)) throw new HttpError(400, 'Bad status');
  if (patch.severity && !['critical', 'major', 'minor'].includes(patch.severity)) throw new HttpError(400, 'Bad severity');
  exec('UPDATE defects SET status = ?, severity = ?, title = ? WHERE id = ?', patch.status ?? cur.status, patch.severity ?? cur.severity, patch.title?.trim() || cur.title, id);
  const d = toDefect(get<DefectRow>('SELECT * FROM defects WHERE id = ?', id)!);
  broadcast({ type: 'defect', defect: d });
  return d;
}

/** Claude-filed defect (found while exploring, not from a failed assertion). */
export function reportDefect(input: { serviceId: string; title: string; detail: string; severity?: Defect['severity']; page?: string; feature?: string; runId?: string }): Defect {
  requireService(input.serviceId);
  if (!input.title.trim()) throw new HttpError(400, 'title is required');
  const id = randomUUID().slice(0, 8);
  const now = Date.now();
  const fp = createHash('sha1').update(`${input.serviceId}|manual|${input.title}`).digest('hex').slice(0, 16);
  exec(
    `INSERT INTO defects (id, service_id, run_id, fingerprint, title, severity, status, page, feature, error, occurrences, first_seen, last_seen)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    id,
    input.serviceId,
    input.runId ?? '',
    fp,
    input.title.trim(),
    input.severity ?? 'major',
    'candidate',
    input.page ?? null,
    input.feature ?? null,
    input.detail,
    now,
    now,
  );
  const d = toDefect(get<DefectRow>('SELECT * FROM defects WHERE id = ?', id)!);
  broadcast({ type: 'defect', defect: d });
  return d;
}

export const runFileName = (name: string) => basename(name) === name && !name.startsWith('.') && extname(name) !== '';
