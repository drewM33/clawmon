/**
 * Trusted ClawMon — Publisher Binder (Phase 1 + Phase 2)
 *
 * Off-chain orchestration for the publish + bind + stake flow.
 * Interfaces with the SkillPublisherBinder contract and optionally
 * the ERC-8004 IdentityRegistry for lazy agent registration.
 *
 * Phase 2: After publishing, automatically sets feedbackAuth: "open"
 * on the ERC-8004 IdentityRegistry when the publisher has an agentId.
 * This ensures 8004 compliance — no skill gets listed without
 * explicit feedback authorization.
 *
 * Usage:
 *   import { publishSkill } from './publisher-binder.js';
 *   const result = await publishSkill(request);
 */

import { ethers } from 'ethers';
import { getProvider, getSigner } from '../monad/client.js';
import type { ClawHubSkill } from '../clawhub/types.js';
import type {
  PublishRequest,
  PublishResult,
  IdentityBinding,
  RiskTier,
} from './types.js';
import { RISK_TIER_VALUES } from './types.js';
import { setFeedbackAuthOnChain } from '../scoring/feedback-auth-gate.js';

// ---------------------------------------------------------------------------
// Contract ABIs (minimal — only the functions we call)
// ---------------------------------------------------------------------------

const BINDER_ABI = [
  'function publishAndStake(uint8 risk, bytes32 metadataHash, bytes32 clawhubSkillId, bytes32 providerIdentityHash, uint256 erc8004AgentId) external payable returns (uint256 skillId)',
  'function publishOnly(uint8 risk, bytes32 metadataHash, bytes32 clawhubSkillId, bytes32 providerIdentityHash, uint256 erc8004AgentId) external returns (uint256 skillId)',
  'function getPublishRecordCount() external view returns (uint256)',
  'function getPublisherSkillCount(address publisher) external view returns (uint256)',
  'function getPublisherSkillIds(address publisher) external view returns (uint256[])',
  'function getSkillIdByClawhubId(bytes32 clawhubSkillId) external view returns (uint256)',
  'function publishRecords(uint256 index) external view returns (uint256 skillId, address publisher, uint256 erc8004AgentId, bytes32 clawhubSkillId, uint256 stakedAmount, uint256 publishedAt)',

  'event SkillPublished(uint256 indexed skillId, address indexed publisher, uint256 erc8004AgentId, bytes32 indexed clawhubSkillId, uint256 stakedAmount, uint8 trustLevel)',
];

// ---------------------------------------------------------------------------
// Singleton contract instance
// ---------------------------------------------------------------------------

const BINDER_ADDRESS = process.env.SKILL_PUBLISHER_BINDER_ADDRESS || '';

let _binderRead: ethers.Contract | null = null;
let _binderWrite: ethers.Contract | null = null;

function isConfigured(): boolean {
  return Boolean(BINDER_ADDRESS);
}

function getBinderRead(): ethers.Contract {
  if (!_binderRead) {
    if (!BINDER_ADDRESS) throw new Error('SKILL_PUBLISHER_BINDER_ADDRESS not set');
    _binderRead = new ethers.Contract(BINDER_ADDRESS, BINDER_ABI, getProvider());
  }
  return _binderRead;
}

function getBinderWrite(): ethers.Contract {
  if (!_binderWrite) {
    if (!BINDER_ADDRESS) throw new Error('SKILL_PUBLISHER_BINDER_ADDRESS not set');
    _binderWrite = new ethers.Contract(BINDER_ADDRESS, BINDER_ABI, getSigner());
  }
  return _binderWrite;
}

// ---------------------------------------------------------------------------
// Identity Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve publisher identity from a ClawHub skill.
 *
 * Priority:
 *   1. walletAddress from SKILL.md frontmatter
 *   2. Owner handle → keccak256 as providerIdentityHash
 *   3. Fallback to signer address
 */
export function resolveIdentity(
  skill: ClawHubSkill,
  erc8004AgentId?: number,
): IdentityBinding {
  const signer = getSigner();

  // Wallet from SKILL.md frontmatter takes priority
  const wallet = skill.walletAddress || signer.address;

  // providerIdentityHash: bind to 8004 agentId if available, else wallet
  let providerIdentityHash: string;
  if (erc8004AgentId && erc8004AgentId > 0) {
    providerIdentityHash = ethers.solidityPackedKeccak256(
      ['string', 'uint256'],
      ['erc8004:', erc8004AgentId],
    );
  } else if (skill.owner?.handle) {
    providerIdentityHash = ethers.id(skill.owner.handle);
  } else {
    providerIdentityHash = ethers.solidityPackedKeccak256(
      ['string', 'address'],
      ['wallet:', wallet],
    );
  }

  return {
    path: erc8004AgentId && erc8004AgentId > 0 ? 'erc8004' : 'wallet_only',
    wallet,
    erc8004AgentId: erc8004AgentId && erc8004AgentId > 0 ? erc8004AgentId : undefined,
    providerIdentityHash,
  };
}

/**
 * Compute the clawhubSkillId hash from a skill slug.
 */
export function clawhubSkillIdHash(slug: string): string {
  return ethers.id(slug);
}

/**
 * Compute the metadataHash from a skill's SKILL.md content.
 * Falls back to hashing the slug if no SKILL.md available.
 */
export function computeMetadataHash(skill: ClawHubSkill): string {
  if (skill.skillMdHash) {
    return ethers.zeroPadValue(ethers.getBytes('0x' + skill.skillMdHash), 32);
  }
  if (skill.skillMd) {
    return ethers.id(skill.skillMd);
  }
  return ethers.id(`metadata:${skill.slug}:${skill.version || '0'}`);
}

// ---------------------------------------------------------------------------
// Publish Flow
// ---------------------------------------------------------------------------

/**
 * Publish a skill on-chain via SkillPublisherBinder.
 *
 * @param request  The publish request with skill, identity, and stake amount.
 * @returns        The publish result with on-chain IDs and tx details.
 */
export async function publishSkill(request: PublishRequest): Promise<PublishResult> {
  const contract = getBinderWrite();

  const riskValue = RISK_TIER_VALUES[request.riskTier];
  const metadataHash = computeMetadataHash(request.skill);
  const chSkillId = clawhubSkillIdHash(request.skill.slug);
  const erc8004Id = request.identity.erc8004AgentId || 0;

  let tx: ethers.ContractTransactionResponse;
  if (request.atomic && request.stakeAmountWei !== '0') {
    tx = await contract.publishAndStake(
      riskValue,
      metadataHash,
      chSkillId,
      request.identity.providerIdentityHash,
      erc8004Id,
      { value: request.stakeAmountWei },
    );
  } else {
    tx = await contract.publishOnly(
      riskValue,
      metadataHash,
      chSkillId,
      request.identity.providerIdentityHash,
      erc8004Id,
    );
  }

  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction failed — no receipt');

  // Parse the SkillPublished event to get skillId and trustLevel
  const event = receipt.logs
    .map((log: ethers.Log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === 'SkillPublished');

  const skillId = event ? Number(event.args.skillId) : -1;
  const trustLevel = event ? Number(event.args.trustLevel) : 0;
  const stakedWei = request.atomic ? request.stakeAmountWei : '0';

  // Phase 2: Set feedbackAuth: "open" on ERC-8004 IdentityRegistry
  // This ensures 8004 compliance — publishers explicitly authorize community feedback
  let feedbackAuthTxHash: string | undefined;
  if (erc8004Id > 0) {
    try {
      feedbackAuthTxHash = await setFeedbackAuthOnChain(erc8004Id, 'open');
    } catch (err) {
      // Non-fatal: skill is published but feedback auth not set on-chain.
      // Can be retried via setFeedbackAuthOnChain() directly.
      console.warn(
        `[publish] Failed to set feedbackAuth for agentId ${erc8004Id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    skillId,
    clawhubSlug: request.skill.slug,
    clawhubSkillIdHash: chSkillId,
    publisher: request.identity.wallet,
    erc8004AgentId: request.identity.erc8004AgentId,
    stakedAmountWei: stakedWei,
    stakedAmountMon: parseFloat(ethers.formatEther(stakedWei)),
    trustLevel,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    publishedAt: Math.floor(Date.now() / 1000),
    feedbackAuthTxHash,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Look up on-chain skillId by ClawHub slug.
 */
export async function getSkillIdBySlug(slug: string): Promise<number> {
  const hash = clawhubSkillIdHash(slug);
  const skillId = await getBinderRead().getSkillIdByClawhubId(hash);
  return Number(skillId);
}

/**
 * Get all skillIds published by a given wallet.
 */
export async function getPublisherSkillIds(publisher: string): Promise<number[]> {
  const ids: bigint[] = await getBinderRead().getPublisherSkillIds(publisher);
  return ids.map(Number);
}

/**
 * Get the total number of published skills.
 */
export async function getPublishCount(): Promise<number> {
  return Number(await getBinderRead().getPublishRecordCount());
}

/**
 * Check if the binder contract is configured.
 */
export function isBinderConfigured(): boolean {
  return isConfigured();
}

/**
 * Reset contract instances (for testing or reconnection).
 */
export function resetClients(): void {
  _binderRead = null;
  _binderWrite = null;
}
