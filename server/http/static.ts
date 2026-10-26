import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handler } from 'hono';
import { WEB_DIST } from '../config.ts';

const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' };

/** Serve the built web app; unknown paths get index.html so client-side routes survive a reload. */
export const serveWebApp: Handler = (c) => {
  const rel = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\/+/, '');
  let file = join(WEB_DIST, rel);
  if (rel.includes('..') || !existsSync(file)) file = join(WEB_DIST, 'index.html');
  if (!existsSync(file)) return c.text('Web app not built. Run `npm run build` in probe/, or use `npm run web` for the dev server.', 404);
  return c.body(new Uint8Array(readFileSync(file)), 200, { 'content-type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream' });
};
