/**
 * Trusted ClawMon — Monad Client
 *
 * Configures and exports singleton ethers.js provider and signer
 * connected to the Monad network. Reads operator credentials
 * from environment variables.
 *
 * Usage:
 *   import { getProvider, getSigner } from './client.js';
 *   const provider = getProvider();
 *   const signer = getSigner();
 */

import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MONAD_RPC_URL =
  process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------

let _provider: ethers.JsonRpcProvider | null = null;
let _signer: ethers.Wallet | null = null;

/**
 * Get (or create) the singleton Monad JSON-RPC provider.
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(MONAD_RPC_URL);
  }
  return _provider;
}

/**
 * Get (or create) the singleton signer (Wallet) for write operations.
 * Reads MONAD_PRIVATE_KEY from environment.
 */
export function getSigner(): ethers.Wallet {
  if (_signer) return _signer;

  const privateKey = process.env.MONAD_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      'Missing MONAD_PRIVATE_KEY environment variable.\n' +
        'Add your Monad wallet private key to .env',
    );
  }

  _signer = new ethers.Wallet(privateKey, getProvider());
  return _signer;
}

/**
 * Get the operator wallet address.
 */
export function getOperatorAddress(): string {
  return getSigner().address;
}

/**
 * Get the configured RPC URL (for diagnostic display).
 */
export function getRpcUrl(): string {
  return MONAD_RPC_URL;
}

/**
 * Check connectivity by requesting the current block number.
 */
export async function checkHealth(): Promise<{
  blockNumber: number;
  rpcUrl: string;
} | null> {
  try {
    const provider = getProvider();
    const blockNumber = await provider.getBlockNumber();
    return { blockNumber, rpcUrl: MONAD_RPC_URL };
  } catch {
    return null;
  }
}

/**
 * Close / reset the provider and signer. Call on shutdown.
 */
export function closeClient(): void {
  if (_provider) {
    _provider.destroy();
    _provider = null;
  }
  _signer = null;
}
