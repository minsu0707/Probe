import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { requireService } from '../services/service.ts';
import { listKnowledge, saveKnowledge } from './knowledge.ts';
import { cancelLearn, listJobs, startLearn } from './service.ts';

export const learningRoutes = new Hono()
  .post('/services/:id/learn', async (c) => {
    // The body is optional: older callers (and the MCP tool) post nothing, which means documents only.
    const explore = z.object({ explore: z.boolean().optional() }).safeParse(await c.req.json().catch(() => ({}))).data?.explore;
    return c.json(await startLearn(c.req.param('id'), { explore }), 202);
  })
  .post('/services/:id/learn/cancel', (c) => (cancelLearn(c.req.param('id')), c.body(null, 204)))
  .get('/services/:id/jobs', (c) => c.json(listJobs(c.req.param('id'))))
  .get('/services/:id/knowledge', (c) => (requireService(c.req.param('id')), c.json(listKnowledge(c.req.param('id')))))
  .put('/services/:id/knowledge/:name', async (c) => {
    const body = await parseBody(c, z.object({ content: z.string() }));
    saveKnowledge(c.req.param('id'), c.req.param('name'), body.content);
    return c.body(null, 204);
  });
