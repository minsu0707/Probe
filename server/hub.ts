import type { WebSocket } from 'ws';
import type { ServerMessage } from './types.ts';

const sockets = new Set<WebSocket>();

export function addSocket(ws: WebSocket) {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
}

export function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
}
