/**
 * Trusted ClawMon — TEE Attestation Service (Phase 8)
 *
 * Manages TEE attestation state: submitting attestations, querying
 * agent TEE status, computing aggregate statistics, and seeding
 * simulated data for the demo.
 *
 * This service ties together the enclave (signing), verifier (validation),
 * and state storage (in-memory for v1).
 */

import type {
  TEEAttestation,
  TEEVerificationResult,
  CodeHashPin,
  TEEAgentState,
  TEEStatus,
  TEEStats,
  TEEConfig,
  TEEOverviewItem,
  TEEAgentResponse,
  TEEAttestationResponse,
  RuntimeReport,
} from './types.js';
import { DEFAULT_TEE_CONFIG } from './types.js';
import { SimulatedEnclave, getEnclave, generateSimulatedReport, generateCodeHash } from './enclave.js';
import { TEEVerifier, computeTEETrustWeight } from './verifier.js';

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const attestationStore = new Map<string, TEEAttestation[]>();    // agentId → attestations
const verificationStore = new Map<string, TEEVerificationResult>(); // agentId → latest result
const codeHashPins = new Map<string, CodeHashPin>();             // agentId → pin
const agentStates = new Map<string, TEEAgentState>();            // agentId → state

let _verifier: TEEVerifier | null = null;

function getVerifier(): TEEVerifier {
  if (!_verifier) {
    _verifier = new TEEVerifier(getEnclave());
  }
  return _verifier;
}

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

/**
 * Pin a code hash for an agent — establishing the "known good" state.
 */
export function pinCodeHash(
  agentId: string,
  codeHash: string,
  pinnedBy: string,
  auditReference?: string,
): CodeHashPin {
  const pin: CodeHashPin = {
    agentId,
    codeHash,
    pinnedAt: Math.floor(Date.now() / 1000),
    pinnedBy,
    auditReference,
  };
  codeHashPins.set(agentId, pin);
  return pin;
}

/**
 * Submit a TEE attestation for verification.
 * This is the main entry point for the attestation flow:
 *   1. Verify the attestation
 *   2. Store the result
 *   3. Update agent state
 *   4. Return the verification result
 */
export async function submitAttestation(
  attestation: TEEAttestation,
  config: TEEConfig = DEFAULT_TEE_CONFIG,
): Promise<{ attestation: TEEAttestation; verification: TEEVerificationResult }> {
  const agentId = attestation.report.agentId;
  const verifier = getVerifier();
  const pin = codeHashPins.get(agentId) ?? null;

  // Verify the attestation
  const verification = await verifier.verify(attestation, pin);

  // Store attestation
  if (!attestationStore.has(agentId)) {
    attestationStore.set(agentId, []);
  }
  attestationStore.get(agentId)!.push(attestation);

  // Store latest verification
  verificationStore.set(agentId, verification);

  // Update agent state
  updateAgentState(agentId, attestation, verification, config);

  return { attestation, verification };
}

/**
 * Generate and submit a new attestation for an agent via the simulated enclave.
 * Convenience method that handles report generation + signing + submission.
 */
export async function generateAndSubmitAttestation(
  agentId: string,
  opts: {
    flagged?: boolean;
    isSybil?: boolean;
    category?: string;
    codeHash?: string;
  } = {},
  config: TEEConfig = DEFAULT_TEE_CONFIG,
): Promise<{ attestation: TEEAttestation; verification: TEEVerificationResult }> {
  const enclave = getEnclave();
  const codeHash = opts.codeHash ?? generateCodeHash(agentId);
  const report = generateSimulatedReport(agentId, codeHash, opts);
  const attestation = await enclave.signReport(report);
  return submitAttestation(attestation, config);
}

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

function updateAgentState(
  agentId: string,
  attestation: TEEAttestation,
  verification: TEEVerificationResult,
  config: TEEConfig,
): void {
  const existing = agentStates.get(agentId);
  const attestations = attestationStore.get(agentId) ?? [];

  const successCount = (existing?.successfulVerifications ?? 0) + (verification.valid ? 1 : 0);
  const failCount = (existing?.failedVerifications ?? 0) + (verification.valid ? 0 : 1);

  let status: TEEStatus;
  if (verification.tier3Eligible) {
    status = 'verified';
  } else if (verification.valid && !verification.reportFresh) {
    status = 'stale';
  } else if (verification.valid && !verification.codeHashMatch) {
    status = 'mismatch';
  } else if (!verification.valid) {
    status = 'failed';
  } else {
    status = 'stale';
  }

  const trustWeight = computeTEETrustWeight(verification, config);

  agentStates.set(agentId, {
    agentId,
    status,
    latestAttestation: attestation,
    latestVerification: verification,
    codeHashPin: codeHashPins.get(agentId) ?? null,
    attestationCount: attestations.length,
    successfulVerifications: successCount,
    failedVerifications: failCount,
    tier3Active: verification.tier3Eligible,
    trustWeightMultiplier: trustWeight,
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get TEE state for a single agent */
export function getTEEAgentState(agentId: string): TEEAgentState | null {
  return agentStates.get(agentId) ?? null;
}

/** Get all agent TEE states */
export function getAllTEEAgentStates(): Map<string, TEEAgentState> {
  return new Map(agentStates);
}

/** Get all attestations for an agent */
export function getAgentAttestations(agentId: string): TEEAttestation[] {
  return attestationStore.get(agentId) ?? [];
}

/** Get the latest verification result for an agent */
export function getLatestVerification(agentId: string): TEEVerificationResult | null {
  return verificationStore.get(agentId) ?? null;
}

/** Get the pinned code hash for an agent */
export function getCodeHashPin(agentId: string): CodeHashPin | null {
  return codeHashPins.get(agentId) ?? null;
}

/** Get the trust weight multiplier for an agent */
export function getTEETrustWeight(agentId: string): number {
  const state = agentStates.get(agentId);
  return state?.trustWeightMultiplier ?? 1.0;
}

// ---------------------------------------------------------------------------
// API Response Builders
// ---------------------------------------------------------------------------

export function buildTEEAgentResponse(agentId: string): TEEAgentResponse {
  const state = agentStates.get(agentId);
  const att = state?.latestAttestation;

  return {
    agentId,
    status: state?.status ?? 'unregistered',
    tier3Active: state?.tier3Active ?? false,
    trustWeightMultiplier: state?.trustWeightMultiplier ?? 1.0,
    attestationCount: state?.attestationCount ?? 0,
    successfulVerifications: state?.successfulVerifications ?? 0,
    failedVerifications: state?.failedVerifications ?? 0,
    latestAttestation: att ? {
      id: att.id,
      codeHash: att.report.codeHash,
      executionTimeMs: att.report.executionTimeMs,
      apiCallCount: att.report.apiCallsMade.length,
      dataAccessCount: att.report.dataAccessed.length,
      errorCount: att.report.errors.length,
      timestamp: att.report.timestamp,
      platformType: att.platformType,
    } : null,
    codeHashPin: state?.codeHashPin ? {
      codeHash: state.codeHashPin.codeHash,
      pinnedAt: state.codeHashPin.pinnedAt,
      pinnedBy: state.codeHashPin.pinnedBy,
      auditReference: state.codeHashPin.auditReference,
    } : null,
    verification: state?.latestVerification ?? null,
  };
}

export function buildTEEOverviewItem(agentId: string): TEEOverviewItem {
  const state = agentStates.get(agentId);
  const att = state?.latestAttestation;
  const pin = codeHashPins.get(agentId);

  return {
    agentId,
    status: state?.status ?? 'unregistered',
    tier3Active: state?.tier3Active ?? false,
    trustWeight: state?.trustWeightMultiplier ?? 1.0,
    codeHash: att?.report.codeHash ?? null,
    pinnedCodeHash: pin?.codeHash ?? null,
    codeHashMatch: state?.latestVerification?.codeHashMatch ?? false,
    executionTimeMs: att?.report.executionTimeMs ?? null,
    apiCallCount: att ? att.report.apiCallsMade.length : null,
    errorCount: att ? att.report.errors.length : null,
    lastAttestationTime: att?.report.timestamp ?? null,
    attestationCount: state?.attestationCount ?? 0,
    platformType: att?.platformType ?? null,
  };
}

export function buildTEEAttestationResponse(
  attestation: TEEAttestation,
  verification: TEEVerificationResult,
): TEEAttestationResponse {
  const state = agentStates.get(attestation.report.agentId);
  return {
    id: attestation.id,
    agentId: attestation.report.agentId,
    status: state?.status ?? 'unregistered',
    verification,
    report: attestation.report,
    enclaveId: attestation.enclaveId,
    platformType: attestation.platformType,
    attestationHash: attestation.attestationHash,
    timestamp: attestation.report.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Aggregate Statistics
// ---------------------------------------------------------------------------

export function computeTEEStats(allAgentIds: string[]): TEEStats {
  const enclave = getEnclave();
  let verifiedCount = 0;
  let staleCount = 0;
  let mismatchCount = 0;
  let failedCount = 0;
  let unregisteredCount = 0;
  let tier3ActiveCount = 0;
  let trustWeightSum = 0;
  let trustWeightCount = 0;
  let execTimeSum = 0;
  let execTimeCount = 0;
  let totalAttestations = 0;

  for (const agentId of allAgentIds) {
    const state = agentStates.get(agentId);
    if (!state) {
      unregisteredCount++;
      continue;
    }

    totalAttestations += state.attestationCount;

    switch (state.status) {
      case 'verified':
        verifiedCount++;
        break;
      case 'stale':
        staleCount++;
        break;
      case 'mismatch':
        mismatchCount++;
        break;
      case 'failed':
        failedCount++;
        break;
      default:
        unregisteredCount++;
    }

    if (state.tier3Active) tier3ActiveCount++;

    if (state.trustWeightMultiplier !== 1.0) {
      trustWeightSum += state.trustWeightMultiplier;
      trustWeightCount++;
    }

    if (state.latestAttestation) {
      execTimeSum += state.latestAttestation.report.executionTimeMs;
      execTimeCount++;
    }
  }

  return {
    totalRegistered: allAgentIds.length - unregisteredCount,
    verifiedCount,
    staleCount,
    mismatchCount,
    failedCount,
    unregisteredCount,
    tier3ActiveCount,
    avgTrustWeight: trustWeightCount > 0
      ? Math.round((trustWeightSum / trustWeightCount) * 100) / 100
      : 1.0,
    avgExecutionTimeMs: execTimeCount > 0
      ? Math.round(execTimeSum / execTimeCount)
      : 0,
    totalAttestations,
    enclavePublicKey: enclave.getPublicKey(),
    platformType: enclave.getPlatformType(),
  };
}

// ---------------------------------------------------------------------------
// Seed Simulated Data
// ---------------------------------------------------------------------------

/**
 * Seed simulated TEE attestation data for all agents.
 * Called during server startup when no real TEE backend is configured.
 */
export async function seedSimulatedTEE(
  agents: Array<{
    agentId: string;
    score: number;
    tier: string;
    feedbackCount: number;
    flagged: boolean;
    isSybil: boolean;
    category: string;
    isStaked: boolean;
  }>,
  config: TEEConfig = DEFAULT_TEE_CONFIG,
): Promise<void> {
  // Clear existing state
  attestationStore.clear();
  verificationStore.clear();
  codeHashPins.clear();
  agentStates.clear();

  const enclave = getEnclave();

  for (const agent of agents) {
    // Only staked, non-sybil agents would have TEE attestations in production
    // But for demo, we give it to most agents (except sybils)
    if (agent.isSybil) continue;

    // Generate and pin the "known good" code hash
    const codeHash = generateCodeHash(agent.agentId);
    pinCodeHash(
      agent.agentId,
      codeHash,
      `publisher:${agent.agentId}`,
      agent.score > 70 ? `audit-report-${agent.agentId}` : undefined,
    );

    // For flagged/malicious agents, simulate a code hash mismatch
    // (they changed their code after pinning)
    const effectiveCodeHash = agent.flagged
      ? generateCodeHash(agent.agentId, 2) // Different version → mismatch
      : codeHash;

    // Generate and sign a runtime report
    const report = generateSimulatedReport(agent.agentId, effectiveCodeHash, {
      flagged: agent.flagged,
      isSybil: agent.isSybil,
      category: agent.category,
    });

    // Vary the report timestamp for realism
    const ageVariance = agent.flagged
      ? randomInt(90_000_000, 180_000_000)  // Flagged: 25-50h ago (stale)
      : randomInt(600_000, 72_000_000);      // Normal: 10m to 20h ago

    report.timestamp = Date.now() - ageVariance;

    const attestation = await enclave.signReport(report);

    // Submit for verification
    await submitAttestation(attestation, config);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
