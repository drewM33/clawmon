/**
 * Trusted ClawMon — WebSocket Client Hook (Phase 7)
 *
 * Maintains a single shared WebSocket connection with automatic
 * reconnection (exponential backoff). Components subscribe to
 * specific event types via useWSEvent().
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getWebSocketURL } from '../config/env';

// ---------------------------------------------------------------------------
// Event types (mirrors server-side WSEventType)
// ---------------------------------------------------------------------------

export type WSEventType =
  | 'feedback:new'
  | 'feedback:revoked'
  | 'score:updated'
  | 'staking:event'
  | 'agent:registered'
  | 'stats:updated'
  | 'graph:updated'
  | 'leaderboard:updated'
  | 'connection:init';

export interface WSEvent {
  type: WSEventType;
  payload: any;
}

// ---------------------------------------------------------------------------
// Shared singleton WebSocket manager
// ---------------------------------------------------------------------------

type WSListener = (event: WSEvent) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<WSListener>>();
  private globalListeners = new Set<WSListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30_000;
  private baseReconnectDelay = 1_000;
  private url: string;
  private _isConnected = false;
  private statusListeners = new Set<(connected: boolean) => void>();

  constructor() {
    this.url = getWebSocketURL();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempt = 0;
        this._isConnected = true;
        this.notifyStatus(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WSEvent = JSON.parse(event.data);
          this.dispatch(data);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[WS] Disconnected:', event.code, event.reason);
        this._isConnected = false;
        this.notifyStatus(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will fire after onerror, so reconnect is handled there
      };
    } catch (err) {
      console.error('[WS] Connection error:', err);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.notifyStatus(false);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay,
    );
    this.reconnectAttempt++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private dispatch(event: WSEvent): void {
    // Notify type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach((listener) => listener(event));
    }
    // Notify global listeners
    this.globalListeners.forEach((listener) => listener(event));
  }

  subscribe(eventType: string, listener: WSListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  subscribeAll(listener: WSListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  onStatusChange(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyStatus(connected: boolean): void {
    this.statusListeners.forEach((l) => l(connected));
  }
}

// Singleton instance
const wsManager = new WebSocketManager();

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/**
 * Initialize and manage the shared WebSocket connection.
 * Call once in your App component or a top-level provider.
 * Returns connection status.
 */
export function useWebSocket(): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(wsManager.isConnected);

  useEffect(() => {
    wsManager.connect();

    const unsub = wsManager.onStatusChange(setIsConnected);

    return () => {
      unsub();
    };
  }, []);

  return { isConnected };
}

/**
 * Subscribe to a specific WebSocket event type.
 * The callback is called with the full WSEvent whenever that type arrives.
 */
export function useWSEvent(eventType: WSEventType, callback: (event: WSEvent) => void): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const handler: WSListener = (event) => cbRef.current(event);
    return wsManager.subscribe(eventType, handler);
  }, [eventType]);
}

/**
 * Subscribe to all WebSocket events.
 */
export function useWSEventAll(callback: (event: WSEvent) => void): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const handler: WSListener = (event) => cbRef.current(event);
    return wsManager.subscribeAll(handler);
  }, []);
}

/**
 * Get current connection status and subscribe to changes.
 */
export function useWSConnectionStatus(): boolean {
  const [connected, setConnected] = useState(wsManager.isConnected);

  useEffect(() => {
    return wsManager.onStatusChange(setConnected);
  }, []);

  return connected;
}
