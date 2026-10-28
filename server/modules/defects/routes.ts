import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { answerDefect, clearAnswer, listDefects, reportDefect, updateDefect } from './service.ts';

export const defectsRoutes = new Hono()
  .get('/defects', (c) => c.json(listDefects({ serviceId: c.req.query('serviceId'), status: c.req.query('status'), runId: c.req.query('runId') })))
  .patch('/defects/:id', async (c) => c.json(updateDefect(c.req.param('id'), await parseBody(c, z.object({ status: z.string().optional(), severity: z.string().optional(), title: z.string().optional() })))))
  .put('/defects/:id/answer', async (c) => c.json(answerDefect(c.req.param('id'), await parseBody(c, z.object({ verdict: z.string(), note: z.string().max(1000).optional() })))))
  .delete('/defects/:id/answer', (c) => c.json(clearAnswer(c.req.param('id'))))
  .post('/defects', async (c) =>
    c.json(
      reportDefect(
        await parseBody(c, z.object({ serviceId: z.string(), title: z.string(), detail: z.string(), severity: z.enum(['critical', 'major', 'minor']).optional(), page: z.string().optional(), feature: z.string().optional(), runId: z.string().optional() })),
      ),
      201,
    ),
  );
