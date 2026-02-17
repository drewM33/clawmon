/**
 * Trusted ClawMon — Account / Wallet Helpers
 *
 * Utilities for creating test wallets on Monad.
 * Used by seed scripts and attack simulations to create
 * distinct "publisher" and "reviewer" identities.
 */

import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestAccount {
  /** Ethereum-style address (0x...) */
  address: string;
  /** Private key (hex) */
  privateKey: string;
  /** Public key (hex) */
  publicKey: string;
  /** Human-readable label for this account */
  label: string;
}

// ---------------------------------------------------------------------------
// Account Creation
// ---------------------------------------------------------------------------

/**
 * Create a new random wallet for testing.
 *
 * @param label - Human-readable label (e.g., "sybil-publisher-1")
 */
export function createTestWallet(label: string): TestAccount {
  const wallet = ethers.Wallet.createRandom();

  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey,
    label,
  };
}

/**
 * Create multiple test wallets.
 *
 * @param prefix - Label prefix (e.g., "reviewer" -> "reviewer-0", "reviewer-1", ...)
 * @param count - Number of wallets to create
 */
export function createTestWallets(
  prefix: string,
  count: number,
): TestAccount[] {
  return Array.from({ length: count }, (_, i) =>
    createTestWallet(`${prefix}-${i}`),
  );
}

/**
 * Generate a deterministic "address" string for simulated accounts
 * that don't need to be real wallets. Used in Phase 1
 * for seeding feedback without the cost of real account creation.
 */
export function generateSimulatedAddress(prefix: string, index: number): string {
  return `${prefix}-${index.toString().padStart(4, '0')}`;
}

/**
 * Generate multiple simulated addresses.
 */
export function generateSimulatedAddresses(
  prefix: string,
  count: number,
): string[] {
  return Array.from({ length: count }, (_, i) =>
    generateSimulatedAddress(prefix, i),
  );
}
