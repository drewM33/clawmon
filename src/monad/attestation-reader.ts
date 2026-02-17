/**
 * Trusted ClawMon — AttestationRegistry Reader
 *
 * Reads attestation data from the deployed AttestationRegistry contract
 * on Monad testnet. Provides a reusable interface for both the server
 * and the seed script.
 *
 * Usage:
 *   import { fetchAttestations, isRegistryConfigured } from './attestation-reader.js';
 *   const agents = await fetchAttestations(knownNames);
 */

import { ethers } from 'ethers';
import { getProvider } from './client.js';
import { UINT8_TO_TIER } from '../attestation/types.js';
import type { TrustTier } from '../scoring/types.js';

// ---------------------------------------------------------------------------
// ABI for AttestationRegistry reads
// ---------------------------------------------------------------------------

const ATTESTATION_REGISTRY_ABI = [
  'function getAttestedAgentCount() view returns (uint256)',
  'function getAttestedAgent(uint256 index) view returns (bytes32)',
  'function getAttestation(bytes32 agentId) view returns (uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, uint64 attestedAt, string sourceChain, bool revoked, bool isFresh)',
  'function attestationCount(bytes32 agentId) view returns (uint256)',
  'function totalAttestations() view returns (uint256)',
  'function isAttested(bytes32 agentId) view returns (bool)',
];

// ---------------------------------------------------------------------------
// Parsed attestation record
// ---------------------------------------------------------------------------

export interface OnChainAgent {
  hash: string;
  name: string;
  score: number;
  tier: TrustTier;
  tierNum: number;
  feedbackCount: number;
  sourceTimestamp: number;
  attestedAt: number;
  sourceChain: string;
  revoked: boolean;
  isFresh: boolean;
  attestationCount: number;
  resolvedFromKnown: boolean;
}

// ---------------------------------------------------------------------------
// Hash ↔ Name Mapping
// ---------------------------------------------------------------------------

const nameToHash = new Map<string, string>();
const hashToName = new Map<string, string>();

/**
 * Register agent names for reverse hash resolution.
 * Call this before fetchAttestations() to enable human-readable names.
 */
export function registerKnownNames(names: string[]): void {
  for (const name of names) {
    const hash = ethers.id(name);
    nameToHash.set(name, hash);
    hashToName.set(hash, name);
  }
}

/**
 * Resolve a bytes32 keccak hash to a human-readable agent name.
 * Returns a truncated hash prefix if unresolved.
 */
export function resolveAgentName(hash: string): string {
  return hashToName.get(hash) ?? `unknown-${hash.slice(0, 10)}`;
}

/**
 * Get the bytes32 hash for a known agent name.
 */
export function getAgentHash(name: string): string | undefined {
  return nameToHash.get(name);
}

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

const REGISTRY_ADDRESS = process.env.ATTESTATION_CONTRACT_ADDRESS || '';

/**
 * Check if the AttestationRegistry contract address is configured.
 */
export function isRegistryConfigured(): boolean {
  return REGISTRY_ADDRESS.length > 0;
}

/**
 * Get the configured contract address.
 */
export function getRegistryAddress(): string {
  return REGISTRY_ADDRESS;
}

// ---------------------------------------------------------------------------
// Fetch all attestations from the registry
// ---------------------------------------------------------------------------

/**
 * Enumerate all attested agents from the AttestationRegistry contract
 * and return parsed records. Agents are sorted by score descending.
 *
 * @param additionalNames - Extra agent names to register for hash resolution
 *                          (in addition to any previously registered names)
 */
export async function fetchAttestations(
  additionalNames?: string[],
): Promise<OnChainAgent[]> {
  if (!isRegistryConfigured()) {
    console.log('  [attestation-reader] No ATTESTATION_CONTRACT_ADDRESS configured — skipping');
    return [];
  }

  if (additionalNames) {
    registerKnownNames(additionalNames);
  }

  const provider = getProvider();
  const contract = new ethers.Contract(
    REGISTRY_ADDRESS,
    ATTESTATION_REGISTRY_ABI,
    provider,
  );

  const [agentCount, totalAttestationCount] = await Promise.all([
    contract.getAttestedAgentCount(),
    contract.totalAttestations(),
  ]);

  const count = Number(agentCount);
  const total = Number(totalAttestationCount);
  console.log(`  [attestation-reader] Found ${count} attested agents, ${total} total attestations`);

  if (count === 0) return [];

  const agents: OnChainAgent[] = [];
  const batchSize = 20;

  for (let i = 0; i < count; i += batchSize) {
    const end = Math.min(i + batchSize, count);
    const batchPromises: Promise<void>[] = [];

    for (let j = i; j < end; j++) {
      batchPromises.push(
        (async () => {
          const hash = await contract.getAttestedAgent(j);
          const hashStr = hash as string;

          const [attestation, attCount] = await Promise.all([
            contract.getAttestation(hashStr),
            contract.attestationCount(hashStr),
          ]);

          const attestedAtNum = Number(attestation.attestedAt);
          if (attestedAtNum === 0) return;

          const name = resolveAgentName(hashStr);
          const tierNum = Number(attestation.tier);

          agents.push({
            hash: hashStr,
            name,
            score: Number(attestation.score),
            tier: UINT8_TO_TIER[tierNum] ?? 'C',
            tierNum,
            feedbackCount: Number(attestation.feedbackCount),
            sourceTimestamp: Number(attestation.sourceTimestamp),
            attestedAt: attestedAtNum,
            sourceChain: attestation.sourceChain,
            revoked: attestation.revoked,
            isFresh: attestation.isFresh,
            attestationCount: Number(attCount),
            resolvedFromKnown: hashToName.has(hashStr),
          });
        })(),
      );
    }

    await Promise.all(batchPromises);

    if (end % 20 === 0 || end === count) {
      console.log(`  [attestation-reader] ${end}/${count} agents read`);
    }
  }

  agents.sort((a, b) => b.score - a.score);
  return agents;
}
