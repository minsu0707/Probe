import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { notFound } from '../../core/errors.ts';
import { runDir } from '../../config.ts';
import type { IngestEvent } from '../../../shared/events.ts';
import { parseBody } from '../../http/validate.ts';
import { listTestCases } from './cases.ts';
import { ingestEvents, ingestFrame } from './ingest.ts';
import { activeRun, getRun, listRuns, liveFrame, runLog, startRun, stopRun } from './service.ts';

const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export const runsRoutes = new Hono()
  .get('/runs', (c) => c.json(listRuns(c.req.query('serviceId'), Number(c.req.query('limit') ?? 50))))
  .get('/runs/active', (c) => c.json(activeRun(c.req.query('serviceId')) ?? null))
  .get('/runs/:id', (c) => c.json({ run: getRun(c.req.param('id')), log: runLog(c.req.param('id'), Number(c.req.query('after') ?? 0), 2000) }))
  .post('/services/:id/runs', async (c) => {
    const body = await parseBody(c, z.object({ grep: z.string().optional(), file: z.string().optional(), tests: z.array(z.object({ file: z.string().regex(/^[\w@.\/-]+$/).refine((f) => !f.startsWith('-') && !f.includes('..')), line: z.number().int().positive() })).min(1).max(500).optional(), headed: z.boolean().optional(), title: z.string().optional() }));
    return c.json(startRun(c.req.param('id'), body), 202);
  })
  .get('/services/:id/tests', async (c) => c.json(await listTestCases(c.req.param('id'))))
  .post('/runs/:id/stop', (c) => (stopRun(c.req.param('id')), c.body(null, 204)))

  // Latest browser frame. 204 means "none yet", which the UI treats as "still starting".
  .get('/runs/:id/live.jpg', (c) => {
    const frame = liveFrame(c.req.param('id'));
    return frame ? c.body(new Uint8Array(frame), 200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }) : c.body(null, 204);
  })

  // Failure screenshots and traces kept from a run.
  .get('/runs/:id/files/:name', (c) => {
    const name = c.req.param('name');
    const path = join(runDir(c.req.param('id')), name);
    // A name containing a separator could point outside the run folder.
    if (name !== name.replace(/[\\/]/g, '') || !existsSync(path)) throw notFound('File not found');
    const type = CONTENT_TYPES[name.split('.').pop() ?? ''];
    return c.body(new Uint8Array(readFileSync(path)), 200, type ? { 'content-type': type } : { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` });
  })

  // Called by the Playwright reporter/fixture, authenticated by the per-run token.
  .post('/ingest/:id', async (c) => {
    ingestEvents(c.req.param('id'), c.req.header('x-probe-token'), (await c.req.json()) as IngestEvent[]);
    return c.body(null, 204);
  })
  .post('/ingest/:id/frame', async (c) => {
    ingestFrame(c.req.param('id'), c.req.header('x-probe-token'), Buffer.from(await c.req.arrayBuffer()));
    return c.body(null, 204);
  });
