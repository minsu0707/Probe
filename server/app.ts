import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { all, get } from './db.ts';
import { addDrive, addFile, deleteDoc, listDocs, MAX_UPLOAD, SUPPORTED, unlearnedCount } from './docs.ts';
import { cancelLearn, knowledgeFiles, listJobs, saveKnowledge, startLearn } from './learn.ts';
import { activeRun, getRun, ingest, ingestFrame, listDefects, listRuns, liveFrame, reportDefect, runLog, startRun, stopRun, updateDefect } from './runs.ts';
import { HttpError, createService, deleteSecret, deleteService, exportEnc, getService, importEnv, listSecrets, listServices, requireService, updateService } from './services.ts';
import { runsDir } from './paths.ts';
import type { IngestEvent } from './types.ts';

export function serviceOverview(id: string) {
  const s = requireService(id);
  const count = (sql: string) => get<{ n: number }>(sql, id)?.n ?? 0;
  return {
    ...s,
    secretCount: count('SELECT COUNT(*) AS n FROM secrets WHERE service_id = ?'),
    docCount: count('SELECT COUNT(*) AS n FROM documents WHERE service_id = ?'),
    unlearnedDocs: unlearnedCount(id),
    knowledgeCount: knowledgeFiles(id).length,
    openDefects: count(`SELECT COUNT(*) AS n FROM defects WHERE service_id = ? AND status IN ('candidate','confirmed')`),
    lastRun: listRuns(id, 1)[0] ?? null,
    activeRun: activeRun(id) ?? null,
    learning: Boolean(get('SELECT 1 FROM jobs WHERE service_id = ? AND status = ?', id, 'running')),
  };
}

const body = async <T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
};

export function buildApp(port: number, webDist: string) {
  const app = new Hono();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']);

  // The server holds decrypted credentials; refuse DNS-rebinding and cross-site writes.
  app.use('*', async (c, next) => {
    if (!allowedHosts.has(c.req.header('host') ?? '')) return c.json({ error: 'Forbidden host' }, 403);
    const origin = c.req.header('origin');
    if (origin && c.req.method !== 'GET' && !allowedHosts.has(new URL(origin).host)) return c.json({ error: 'Forbidden origin' }, 403);
    await next();
  });

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status as 400);
    console.error(e);
    return c.json({ error: 'Internal error' }, 500);
  });

  // ---- services
  app.get('/api/services', (c) => c.json(listServices().map((s) => serviceOverview(s.id))));
  app.post('/api/services', async (c) => c.json(serviceOverview((createService(await body(c, z.object({ name: z.string(), baseUrl: z.string().optional(), notes: z.string().optional() }))).id)), 201));
  app.get('/api/services/:id', (c) => c.json(serviceOverview(c.req.param('id'))));
  app.patch('/api/services/:id', async (c) =>
    c.json(serviceOverview(updateService(c.req.param('id'), await body(c, z.object({ name: z.string().optional(), baseUrl: z.string().nullable().optional(), notes: z.string().nullable().optional() }))).id)),
  );
  app.delete('/api/services/:id', (c) => (deleteService(c.req.param('id')), c.body(null, 204)));

  // ---- env / secrets
  app.get('/api/services/:id/env', (c) => c.json(listSecrets(c.req.param('id'))));
  app.post('/api/services/:id/env', async (c) => {
    const b = await body(c, z.object({ text: z.string().max(1_000_000), passphrase: z.string().optional() }));
    return c.json(importEnv(c.req.param('id'), b.text, b.passphrase));
  });
  app.delete('/api/services/:id/env/:key', (c) => (deleteSecret(c.req.param('id'), c.req.param('key')), c.body(null, 204)));
  app.post('/api/services/:id/env/export', async (c) => {
    const b = await body(c, z.object({ passphrase: z.string() }));
    return c.text(exportEnc(c.req.param('id'), b.passphrase));
  });

  // ---- documents
  app.get('/api/services/:id/docs', (c) => c.json({ docs: listDocs(c.req.param('id')), supported: SUPPORTED }));
  app.put('/api/services/:id/docs', async (c) => {
    const name = c.req.query('name');
    if (!name) throw new HttpError(400, 'name query parameter is required');
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_UPLOAD) throw new HttpError(413, `File is larger than ${MAX_UPLOAD / 1024 / 1024}MB`);
    return c.json(addFile(c.req.param('id'), name, Buffer.from(await c.req.arrayBuffer())), 201);
  });
  app.post('/api/services/:id/docs/drive', async (c) => {
    const b = await body(c, z.object({ url: z.string(), label: z.string().optional() }));
    return c.json(addDrive(c.req.param('id'), b.url, b.label), 201);
  });
  app.delete('/api/services/:id/docs/:docId', (c) => (deleteDoc(c.req.param('id'), c.req.param('docId')), c.body(null, 204)));

  // ---- learning
  app.post('/api/services/:id/learn', (c) => c.json(startLearn(c.req.param('id')), 202));
  app.post('/api/services/:id/learn/cancel', (c) => (cancelLearn(c.req.param('id')), c.body(null, 204)));
  app.get('/api/services/:id/jobs', (c) => c.json(listJobs(c.req.param('id'))));
  app.get('/api/services/:id/knowledge', (c) => (requireService(c.req.param('id')), c.json(knowledgeFiles(c.req.param('id')))));
  app.put('/api/services/:id/knowledge/:name', async (c) => {
    const b = await body(c, z.object({ content: z.string() }));
    saveKnowledge(c.req.param('id'), c.req.param('name'), b.content);
    return c.body(null, 204);
  });

  // ---- runs
  app.get('/api/runs', (c) => c.json(listRuns(c.req.query('serviceId'), Number(c.req.query('limit') ?? 50))));
  app.get('/api/runs/active', (c) => c.json(activeRun(c.req.query('serviceId')) ?? null));
  app.get('/api/runs/:id', (c) => c.json({ run: getRun(c.req.param('id')), log: runLog(c.req.param('id'), Number(c.req.query('after') ?? 0), 2000) }));
  app.post('/api/services/:id/runs', async (c) => {
    const b = await body(c, z.object({ grep: z.string().optional(), file: z.string().optional(), headed: z.boolean().optional(), title: z.string().optional() }));
    return c.json(startRun(c.req.param('id'), b), 202);
  });
  app.post('/api/runs/:id/stop', (c) => (stopRun(c.req.param('id')), c.body(null, 204)));
  app.get('/api/runs/:id/live.jpg', (c) => {
    const f = liveFrame(c.req.param('id'));
    if (!f) return c.body(null, 204);
    return c.body(new Uint8Array(f), 200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
  });
  app.get('/api/runs/:id/files/:name', (c) => {
    const name = c.req.param('name');
    const p = join(runsDir(c.req.param('id')), name);
    if (name !== name.replace(/[\\/]/g, '') || !existsSync(p)) throw new HttpError(404, 'File not found');
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    return c.body(new Uint8Array(readFileSync(p)), 200, { 'content-type': type, 'content-disposition': type === 'application/octet-stream' ? `attachment; filename="${name}"` : 'inline' });
  });

  // ---- ingest (reporter/fixture, authenticated by per-run token)
  app.post('/api/ingest/:id', async (c) => {
    ingest(c.req.param('id'), c.req.header('x-probe-token'), (await c.req.json()) as IngestEvent[]);
    return c.body(null, 204);
  });
  app.post('/api/ingest/:id/frame', async (c) => {
    ingestFrame(c.req.param('id'), c.req.header('x-probe-token'), Buffer.from(await c.req.arrayBuffer()));
    return c.body(null, 204);
  });

  // ---- defects
  app.get('/api/defects', (c) => c.json(listDefects({ serviceId: c.req.query('serviceId'), status: c.req.query('status'), runId: c.req.query('runId') })));
  app.patch('/api/defects/:id', async (c) => c.json(updateDefect(c.req.param('id'), await body(c, z.object({ status: z.string().optional(), severity: z.string().optional(), title: z.string().optional() })) as never)));
  app.post('/api/defects', async (c) =>
    c.json(
      reportDefect(await body(c, z.object({ serviceId: z.string(), title: z.string(), detail: z.string(), severity: z.enum(['critical', 'major', 'minor']).optional(), page: z.string().optional(), feature: z.string().optional(), runId: z.string().optional() }))),
      201,
    ),
  );

  // ---- built web app
  app.get('*', (c) => {
    const rel = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\/+/, '');
    let file = join(webDist, rel);
    if (rel.includes('..') || !existsSync(file)) file = join(webDist, 'index.html');
    if (!existsSync(file)) return c.text('Web app not built. Run `npm run build` in probe/, or use `npm run web` for the dev server.', 404);
    const ext = file.split('.').pop();
    const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' };
    return c.body(new Uint8Array(readFileSync(file)), 200, { 'content-type': types[ext ?? ''] ?? 'application/octet-stream' });
  });

  void all; // keep db imported for side effects (schema creation) even if routes change
  void getService;
  return app;
}
