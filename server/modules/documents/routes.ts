import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest, HttpError } from '../../core/errors.ts';
import { parseBody } from '../../http/validate.ts';
import { MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS, addDrive, addFile, deleteDoc, listDocs } from './service.ts';

export const documentsRoutes = new Hono()
  .get('/services/:id/docs', (c) => c.json({ docs: listDocs(c.req.param('id')), supported: SUPPORTED_EXTENSIONS }))
  // The raw file is the request body (not multipart); the name travels in the query string.
  .put('/services/:id/docs', async (c) => {
    const name = c.req.query('name');
    if (!name) throw badRequest('name query parameter is required');
    // Reject early on the declared size so a huge upload isn't buffered first.
    if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD_BYTES) throw new HttpError(413, `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
    return c.json(addFile(c.req.param('id'), name, Buffer.from(await c.req.arrayBuffer())), 201);
  })
  .post('/services/:id/docs/drive', async (c) => {
    const body = await parseBody(c, z.object({ url: z.string(), label: z.string().optional() }));
    return c.json(addDrive(c.req.param('id'), body.url, body.label), 201);
  })
  .delete('/services/:id/docs/:docId', (c) => (deleteDoc(c.req.param('id'), c.req.param('docId')), c.body(null, 204)));
