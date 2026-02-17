/**
 * Trusted ClawMon — Cross-Chain Attestation Types (Phase 5)
 *
 * TypeScript representations of the AttestationRegistry contract state
 * and the bridge service configuration.
 */

import type { TrustTier } from '../scoring/types.js';

// ---------------------------------------------------------------------------
// Tier Encoding (matches Solidity uint8 values)
// ---------------------------------------------------------------------------

/** Maps TrustTier strings to the uint8 used in the contract */
export const TIER_TO_UINT8: Record<TrustTier, number> = {
  C:   0,
  CC:  1,
  CCC: 2,
  B:   3,
  BB:  4,
  BBB: 5,
  A:   6,
  AA:  7,
  AAA: 8,
};

/** Maps contract uint8 back to TrustTier string */
export const UINT8_TO_TIER: Record<number, TrustTier> = {
  0: 'C',
  1: 'CC',
  2: 'CCC',
  3: 'B',
  4: 'BB',
  5: 'BBB',
  6: 'A',
  7: 'AA',
  8: 'AAA',
};

// ---------------------------------------------------------------------------
// Attestation Record (mirrors contract Attestation struct)
// ---------------------------------------------------------------------------

export interface AttestationRecord {
  agentId: string;           // human-readable (e.g. "gmail-integration")
  agentIdHash: string;       // bytes32 keccak hash
  score: number;             // 0-100
  tier: TrustTier;           // decoded from uint8
  tierNum: number;           // raw uint8 from contract
  feedbackCount: number;
  sourceTimestamp: number;   // unix seconds — when score was computed
  attestedAt: number;        // unix seconds — when published on-chain
  sourceChain: string;       // e.g. "monad-testnet"
  revoked: boolean;
  isFresh: boolean;          // within 24h freshness window
}

// ---------------------------------------------------------------------------
// Attestation Status (computed from on-chain data)
// ---------------------------------------------------------------------------

export type AttestationStatus =
  | 'active'      // valid, non-revoked, fresh
  | 'stale'       // valid, non-revoked, but older than 24h
  | 'revoked'     // explicitly revoked by attester
  | 'none';       // no attestation exists

export interface AttestationStatusInfo {
  status: AttestationStatus;
  record: AttestationRecord | null;
  ageSeconds: number;       // seconds since attestedAt (or -1 if none)
  attestationCount: number; // how many times attested
}

// ---------------------------------------------------------------------------
// Bridge Service Configuration
// ---------------------------------------------------------------------------

export interface AttestationBridgeConfig {
  contractAddress: string;
  attesterPrivateKey: string;
  rpcUrl: string;
  sourceChain: string;           // "monad-testnet"
  batchSize: number;             // max agents per batch tx (default 20)
  freshnessWindowSeconds: number; // 86400 (24h)
}

export const DEFAULT_BRIDGE_CONFIG: Partial<AttestationBridgeConfig> = {
  sourceChain: 'monad-testnet',
  batchSize: 20,
  freshnessWindowSeconds: 86400,
};

// ---------------------------------------------------------------------------
// Bridge Batch Result
// ---------------------------------------------------------------------------

export interface AttestationBatchResult {
  success: boolean;
  agentCount: number;
  txHash: string | null;
  gasUsed: number;
  error?: string;
  attestations: Array<{
    agentId: string;
    score: number;
    tier: TrustTier;
  }>;
}

// ---------------------------------------------------------------------------
// API Response Shapes
// ---------------------------------------------------------------------------

export interface AttestationResponse {
  agentId: string;
  status: AttestationStatus;
  record: AttestationRecord | null;
  ageSeconds: number;
  attestationCount: number;
}

export interface AttestationStatsResponse {
  totalAttested: number;
  totalAttestations: number;
  activeCount: number;
  staleCount: number;
  revokedCount: number;
  unAttestedCount: number;
  avgScore: number;
  tierDistribution: Record<string, number>;
  lastBridgeRun: number;  // unix ms, 0 if never
  contractAddress: string;
  sourceChain: string;
}

// ---------------------------------------------------------------------------
// Contract Constants (mirrored from Solidity)
// ---------------------------------------------------------------------------

export const ATTESTATION_CONSTANTS = {
  FRESHNESS_WINDOW_SECONDS: 86400, // 24 hours
  MAX_SCORE: 100,
  MAX_TIER: 8,
} as const;
