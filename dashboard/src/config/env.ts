/**
 * Trusted ClawMon — Dashboard Environment Configuration
 *
 * Centralizes all VITE_* environment variables used by the dashboard.
 * In development (Vite dev server), the proxy handles /api and /ws routes.
 * In production (Vercel), the full API server URL is required.
 */

/** Absolute URL of the API server, without trailing slash. */
export const API_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') || '';

/**
 * Base path for REST API calls.
 * - Dev (no VITE_API_URL set): requests go to `/api` and Vite proxies them.
 * - Prod (VITE_API_URL set):   requests go to `https://api.example.com/api`.
 */
export const API_BASE = API_URL ? `${API_URL}/api` : '/api';

/**
 * WebSocket URL.
 * - Dev: uses current host with ws:// or wss:// protocol.
 * - Prod: derives from VITE_API_URL (https -> wss, http -> ws).
 */
export function getWebSocketURL(): string {
  if (API_URL) {
    const wsUrl = API_URL.replace(/^http/, 'ws');
    return `${wsUrl}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/** Monad RPC URL for on-chain reads. */
export const MONAD_RPC_URL =
  import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet.monad.xyz/v1';

/** WalletConnect Project ID. */
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';
