/** Entry point: open the database, prepare workspaces, start HTTP and the WebSocket. */
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { PORT } from './config.ts';
import { recoverInterrupted } from './core/db.ts';
import { addSocket } from './core/hub.ts';
import { allowedHosts, isAllowedOrigin } from './http/guard.ts';
import { buildApp } from './http/app.ts';
import { refreshMissingFavicons } from './modules/services/favicon.ts';
import { scaffoldAllWorkspaces } from './modules/services/workspace.ts';

recoverInterrupted();
scaffoldAllWorkspaces();
refreshMissingFavicons();

const server = serve({ fetch: buildApp().fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`Probe is running at http://127.0.0.1:${PORT}`);
});

// The WebSocket shares the HTTP port and gets the same Host and Origin checks (WebSockets skip the
// Hono middleware, so they have to be repeated here). Without the Origin check any web page the user
// has open could connect to ws://127.0.0.1 and read the live logs and conversations.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!allowedHosts().has(req.headers.host ?? '') || (origin !== undefined && !isAllowedOrigin(origin)) || req.url !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => addSocket(ws));
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0));
