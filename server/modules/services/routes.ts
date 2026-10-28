import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { readFavicon } from './favicon.ts';
import { serviceOverview } from './overview.ts';
import { createService, deleteService, listServices, updateService } from './service.ts';

export const servicesRoutes = new Hono()
  .get('/services', (c) => c.json(listServices().map((s) => serviceOverview(s.id))))
  .post('/services', async (c) => {
    const body = await parseBody(c, z.object({ name: z.string(), baseUrl: z.string().optional(), notes: z.string().optional(), readOnly: z.boolean().optional() }));
    return c.json(serviceOverview(createService(body).id), 201);
  })
  .get('/services/:id', (c) => c.json(serviceOverview(c.req.param('id'))))
  .get('/services/:id/favicon', (c) => {
    const icon = readFavicon(c.req.param('id'));
    if (!icon) return c.body(null, 404);
    // The bytes come from someone else's site: never let them run as a page (an SVG could carry script).
    return c.body(icon.bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': icon.type, 'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400' });
  })
  .patch('/services/:id', async (c) => {
    const body = await parseBody(c, z.object({ name: z.string().optional(), baseUrl: z.string().nullable().optional(), notes: z.string().nullable().optional(), readOnly: z.boolean().optional(), conventions: z.string().max(20000).nullable().optional() }));
    return c.json(serviceOverview(updateService(c.req.param('id'), body).id));
  })
  .delete('/services/:id', (c) => (deleteService(c.req.param('id')), c.body(null, 204)));
