/**
 * Protection for a local server that holds decrypted credentials.
 *
 * Binding to 127.0.0.1 keeps other machines out, but a web page you visit can still make
 * your browser talk to localhost. Two checks close that gap:
 *  - Host must be ours: defeats DNS rebinding (attacker.com resolving to 127.0.0.1).
 *  - Origin, when a browser sends one on a write, must be ours: defeats cross-site writes.
 * Non-browser callers (MCP, the Playwright reporter) send no Origin and are unaffected.
 */
import type { MiddlewareHandler } from 'hono';
import { PORT } from '../config.ts';

/** 5173 is the Vite dev server, which proxies to us during frontend development. */
export const allowedHosts = (): Set<string> => new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, '127.0.0.1:5173', 'localhost:5173']);

export const guard: MiddlewareHandler = async (c, next) => {
  const hosts = allowedHosts();
  if (!hosts.has(c.req.header('host') ?? '')) return c.json({ error: 'Forbidden host' }, 403);
  const origin = c.req.header('origin');
  if (origin && c.req.method !== 'GET' && !hosts.has(new URL(origin).host)) return c.json({ error: 'Forbidden origin' }, 403);
  await next();
};
