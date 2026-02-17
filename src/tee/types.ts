/**
 * Trusted ClawMon — TEE Attestation Types (Phase 8)
 *
 * Types for the simulated Trusted Execution Environment attestation layer.
 * Designed so a real TEE backend (SGX DCAP, TDX, SEV) can replace the
 * simulated enclave without changing consumer code.
 *
 * Key concepts:
 *   - RuntimeReport: what the enclave observed during skill execution
 *   - TEEAttestation: a signed report + enclave identity proof
 *   - AttestationResult: verification outcome
 *   - CodeHashPin: the "known good" code hash registered at staking time
 */

import type { TrustTier } from '../scoring/types.js';

// ---------------------------------------------------------------------------
// Platform Types
// ---------------------------------------------------------------------------

/** Supported TEE platform types. 'simulated' is used for v1. */
export type TEEPlatformType = 'sgx' | 'tdx' | 'sev' | 'simulated';

// ---------------------------------------------------------------------------
// Runtime Report — what the enclave observed
// ---------------------------------------------------------------------------

/**
 * A runtime report generated inside the TEE enclave during skill execution.
 * This is the core data that gets signed by the enclave's private key.
 */
export interface RuntimeReport {
  /** The agent/skill that was executed */
  agentId: string;
  /** SHA-256 hash of the agent code that was loaded into the enclave */
  codeHash: string;
  /** Total execution time in milliseconds */
  executionTimeMs: number;
  /** List of external API endpoints called during execution */
  apiCallsMade: string[];
  /** List of data sources / resources accessed */
  dataAccessed: string[];
  /** Any errors encountered during execution */
  errors: string[];
  /** Memory usage in bytes at peak */
  peakMemoryBytes: number;
  /** Unix timestamp (ms) when the report was generated */
  timestamp: number;
  /** Unique nonce to prevent replay attacks */
  nonce: string;
}

// ---------------------------------------------------------------------------
// TEE Attestation — signed report + enclave proof
// ---------------------------------------------------------------------------

/**
 * A TEE attestation is a signed runtime report bundled with enclave
 * identity information. The signature proves the report was generated
 * inside a genuine TEE (or a simulated one for v1).
 */
export interface TEEAttestation {
  /** Unique attestation ID */
  id: string;
  /** The runtime report from inside the enclave */
  report: RuntimeReport;
  /** Identifier for the specific enclave instance */
  enclaveId: string;
  /** Which TEE platform produced this attestation */
  platformType: TEEPlatformType;
  /** Ed25519 signature over the canonical JSON of the report */
  signature: string;
  /** Hex-encoded public key of the enclave */
  publicKey: string;
  /** Hash of the full attestation (for on-chain anchoring) */
  attestationHash: string;
}

// ---------------------------------------------------------------------------
// Verification Result
// ---------------------------------------------------------------------------

/**
 * Result of verifying a TEE attestation.
 * All checks must pass for Tier 3 eligibility.
 */
export interface TEEVerificationResult {
  /** Overall validity — all checks passed */
  valid: boolean;
  /** Signature is cryptographically valid */
  signatureValid: boolean;
  /** Current code hash matches the pinned "known good" hash */
  codeHashMatch: boolean;
  /** Attestation came from a recognized TEE platform */
  platformVerified: boolean;
  /** Attestation report is within the freshness window */
  reportFresh: boolean;
  /** No suspicious patterns in the runtime report */
  behaviorClean: boolean;
  /** All checks pass → agent qualifies for Tier 3 */
  tier3Eligible: boolean;
  /** Human-readable verification notes */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Code Hash Pin — the "known good" state
// ---------------------------------------------------------------------------

/**
 * A pinned code hash represents the audited/staked code state.
 * The TEE attestation's codeHash is compared against this pin.
 */
export interface CodeHashPin {
  agentId: string;
  /** SHA-256 hash of the "known good" agent code */
  codeHash: string;
  /** Unix timestamp (seconds) when pinned */
  pinnedAt: number;
  /** Publisher address that pinned it */
  pinnedBy: string;
  /** Optional link to an audit report */
  auditReference?: string;
}

// ---------------------------------------------------------------------------
// TEE Agent State — per-agent TEE status
// ---------------------------------------------------------------------------

/** TEE verification status for an agent */
export type TEEStatus =
  | 'verified'    // Latest attestation is valid and fresh
  | 'stale'       // Valid but older than freshness window
  | 'mismatch'    // Code hash doesn't match pinned hash
  | 'failed'      // Signature or platform verification failed
  | 'unregistered'; // No TEE attestation exists

/**
 * Aggregate TEE state for a single agent, combining attestation
 * history with verification results.
 */
export interface TEEAgentState {
  agentId: string;
  status: TEEStatus;
  /** The latest attestation (null if unregistered) */
  latestAttestation: TEEAttestation | null;
  /** Verification result for the latest attestation */
  latestVerification: TEEVerificationResult | null;
  /** The pinned code hash (null if not pinned) */
  codeHashPin: CodeHashPin | null;
  /** Number of attestations submitted for this agent */
  attestationCount: number;
  /** Number of successful verifications */
  successfulVerifications: number;
  /** Number of failed verifications */
  failedVerifications: number;
  /** Whether this agent qualifies for Tier 3 trust */
  tier3Active: boolean;
  /** Trust weight multiplier from TEE verification (1.0 = no boost) */
  trustWeightMultiplier: number;
}

// ---------------------------------------------------------------------------
// TEE Stats — aggregate statistics
// ---------------------------------------------------------------------------

export interface TEEStats {
  /** Total agents with at least one TEE attestation */
  totalRegistered: number;
  /** Agents with currently valid + fresh attestation */
  verifiedCount: number;
  /** Agents with stale attestations */
  staleCount: number;
  /** Agents with code hash mismatches */
  mismatchCount: number;
  /** Agents that failed verification */
  failedCount: number;
  /** Agents with no TEE registration */
  unregisteredCount: number;
  /** Agents qualifying for Tier 3 */
  tier3ActiveCount: number;
  /** Average trust weight multiplier across verified agents */
  avgTrustWeight: number;
  /** Average execution time from latest reports (ms) */
  avgExecutionTimeMs: number;
  /** Total attestations submitted */
  totalAttestations: number;
  /** Enclave public key (for verification) */
  enclavePublicKey: string;
  /** Platform type in use */
  platformType: TEEPlatformType;
}

// ---------------------------------------------------------------------------
// TEE Configuration
// ---------------------------------------------------------------------------

export interface TEEConfig {
  /** Freshness window in seconds (default: 86400 = 24h) */
  freshnessWindowSeconds: number;
  /** Trust weight multiplier for TEE-verified feedback */
  verifiedTrustWeight: number;
  /** Score boost for agents with active Tier 3 status */
  tier3ScoreBoost: number;
  /** Maximum API calls before flagging as suspicious */
  maxApiCallsThreshold: number;
  /** Maximum execution time (ms) before flagging */
  maxExecutionTimeMs: number;
  /** Maximum errors before flagging */
  maxErrorsThreshold: number;
}

export const DEFAULT_TEE_CONFIG: TEEConfig = {
  freshnessWindowSeconds: 86400,  // 24 hours
  verifiedTrustWeight: 1.5,       // 50% boost for TEE-verified feedback
  tier3ScoreBoost: 5,             // +5 score points for Tier 3 agents
  maxApiCallsThreshold: 50,       // flag if >50 API calls
  maxExecutionTimeMs: 30_000,     // flag if >30s execution
  maxErrorsThreshold: 5,          // flag if >5 errors
};

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

export interface TEEAttestationResponse {
  id: string;
  agentId: string;
  status: TEEStatus;
  verification: TEEVerificationResult;
  report: RuntimeReport;
  enclaveId: string;
  platformType: TEEPlatformType;
  attestationHash: string;
  timestamp: number;
}

export interface TEEAgentResponse {
  agentId: string;
  status: TEEStatus;
  tier3Active: boolean;
  trustWeightMultiplier: number;
  attestationCount: number;
  successfulVerifications: number;
  failedVerifications: number;
  latestAttestation: {
    id: string;
    codeHash: string;
    executionTimeMs: number;
    apiCallCount: number;
    dataAccessCount: number;
    errorCount: number;
    timestamp: number;
    platformType: TEEPlatformType;
  } | null;
  codeHashPin: {
    codeHash: string;
    pinnedAt: number;
    pinnedBy: string;
    auditReference?: string;
  } | null;
  verification: TEEVerificationResult | null;
}

export interface TEEOverviewItem {
  agentId: string;
  status: TEEStatus;
  tier3Active: boolean;
  trustWeight: number;
  codeHash: string | null;
  pinnedCodeHash: string | null;
  codeHashMatch: boolean;
  executionTimeMs: number | null;
  apiCallCount: number | null;
  errorCount: number | null;
  lastAttestationTime: number | null;
  attestationCount: number;
  platformType: TEEPlatformType | null;
}

// ---------------------------------------------------------------------------
// Enclave Interface — abstraction for real vs. simulated TEE
// ---------------------------------------------------------------------------

/**
 * Interface that both the simulated enclave and a real TEE implementation
 * must satisfy. This is the swap point for upgrading from simulation
 * to real SGX/TDX/SEV.
 */
export interface TEEEnclaveProvider {
  /** Get the enclave's public key (hex-encoded) */
  getPublicKey(): string;
  /** Get a unique identifier for this enclave instance */
  getEnclaveId(): string;
  /** Get the platform type */
  getPlatformType(): TEEPlatformType;
  /** Sign a runtime report, producing a TEE attestation */
  signReport(report: RuntimeReport): Promise<TEEAttestation>;
  /** Verify a TEE attestation signature */
  verifySignature(attestation: TEEAttestation): Promise<boolean>;
}
