/**
 * Trusted ClawMon — Publishing Types (Phase 1)
 *
 * Data models for the skill publish + bind + stake flow.
 * Used by the publisher-binder orchestrator, server API, and dashboard.
 */

import type { ClawHubSkill } from '../clawhub/types.js';

// ---------------------------------------------------------------------------
// Identity Binding
// ---------------------------------------------------------------------------

/**
 * How the publisher's identity is resolved.
 *
 *   wallet_only  — Publisher identified by wallet address (from SKILL.md frontmatter
 *                  or tx sender). ERC-8004 identity can be lazy-registered later.
 *   erc8004      — Publisher already has an ERC-8004 agentId on the IdentityRegistry.
 *                  The providerIdentityHash binds the skill to that identity.
 */
export type IdentityPath = 'wallet_only' | 'erc8004';

export interface IdentityBinding {
  path: IdentityPath;
  /** Publisher wallet address (always present) */
  wallet: string;
  /** ERC-8004 agentId if path === 'erc8004', undefined otherwise */
  erc8004AgentId?: number;
  /** keccak256 hash used as providerIdentityHash in SkillRegistry */
  providerIdentityHash: string;
}

// ---------------------------------------------------------------------------
// Publish Request
// ---------------------------------------------------------------------------

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PublishRequest {
  /** The ClawHub skill to publish on-chain */
  skill: ClawHubSkill;
  /** Risk tier classification */
  riskTier: RiskTier;
  /** How the publisher is identified */
  identity: IdentityBinding;
  /** MON amount to stake (in wei as string for BigInt safety) */
  stakeAmountWei: string;
  /** Whether to use the atomic publishAndStake (true) or publishOnly (false) */
  atomic: boolean;
}

// ---------------------------------------------------------------------------
// Publish Result
// ---------------------------------------------------------------------------

export interface PublishResult {
  /** On-chain skill ID from SkillRegistry */
  skillId: number;
  /** The ClawHub slug used */
  clawhubSlug: string;
  /** keccak256 of the slug (clawhubSkillId on-chain) */
  clawhubSkillIdHash: string;
  /** Publisher wallet */
  publisher: string;
  /** ERC-8004 agentId if bound, undefined otherwise */
  erc8004AgentId?: number;
  /** Amount staked in wei */
  stakedAmountWei: string;
  /** Amount staked in MON (display) */
  stakedAmountMon: number;
  /** Trust level after staking (0-3) */
  trustLevel: number;
  /** Transaction hash */
  txHash: string;
  /** Block number */
  blockNumber: number;
  /** Timestamp */
  publishedAt: number;
}

// ---------------------------------------------------------------------------
// Publish Record (mirrors on-chain PublishRecord struct)
// ---------------------------------------------------------------------------

export interface PublishRecord {
  skillId: number;
  publisher: string;
  erc8004AgentId: number;
  clawhubSkillId: string;
  stakedAmount: string;
  publishedAt: number;
}

// ---------------------------------------------------------------------------
// API Response
// ---------------------------------------------------------------------------

export interface PublishResponse {
  success: boolean;
  result?: PublishResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Risk Tier Mapping
// ---------------------------------------------------------------------------

export const RISK_TIER_VALUES: Record<RiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};
