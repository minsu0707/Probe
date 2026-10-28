import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../../http/validate.ts';
import { fetchLiveUsage } from './live-usage.ts';
import { getProfile } from './settings.ts';
import { recordUsage } from './usage.ts';
import { unprocessable } from '../../core/errors.ts';
import { installMcp, mcpStatus, removeMcp } from './mcp.ts';
import { cancelLogin, claudeStatus, loginState, logout, selectProfile, startLogin, submitLoginCode } from './service.ts';

/** Claude is the only agent today; the path leaves room for others (`/agents/<name>`). */
export const agentsRoutes = new Hono()
  .get('/agents/claude', async (c) => c.json(await claudeStatus()))
  .post('/agents/claude/usage/refresh', async (c) => {
    try {
      recordUsage(await fetchLiveUsage(getProfile()));
    } catch (e) {
      throw unprocessable((e as Error).message);
    }
    return c.json(await claudeStatus());
  })
  .put('/agents/claude/profile', async (c) => {
    selectProfile((await parseBody(c, z.object({ profile: z.enum(['probe', 'system']) }))).profile);
    return c.json(await claudeStatus());
  })
  .post('/agents/claude/login', async (c) => {
    const body = await parseBody(c, z.object({ method: z.enum(['claudeai', 'console']).optional(), email: z.string().optional() }));
    return c.json(startLogin(body), 202);
  })
  .post('/agents/claude/login/code', async (c) => {
    submitLoginCode((await parseBody(c, z.object({ code: z.string() }))).code);
    return c.json(loginState());
  })
  .post('/agents/claude/login/cancel', (c) => (cancelLogin(), c.body(null, 204)))
  .get('/integrations/mcp', async (c) => c.json(await mcpStatus()))
  .post('/integrations/mcp', async (c) => c.json(await installMcp()))
  .delete('/integrations/mcp', async (c) => c.json(await removeMcp()))
  .post('/agents/claude/logout', async (c) => (await logout(), c.json(await claudeStatus())));
