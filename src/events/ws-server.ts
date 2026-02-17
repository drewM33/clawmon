/**
 * Trusted ClawMon — WebSocket Broadcast Server (Phase 7)
 *
 * Attaches a WebSocket server to the existing HTTP server.
 * Subscribes to internal events via the TrustHubEmitter and
 * broadcasts them as JSON messages to all connected dashboard clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { trustHubEmitter } from './emitter.js';
import type { WSEvent, WSEventType } from './types.js';

let wss: WebSocketServer | null = null;
let clientCount = 0;

/**
 * Initialize the WebSocket server on an existing HTTP server.
 * Call this once after creating the HTTP server.
 */
export function initWebSocketServer(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clientCount++;
    console.log(`[WS] Client connected (${clientCount} total)`);

    // Send init event with server state
    const initEvent: WSEvent = {
      type: 'connection:init',
      payload: {
        serverTime: Date.now(),
        connectedClients: clientCount,
      },
    };
    ws.send(JSON.stringify(initEvent));

    // Handle pong for keepalive
    (ws as any).__isAlive = true;
    ws.on('pong', () => {
      (ws as any).__isAlive = true;
    });

    ws.on('close', () => {
      clientCount--;
      console.log(`[WS] Client disconnected (${clientCount} remaining)`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  // Keepalive ping every 30s
  const pingInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if ((ws as any).__isAlive === false) {
        ws.terminate();
        return;
      }
      (ws as any).__isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  // Subscribe to all internal events and broadcast
  const eventTypes: WSEventType[] = [
    'feedback:new',
    'feedback:revoked',
    'score:updated',
    'staking:event',
    'agent:registered',
    'stats:updated',
    'leaderboard:updated',
    'graph:updated',
  ];

  for (const eventType of eventTypes) {
    trustHubEmitter.on(eventType, (event: WSEvent) => {
      broadcast(event);
    });
  }

  console.log('[WS] WebSocket server initialized on /ws');
  return wss;
}

/**
 * Broadcast a WSEvent to all connected clients.
 */
export function broadcast(event: WSEvent): void {
  if (!wss) return;
  const data = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Get number of connected clients.
 */
export function getConnectedClientCount(): number {
  return clientCount;
}

/**
 * Close the WebSocket server gracefully.
 */
export function closeWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }
    wss.close(() => {
      wss = null;
      clientCount = 0;
      resolve();
    });
  });
}
