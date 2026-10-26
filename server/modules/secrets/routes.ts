import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { deleteSecret, exportEnc, importEnv, listSecrets } from './service.ts';

export const secretsRoutes = new Hono()
  .get('/services/:id/env', (c) => c.json(listSecrets(c.req.param('id'))))
  .post('/services/:id/env', async (c) => {
    const body = await parseBody(c, z.object({ text: z.string().max(1_000_000), passphrase: z.string().optional() }));
    return c.json(importEnv(c.req.param('id'), body.text, body.passphrase));
  })
  .delete('/services/:id/env/:key', (c) => (deleteSecret(c.req.param('id'), c.req.param('key')), c.body(null, 204)))
  .post('/services/:id/env/export', async (c) => {
    const body = await parseBody(c, z.object({ passphrase: z.string() }));
    return c.text(exportEnc(c.req.param('id'), body.passphrase));
  });
