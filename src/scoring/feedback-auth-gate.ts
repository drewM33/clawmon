/**
 * Trusted ClawMon — Feedback Authorization Gate (Phase 2)
 *
 * Verifies that a skill's publisher has authorized open feedback before
 * allowing feedback submission. This is an ERC-8004 compliance requirement:
 * publishers must explicitly opt-in to community review.
 *
 * Two verification paths:
 *   1. On-chain: Read feedbackAuth metadata from ERC-8004 IdentityRegistry
 *   2. Off-chain: Check the cached identity's feedbackAuthPolicy field
 *
 * The on-chain path is the source of truth. The off-chain path is used
 * when the agent has no ERC-8004 identity (wallet-only publishers).
 */

import { ethers } from 'ethers';
import { getAgentMetadata } from '../erc8004/client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackAuthPolicy = 'open' | 'selective' | 'closed' | 'x402_verified';

export interface FeedbackAuthResult {
  /** Whether feedback is authorized */
  authorized: boolean;
  /** The resolved policy */
  policy: FeedbackAuthPolicy;
  /** How the policy was resolved */
  source: 'on_chain' | 'off_chain' | 'default';
  /** Human-readable reason if not authorized */
  reason?: string;
}

// ---------------------------------------------------------------------------
// On-chain check
// ---------------------------------------------------------------------------

/**
 * Check feedback authorization from on-chain ERC-8004 metadata.
 *
 * Reads the `feedbackAuth` metadata key from the IdentityRegistry.
 * Returns null if the agent has no on-chain identity or the metadata
 * is not set (caller should fall back to off-chain check).
 */
export async function checkFeedbackAuthOnChain(
  erc8004AgentId: number,
): Promise<FeedbackAuthResult | null> {
  if (!erc8004AgentId || erc8004AgentId <= 0) return null;

  try {
    const raw = await getAgentMetadata(erc8004AgentId, 'feedbackAuth');
    if (!raw || raw === '0x') {
      return null; // Metadata not set — fall back to off-chain
    }

    const policy = ethers.toUtf8String(raw) as FeedbackAuthPolicy;
    return {
      authorized: policy === 'open' || policy === 'x402_verified',
      policy,
      source: 'on_chain',
      reason: policy === 'closed'
        ? 'Publisher has set feedback authorization to closed'
        : policy === 'selective'
          ? 'Publisher uses selective feedback — check if your address is whitelisted'
          : undefined,
    };
  } catch {
    return null; // Contract call failed — fall back to off-chain
  }
}

// ---------------------------------------------------------------------------
// Off-chain check
// ---------------------------------------------------------------------------

/**
 * Check feedback authorization from off-chain cached identity data.
 *
 * @param feedbackAuthPolicy  The policy from the cached identity (RegisterMessage).
 */
export function checkFeedbackAuthOffChain(
  feedbackAuthPolicy: string | undefined,
): FeedbackAuthResult {
  const policy = (feedbackAuthPolicy || 'open') as FeedbackAuthPolicy;

  return {
    authorized: policy === 'open' || policy === 'x402_verified',
    policy,
    source: 'off_chain',
    reason: policy === 'closed'
      ? 'Publisher has not authorized feedback for this skill'
      : policy === 'selective'
        ? 'Publisher uses selective feedback authorization'
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Combined check (on-chain preferred, off-chain fallback)
// ---------------------------------------------------------------------------

/**
 * Check whether feedback is authorized for a skill.
 *
 * Tries on-chain first (ERC-8004 metadata), falls back to off-chain
 * cached identity data. If neither is available, defaults to open
 * (permissive by default for backward compatibility).
 *
 * @param erc8004AgentId       The ERC-8004 agentId (0 or undefined if wallet-only)
 * @param feedbackAuthPolicy   The off-chain policy from cached identity
 */
export async function checkFeedbackAuth(
  erc8004AgentId: number | undefined,
  feedbackAuthPolicy: string | undefined,
): Promise<FeedbackAuthResult> {
  // Try on-chain first
  if (erc8004AgentId && erc8004AgentId > 0) {
    const onChainResult = await checkFeedbackAuthOnChain(erc8004AgentId);
    if (onChainResult) return onChainResult;
  }

  // Fall back to off-chain
  if (feedbackAuthPolicy) {
    return checkFeedbackAuthOffChain(feedbackAuthPolicy);
  }

  // Default: open (backward compatibility)
  return {
    authorized: true,
    policy: 'open',
    source: 'default',
  };
}

// ---------------------------------------------------------------------------
// Set feedback auth on-chain
// ---------------------------------------------------------------------------

/**
 * Set the feedbackAuth metadata on the ERC-8004 IdentityRegistry.
 *
 * This is called during the publish flow to ensure the publisher
 * explicitly authorizes open feedback (8004 compliance).
 *
 * @param agentId  The ERC-8004 agentId
 * @param policy   The feedback auth policy to set
 * @returns        Transaction hash
 */
export async function setFeedbackAuthOnChain(
  agentId: number,
  policy: FeedbackAuthPolicy = 'open',
): Promise<string> {
  // Import dynamically to avoid circular deps if needed
  const { ethers: eth } = await import('ethers');
  const { getSigner } = await import('../monad/client.js');
  const { getContractAddresses } = await import('../erc8004/client.js');

  const addresses = getContractAddresses();
  const IDENTITY_ABI = [
    'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',
  ];

  const contract = new eth.Contract(
    addresses.identityRegistry,
    IDENTITY_ABI,
    getSigner(),
  );

  const tx = await contract.setMetadata(
    agentId,
    'feedbackAuth',
    eth.toUtf8Bytes(policy),
  );
  const receipt = await tx.wait();
  return receipt.hash;
}
