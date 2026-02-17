/**
 * Trusted ClawMon — Scoring Types
 *
 * ERC-8004 aligned data models for feedback, scoring, and trust tiers.
 * These types mirror the on-chain structures defined in the ERC-8004
 * ReputationRegistry, adapted for on-chain consensus ordering via Monad.
 */

// ---------------------------------------------------------------------------
// Trust Tiers & Access Decisions
// ---------------------------------------------------------------------------

/** Credit-rating-style trust tiers (AAA = highest, C = lowest) */
export type TrustTier = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'CC' | 'C';

/** Access decisions derived from trust tier */
export type AccessDecision = 'full_access' | 'throttled' | 'denied';

// ---------------------------------------------------------------------------
// Tier Thresholds
// ---------------------------------------------------------------------------

/** Score → Tier mapping thresholds (score is 0-100 scale) */
export const TIER_THRESHOLDS: { min: number; tier: TrustTier }[] = [
  { min: 90, tier: 'AAA' },
  { min: 80, tier: 'AA' },
  { min: 70, tier: 'A' },
  { min: 60, tier: 'BBB' },
  { min: 50, tier: 'BB' },
  { min: 40, tier: 'B' },
  { min: 30, tier: 'CCC' },
  { min: 20, tier: 'CC' },
  { min: 0, tier: 'C' },
];

/** Map a 0-100 score to a TrustTier */
export function scoreToTier(score: number): TrustTier {
  const clamped = Math.max(0, Math.min(100, score));
  for (const { min, tier } of TIER_THRESHOLDS) {
    if (clamped >= min) return tier;
  }
  return 'C';
}

/** Map a TrustTier to an AccessDecision */
export function tierToAccessDecision(tier: TrustTier): AccessDecision {
  switch (tier) {
    case 'AAA':
    case 'AA':
    case 'A':
      return 'full_access';
    case 'BBB':
    case 'BB':
    case 'B':
      return 'throttled';
    case 'CCC':
    case 'CC':
    case 'C':
      return 'denied';
  }
}

// ---------------------------------------------------------------------------
// Feedback (ERC-8004 aligned)
// ---------------------------------------------------------------------------

/**
 * A single piece of feedback submitted for an agent/skill.
 * Mirrors the ERC-8004 ReputationRegistry `giveFeedback` parameters.
 */
export interface Feedback {
  /** Unique ID for this feedback entry */
  id: string;
  /** The agent/skill being rated (maps to ERC-8004 tokenId) */
  agentId: string;
  /** Address of the reviewer who submitted the feedback */
  clientAddress: string;
  /** Feedback score value (0-100 scale, int128 equivalent) */
  value: number;
  /** Decimal precision for value (0-18) */
  valueDecimals: number;
  /** Optional category tag */
  tag1?: string;
  /** Optional secondary tag */
  tag2?: string;
  /** Optional endpoint the feedback relates to */
  endpoint?: string;
  /** Optional URI for extended feedback data */
  feedbackURI?: string;
  /** Optional hash of feedback content */
  feedbackHash?: string;
  /** Unix timestamp (ms) when the feedback was submitted */
  timestamp: number;
  /** On-chain sequence number from the MessageLog contract */
  sequenceNumber?: number;
  /** Whether this feedback has been revoked by the submitter */
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Feedback Summary
// ---------------------------------------------------------------------------

/**
 * Aggregated feedback summary for an agent/skill.
 * Mirrors the ERC-8004 ReputationRegistry `getSummary` return.
 */
export interface FeedbackSummary {
  /** The agent/skill this summary describes */
  agentId: string;
  /** Total number of (non-revoked) feedback entries */
  feedbackCount: number;
  /** Computed summary score (0-100 scale) */
  summaryValue: number;
  /** Decimal precision for summaryValue */
  summaryValueDecimals: number;
  /** Trust tier derived from summaryValue */
  tier: TrustTier;
  /** Access decision derived from tier */
  accessDecision: AccessDecision;
}

// ---------------------------------------------------------------------------
// On-Chain Message Types
// ---------------------------------------------------------------------------

/** Message types submitted to the MessageLog contract */
export type MessageType =
  | 'register'
  | 'feedback'
  | 'revoke_feedback'
  | 'update_auth'
  | 'delist';

/** @deprecated Use MessageType instead */
export type HCSMessageType = MessageType;

/** Base shape for all on-chain messages */
export interface OnChainMessage {
  type: MessageType;
  timestamp?: number;
}

/** @deprecated Use OnChainMessage instead */
export type HCSMessage = OnChainMessage;

/** Identity registration message */
export interface RegisterMessage extends OnChainMessage {
  type: 'register';
  agentId: string;
  name: string;
  publisher: string;
  category: string;
  description?: string;
  feedbackAuthPolicy: 'open' | 'selective' | 'closed';
}

/** Feedback submission message */
export interface FeedbackMessage extends OnChainMessage {
  type: 'feedback';
  agentId: string;
  clientAddress: string;
  value: number;
  valueDecimals: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
}

/** Feedback revocation message */
export interface RevokeFeedbackMessage extends OnChainMessage {
  type: 'revoke_feedback';
  feedbackId: string;
  agentId: string;
  clientAddress: string;
}

/** Auth policy update message */
export interface UpdateAuthMessage extends OnChainMessage {
  type: 'update_auth';
  agentId: string;
  feedbackAuthPolicy: 'open' | 'selective' | 'closed';
}

// ---------------------------------------------------------------------------
// Verified Usage Credibility Tiers
// ---------------------------------------------------------------------------

/**
 * Credibility tiers for feedback weighting based on x402 payment history
 * and staking status of the reviewer.
 *
 *   - paid_and_staked: Reviewer has x402 payment receipts AND has staked (5-10x weight)
 *   - paid_unstaked:   Reviewer has x402 payment receipts but has NOT staked (1-2x weight)
 *   - unpaid_unstaked: Reviewer has NO payment receipts and is NOT staked (0.1x weight)
 */
export type CredibilityTier = 'paid_and_staked' | 'paid_unstaked' | 'unpaid_unstaked';

/** Weight range per credibility tier */
export interface CredibilityWeight {
  tier: CredibilityTier;
  /** Minimum weight multiplier */
  minWeight: number;
  /** Maximum weight multiplier */
  maxWeight: number;
  /** Label for display */
  label: string;
  /** Whether to show Verified User badge */
  verifiedBadge: boolean;
}

/** Default credibility weight configuration */
export const CREDIBILITY_WEIGHTS: Record<CredibilityTier, CredibilityWeight> = {
  paid_and_staked: {
    tier: 'paid_and_staked',
    minWeight: 5.0,
    maxWeight: 10.0,
    label: 'Verified User — Paid & Staked',
    verifiedBadge: true,
  },
  paid_unstaked: {
    tier: 'paid_unstaked',
    minWeight: 1.0,
    maxWeight: 2.0,
    label: 'Verified User — Paid',
    verifiedBadge: true,
  },
  unpaid_unstaked: {
    tier: 'unpaid_unstaked',
    minWeight: 0.1,
    maxWeight: 0.1,
    label: 'Unverified',
    verifiedBadge: false,
  },
};

/** Feedback entry annotated with credibility information */
export interface AnnotatedFeedback extends Feedback {
  credibilityTier: CredibilityTier;
  credibilityWeight: number;
  verifiedUser: boolean;
  paymentCount: number;
  reviewerStaked: boolean;
}

// ---------------------------------------------------------------------------
// Scoring Configuration
// ---------------------------------------------------------------------------

/** Minimum feedback count required for listing */
export const MIN_FEEDBACK_COUNT = 5;

/** Default empty summary for agents with no feedback */
export function emptySummary(agentId: string): FeedbackSummary {
  return {
    agentId,
    feedbackCount: 0,
    summaryValue: 0,
    summaryValueDecimals: 0,
    tier: 'C',
    accessDecision: 'denied',
  };
}
