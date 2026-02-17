/**
 * Trusted ClawMon — Singleton EventEmitter (Phase 7)
 *
 * Central event bus for the backend. Components emit events here
 * (e.g. new feedback, score updates), and the WebSocket server
 * subscribes to forward them to connected dashboard clients.
 */

import { EventEmitter } from 'node:events';
import type { TrustHubEvents, WSEvent } from './types.js';

class TrustHubEmitter extends EventEmitter {
  /**
   * Type-safe emit wrapper.
   */
  emitEvent<K extends keyof TrustHubEvents>(
    eventName: K,
    ...args: TrustHubEvents[K]
  ): boolean {
    return this.emit(eventName, ...args);
  }

  /**
   * Type-safe listener wrapper.
   */
  onEvent<K extends keyof TrustHubEvents>(
    eventName: K,
    listener: (...args: TrustHubEvents[K]) => void,
  ): this {
    return this.on(eventName, listener as (...args: unknown[]) => void);
  }
}

/** Singleton instance — import this everywhere */
export const trustHubEmitter = new TrustHubEmitter();
trustHubEmitter.setMaxListeners(50);
