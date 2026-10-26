/**
 * WebSocket fan-out. Modules call `broadcast()` after they change something;
 * they never know who (if anyone) is listening.
 */
import type { WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/events.ts';

const sockets = new Set<WebSocket>();

export function addSocket(ws: WebSocket) {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
}

export function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
}
