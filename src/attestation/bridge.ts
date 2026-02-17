/**
 * Trusted ClawMon — Attestation Service (Phase 5)
 *
 * Publishes trust score snapshots as on-chain attestations to the
 * AttestationRegistry contract on Monad.
 *
 * Supports:
 *   - Single-agent attestation
 *   - Batch attestation (gas-efficient)
 *   - On-chain attestation reads
 *   - Simulated mode for local dev (no contract required)
 */

import { ethers } from 'ethers';
import type { TrustTier } from '../scoring/types.js';
import type {
  AttestationRecord,
  AttestationBatchResult,
  AttestationStatusInfo,
  AttestationStatus,
  AttestationStatsResponse,
} from './types.js';
import { TIER_TO_UINT8, UINT8_TO_TIER } from './types.js';
import { getProvider as getMonadProvider, getSigner as getMonadSigner } from '../monad/client.js';

// ---------------------------------------------------------------------------
// ABI (minimal — only the functions we use)
// ---------------------------------------------------------------------------

const ATTESTATION_REGISTRY_ABI = [
  'function publishAttestation(bytes32 agentId, uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, string sourceChain) external',
  'function batchPublishAttestations(bytes32[] agentIds, uint16[] scores, uint8[] tiers, uint32[] feedbackCounts, uint64[] sourceTimestamps, string sourceChain) external',
  'function revokeAttestation(bytes32 agentId, string reason) external',
  'function isAttested(bytes32 agentId) view returns (bool)',
  'function getAttestation(bytes32 agentId) view returns (uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, uint64 attestedAt, string sourceChain, bool revoked, bool isFresh)',
  'function getAttestationAge(bytes32 agentId) view returns (uint64)',
  'function verifyMinScore(bytes32 agentId, uint16 minScore) view returns (bool)',
  'function verifyMinTier(bytes32 agentId, uint8 minTier) view returns (bool)',
  'function getAttestedAgentCount() view returns (uint256)',
  'function getAttestedAgent(uint256 index) view returns (bytes32)',
  'function attestationCount(bytes32 agentId) view returns (uint256)',
  'function totalAttestations() view returns (uint256)',
  'function attester() view returns (address)',
];

// ---------------------------------------------------------------------------
// Contract Configuration
// ---------------------------------------------------------------------------

const ATTESTATION_CONTRACT_ADDRESS = process.env.ATTESTATION_CONTRACT_ADDRESS || '';
const SOURCE_CHAIN = 'monad-testnet';

let _readContract: ethers.Contract | null = null;
let _writeContract: ethers.Contract | null = null;

function getReadContract(): ethers.Contract | null {
  if (!ATTESTATION_CONTRACT_ADDRESS) return null;
  if (!_readContract) {
    _readContract = new ethers.Contract(
      ATTESTATION_CONTRACT_ADDRESS,
      ATTESTATION_REGISTRY_ABI,
      getMonadProvider(),
    );
  }
  return _readContract;
}

function getWriteContract(): ethers.Contract | null {
  if (!ATTESTATION_CONTRACT_ADDRESS) return null;
  if (!_writeContract) {
    try {
      _writeContract = new ethers.Contract(
        ATTESTATION_CONTRACT_ADDRESS,
        ATTESTATION_REGISTRY_ABI,
        getMonadSigner(),
      );
    } catch {
      return null;
    }
  }
  return _writeContract;
}

/** Convert agentId string to bytes32 keccak hash */
export function agentIdToHash(agentId: string): string {
  return ethers.id(agentId);
}

// ---------------------------------------------------------------------------
// On-Chain Reads
// ---------------------------------------------------------------------------

/**
 * Read attestation for an agent from the deployed contract.
 */
export async function readAttestation(agentId: string): Promise<AttestationRecord | null> {
  const contract = getReadContract();
  if (!contract) return null;

  const hash = agentIdToHash(agentId);
  try {
    const result = await contract.getAttestation(hash);
    if (Number(result.attestedAt) === 0) return null;

    return {
      agentId,
      agentIdHash: hash,
      score: Number(result.score),
      tier: UINT8_TO_TIER[Number(result.tier)] ?? 'C',
      tierNum: Number(result.tier),
      feedbackCount: Number(result.feedbackCount),
      sourceTimestamp: Number(result.sourceTimestamp),
      attestedAt: Number(result.attestedAt),
      sourceChain: result.sourceChain,
      revoked: result.revoked,
      isFresh: result.isFresh,
    };
  } catch {
    return null;
  }
}

/**
 * Check if an agent has a valid attestation (non-revoked, fresh).
 */
export async function checkAttested(agentId: string): Promise<boolean> {
  const contract = getReadContract();
  if (!contract) return false;

  try {
    return await contract.isAttested(agentIdToHash(agentId));
  } catch {
    return false;
  }
}

/**
 * Get full attestation status info for an agent.
 */
export async function getAttestationStatus(agentId: string): Promise<AttestationStatusInfo> {
  const contract = getReadContract();
  if (!contract) {
    const sim = getSimulatedAttestation(agentId);
    if (sim) {
      const age = Math.floor(Date.now() / 1000) - sim.attestedAt;
      let status: AttestationStatus = 'active';
      if (sim.revoked) status = 'revoked';
      else if (!sim.isFresh) status = 'stale';
      return { status, record: sim, ageSeconds: age, attestationCount: 1 };
    }
    return { status: 'none', record: null, ageSeconds: -1, attestationCount: 0 };
  }

  const hash = agentIdToHash(agentId);
  try {
    const [attestation, ageResult, count] = await Promise.all([
      contract.getAttestation(hash),
      contract.getAttestationAge(hash),
      contract.attestationCount(hash),
    ]);

    if (Number(attestation.attestedAt) === 0) {
      return { status: 'none', record: null, ageSeconds: -1, attestationCount: 0 };
    }

    const record: AttestationRecord = {
      agentId,
      agentIdHash: hash,
      score: Number(attestation.score),
      tier: UINT8_TO_TIER[Number(attestation.tier)] ?? 'C',
      tierNum: Number(attestation.tier),
      feedbackCount: Number(attestation.feedbackCount),
      sourceTimestamp: Number(attestation.sourceTimestamp),
      attestedAt: Number(attestation.attestedAt),
      sourceChain: attestation.sourceChain,
      revoked: attestation.revoked,
      isFresh: attestation.isFresh,
    };

    let status: AttestationStatus = 'active';
    if (record.revoked) status = 'revoked';
    else if (!record.isFresh) status = 'stale';

    return {
      status,
      record,
      ageSeconds: Number(ageResult),
      attestationCount: Number(count),
    };
  } catch {
    return { status: 'none', record: null, ageSeconds: -1, attestationCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// On-Chain Writes
// ---------------------------------------------------------------------------

/**
 * Publish a single attestation to the contract.
 */
export async function publishAttestation(
  agentId: string,
  score: number,
  tier: TrustTier,
  feedbackCount: number,
): Promise<{ success: boolean; txHash: string | null; error?: string }> {
  const contract = getWriteContract();
  if (!contract) {
    return { success: false, txHash: null, error: 'No contract or signer key configured' };
  }

  const hash = agentIdToHash(agentId);
  const tierNum = TIER_TO_UINT8[tier];
  const sourceTimestamp = Math.floor(Date.now() / 1000);

  try {
    const tx = await contract.publishAttestation(
      hash, score, tierNum, feedbackCount, sourceTimestamp, SOURCE_CHAIN,
    );
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.hash };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, txHash: null, error: message };
  }
}

/**
 * Publish attestations for multiple agents in one transaction.
 */
export async function batchPublishAttestations(
  agents: Array<{
    agentId: string;
    score: number;
    tier: TrustTier;
    feedbackCount: number;
  }>,
): Promise<AttestationBatchResult> {
  const contract = getWriteContract();
  if (!contract) {
    return {
      success: false,
      agentCount: 0,
      txHash: null,
      gasUsed: 0,
      error: 'No contract or signer key configured',
      attestations: [],
    };
  }

  const sourceTimestamp = Math.floor(Date.now() / 1000);

  const agentIds = agents.map(a => agentIdToHash(a.agentId));
  const scores = agents.map(a => a.score);
  const tiers = agents.map(a => TIER_TO_UINT8[a.tier]);
  const feedbackCounts = agents.map(a => a.feedbackCount);
  const timestamps = agents.map(() => sourceTimestamp);

  try {
    const tx = await contract.batchPublishAttestations(
      agentIds, scores, tiers, feedbackCounts, timestamps, SOURCE_CHAIN,
    );
    const receipt = await tx.wait();

    return {
      success: true,
      agentCount: agents.length,
      txHash: receipt.hash,
      gasUsed: Number(receipt.gasUsed ?? 0),
      attestations: agents.map(a => ({
        agentId: a.agentId,
        score: a.score,
        tier: a.tier,
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      agentCount: 0,
      txHash: null,
      gasUsed: 0,
      error: message,
      attestations: [],
    };
  }
}

/**
 * Revoke an attestation for an agent.
 */
export async function revokeOnChainAttestation(
  agentId: string,
  reason: string,
): Promise<{ success: boolean; txHash: string | null; error?: string }> {
  const contract = getWriteContract();
  if (!contract) {
    return { success: false, txHash: null, error: 'No contract or signer key configured' };
  }

  try {
    const tx = await contract.revokeAttestation(agentIdToHash(agentId), reason);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.hash };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, txHash: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// Simulated Data (for local dev / demo without deployed contract)
// ---------------------------------------------------------------------------

const simulatedAttestations = new Map<string, AttestationRecord>();
let simulatedLastBridgeRun = 0;

/**
 * Generate simulated attestation data for all agents.
 * Used when ATTESTATION_CONTRACT_ADDRESS is not set.
 */
export function seedSimulatedAttestations(
  agents: Array<{
    agentId: string;
    score: number;
    tier: TrustTier;
    feedbackCount: number;
    flagged: boolean;
    isSybil: boolean;
  }>,
): void {
  simulatedAttestations.clear();
  const now = Math.floor(Date.now() / 1000);
  simulatedLastBridgeRun = Date.now();

  for (const agent of agents) {
    if (agent.isSybil) continue;
    if (agent.score < 30) continue;

    const staleFactor = agent.flagged ? 86400 * 3 : randomInt(1800, 43200);

    simulatedAttestations.set(agent.agentId, {
      agentId: agent.agentId,
      agentIdHash: ethers.id(agent.agentId),
      score: Math.round(agent.score),
      tier: agent.tier,
      tierNum: TIER_TO_UINT8[agent.tier],
      feedbackCount: agent.feedbackCount,
      sourceTimestamp: now - staleFactor - 60,
      attestedAt: now - staleFactor,
      sourceChain: SOURCE_CHAIN,
      revoked: agent.flagged && Math.random() > 0.3,
      isFresh: !agent.flagged && staleFactor < 86400,
    });
  }
}

/** Get simulated attestation for an agent */
export function getSimulatedAttestation(agentId: string): AttestationRecord | null {
  return simulatedAttestations.get(agentId) ?? null;
}

/** Get all simulated attestations */
export function getAllSimulatedAttestations(): Map<string, AttestationRecord> {
  return new Map(simulatedAttestations);
}

/** Get simulated last bridge run time */
export function getSimulatedLastBridgeRun(): number {
  return simulatedLastBridgeRun;
}

// ---------------------------------------------------------------------------
// Aggregate Stats
// ---------------------------------------------------------------------------

/**
 * Get aggregate attestation statistics. Uses on-chain data if available,
 * otherwise falls back to simulated data.
 */
export async function getAttestationStats(
  agentNames: string[],
): Promise<AttestationStatsResponse> {
  const contract = getReadContract();

  if (contract && ATTESTATION_CONTRACT_ADDRESS) {
    try {
      const [totalCount, totalAttestations] = await Promise.all([
        contract.getAttestedAgentCount(),
        contract.totalAttestations(),
      ]);

      const count = Math.min(Number(totalCount), 50);
      let activeCount = 0;
      let staleCount = 0;
      let revokedCount = 0;
      let scoreSum = 0;
      let scored = 0;
      const tierDist: Record<string, number> = {};

      for (let i = 0; i < count; i++) {
        const hash = await contract.getAttestedAgent(i);
        const a = await contract.getAttestation(hash);
        const tier = UINT8_TO_TIER[Number(a.tier)] ?? 'C';

        if (a.revoked) revokedCount++;
        else if (a.isFresh) activeCount++;
        else staleCount++;

        scoreSum += Number(a.score);
        scored++;
        tierDist[tier] = (tierDist[tier] || 0) + 1;
      }

      return {
        totalAttested: Number(totalCount),
        totalAttestations: Number(totalAttestations),
        activeCount,
        staleCount,
        revokedCount,
        unAttestedCount: agentNames.length - Number(totalCount),
        avgScore: scored > 0 ? Math.round(scoreSum / scored) : 0,
        tierDistribution: tierDist,
        lastBridgeRun: Date.now(),
        contractAddress: ATTESTATION_CONTRACT_ADDRESS,
        sourceChain: SOURCE_CHAIN,
      };
    } catch {
      // Fall through to simulated
    }
  }

  // Simulated fallback
  const all = getAllSimulatedAttestations();
  let activeCount = 0;
  let staleCount = 0;
  let revokedCount = 0;
  let scoreSum = 0;
  const tierDist: Record<string, number> = {};

  for (const [, att] of all) {
    if (att.revoked) revokedCount++;
    else if (att.isFresh) activeCount++;
    else staleCount++;

    scoreSum += att.score;
    tierDist[att.tier] = (tierDist[att.tier] || 0) + 1;
  }

  return {
    totalAttested: all.size,
    totalAttestations: all.size,
    activeCount,
    staleCount,
    revokedCount,
    unAttestedCount: agentNames.length - all.size,
    avgScore: all.size > 0 ? Math.round(scoreSum / all.size) : 0,
    tierDistribution: tierDist,
    lastBridgeRun: simulatedLastBridgeRun,
    contractAddress: ATTESTATION_CONTRACT_ADDRESS || '(simulated)',
    sourceChain: SOURCE_CHAIN,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
