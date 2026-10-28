import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { cancelSession, createSession, deleteSession, getSession, listSessions, renameSession, sendMessage } from './service.ts';

export const sessionsRoutes = new Hono()
  .get('/services/:id/sessions', (c) => c.json(listSessions(c.req.param('id'))))
  .post('/services/:id/sessions', async (c) => {
    const body = await parseBody(c, z.object({ kind: z.enum(['write-tests', 'chat']), message: z.string().max(8000).optional() }));
    return c.json(await createSession(c.req.param('id'), body), 202);
  })
  .get('/sessions/:id', (c) => c.json(getSession(c.req.param('id'))))
  .post('/sessions/:id/messages', async (c) => {
    const body = await parseBody(c, z.object({ text: z.string().min(1).max(8000) }));
    return c.json(await sendMessage(c.req.param('id'), body.text), 202);
  })
  .patch('/sessions/:id', async (c) => {
    const body = await parseBody(c, z.object({ title: z.string().trim().min(1).max(120) }));
    return c.json(renameSession(c.req.param('id'), body.title));
  })
  .post('/sessions/:id/cancel', (c) => (cancelSession(c.req.param('id')), c.body(null, 204)))
  .delete('/sessions/:id', (c) => (deleteSession(c.req.param('id')), c.body(null, 204)));
