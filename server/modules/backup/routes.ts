import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest } from '../../core/errors.ts';
import { parseBody } from '../../http/validate.ts';
import { createBackup, openBackup, stageRestore } from './service.ts';

export const backupRoutes = new Hono()
  .post('/backup/create', async (c) => {
    const body = await parseBody(c, z.object({ passphrase: z.string(), includeClaudeContext: z.boolean().optional() }));
    return c.json(await createBackup(body));
  })
  // A plain GET so the browser (or the desktop window) saves it as a download.
  .get('/backup/download/:id', (c) => {
    const file = openBackup(c.req.param('id'));
    return c.body(file.stream, 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(file.size),
      'content-disposition': `attachment; filename="${file.name}"`,
      'cache-control': 'no-store',
    });
  })
  // The file itself is the request body (it can be hundreds of MB); the passphrase travels in a header.
  .post('/backup/restore', async (c) => {
    const passphrase = decodeURIComponent(c.req.header('x-backup-passphrase') ?? '');
    if (!passphrase) throw badRequest('비밀번호를 입력하세요.');
    if (!c.req.raw.body) throw badRequest('백업 파일이 없습니다.');
    return c.json(await stageRestore(c.req.raw.body, passphrase));
  });
