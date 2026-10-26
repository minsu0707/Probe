import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { serviceOverview } from './overview.ts';
import { createService, deleteService, listServices, updateService } from './service.ts';

export const servicesRoutes = new Hono()
  .get('/services', (c) => c.json(listServices().map((s) => serviceOverview(s.id))))
  .post('/services', async (c) => {
    const body = await parseBody(c, z.object({ name: z.string(), baseUrl: z.string().optional(), notes: z.string().optional() }));
    return c.json(serviceOverview(createService(body).id), 201);
  })
  .get('/services/:id', (c) => c.json(serviceOverview(c.req.param('id'))))
  .patch('/services/:id', async (c) => {
    const body = await parseBody(c, z.object({ name: z.string().optional(), baseUrl: z.string().nullable().optional(), notes: z.string().nullable().optional() }));
    return c.json(serviceOverview(updateService(c.req.param('id'), body).id));
  })
  .delete('/services/:id', (c) => (deleteService(c.req.param('id')), c.body(null, 204)));
