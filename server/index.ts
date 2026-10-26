import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { buildApp } from './app.ts';
import { addSocket } from './hub.ts';
import { ROOT } from './paths.ts';
import { scaffoldAll } from './services.ts';

const PORT = Number(process.env.PORT ?? 4317);
scaffoldAll();

const app = buildApp(PORT, join(ROOT, 'dist'));
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`Probe is running at http://127.0.0.1:${PORT}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host ?? '';
  const ok = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, '127.0.0.1:5173', 'localhost:5173'].includes(host);
  if (!ok || req.url !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => addSocket(ws));
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));
