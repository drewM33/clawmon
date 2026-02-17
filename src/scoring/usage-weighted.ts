/**
 * Trusted ClawMon — Usage-Weighted Scoring Engine
 *
 * Adds verified usage feedback weighting to the scoring pipeline.
 * Cross-references each reviewer's address against x402 payment records
 * and staking state to assign credibility tiers:
 *
 *   - paid_and_staked:  5-10x weight (reviewer paid for the skill AND has stake)
 *   - paid_unstaked:    1-2x weight  (reviewer paid but has no stake)
 *   - unpaid_unstaked:  0.1x weight  (no payment history, no stake)
 *
 * Feedback from reviewers with payment receipts earns a "Verified User" badge.
 */

import type { Feedback, FeedbackSummary, AnnotatedFeedback, CredibilityTier } from './types.js';
import { scoreToTier, tierToAccessDecision, emptySummary, CREDIBILITY_WEIGHTS } from './types.js';
import { computeWeightedAverage } from './engine.js';
import { computeHardenedSummary } from './hardened.js';
import type { MitigationConfig } from '../mitigations/types.js';
import { DEFAULT_MITIGATION_CONFIG } from '../mitigations/types.js';
import { getCallerReceiptsForSkill } from '../payments/x402.js';

// ---------------------------------------------------------------------------
// Credibility Tier Determination
// ---------------------------------------------------------------------------

/**
 * Determine the credibility tier for a reviewer on a specific skill.
 *
 * @param clientAddress - The reviewer's address
 * @param agentId - The skill being reviewed
 * @param stakedAddresses - Set of addresses that have stake in the protocol
 * @returns The credibility tier and computed weight
 */
export function determineCredibilityTier(
  clientAddress: string,
  agentId: string,
  stakedAddresses: Set<string> = new Set(),
): { tier: CredibilityTier; weight: number; paymentCount: number; isStaked: boolean } {
  // Check x402 payment history for this skill
  const receipts = getCallerReceiptsForSkill(agentId, clientAddress);
  const hasPaid = receipts.length > 0;

  // Check if reviewer has stake
  const isStaked = stakedAddresses.has(clientAddress);

  if (hasPaid && isStaked) {
    // Paid + Staked: 5-10x weight (scaled by payment count)
    const config = CREDIBILITY_WEIGHTS.paid_and_staked;
    const paymentFactor = Math.min(1.0, receipts.length / 10);
    const weight = config.minWeight + (config.maxWeight - config.minWeight) * paymentFactor;
    return { tier: 'paid_and_staked', weight, paymentCount: receipts.length, isStaked };
  }

  if (hasPaid) {
    // Paid but Unstaked: 1-2x weight (scaled by payment count)
    const config = CREDIBILITY_WEIGHTS.paid_unstaked;
    const paymentFactor = Math.min(1.0, receipts.length / 10);
    const weight = config.minWeight + (config.maxWeight - config.minWeight) * paymentFactor;
    return { tier: 'paid_unstaked', weight, paymentCount: receipts.length, isStaked };
  }

  // Unpaid + Unstaked: 0.1x weight
  return {
    tier: 'unpaid_unstaked',
    weight: CREDIBILITY_WEIGHTS.unpaid_unstaked.minWeight,
    paymentCount: 0,
    isStaked,
  };
}

// ---------------------------------------------------------------------------
// Annotate Feedback with Credibility
// ---------------------------------------------------------------------------

/**
 * Annotate feedback entries with credibility tier information.
 *
 * @param feedback - Feedback entries for a single agent
 * @param stakedAddresses - Set of addresses with active stakes
 * @returns Annotated feedback with credibility tiers and weights
 */
export function annotateFeedbackCredibility(
  feedback: Feedback[],
  stakedAddresses: Set<string> = new Set(),
): AnnotatedFeedback[] {
  return feedback.map(f => {
    const { tier, weight, paymentCount, isStaked } = determineCredibilityTier(
      f.clientAddress,
      f.agentId,
      stakedAddresses,
    );

    return {
      ...f,
      credibilityTier: tier,
      credibilityWeight: weight,
      verifiedUser: CREDIBILITY_WEIGHTS[tier].verifiedBadge,
      paymentCount,
      reviewerStaked: isStaked,
    };
  });
}

// ---------------------------------------------------------------------------
// Usage-Weighted Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a usage-weighted feedback summary.
 *
 * Process:
 *   1. Run hardened scoring (all existing mitigations)
 *   2. Annotate each feedback with credibility tier
 *   3. Compute usage-weighted average using credibility weights
 *   4. Blend hardened + usage-weighted scores (50/50)
 *   5. Map to trust tier and access decision
 *
 * @param feedback - Feedback entries for a single agent
 * @param stakedAddresses - Set of addresses with active stakes
 * @param mitigationConfig - Mitigation settings for the hardened engine
 * @param allFeedback - Full feedback corpus
 */
export function computeUsageWeightedSummary(
  feedback: Feedback[],
  stakedAddresses: Set<string> = new Set(),
  mitigationConfig: MitigationConfig = DEFAULT_MITIGATION_CONFIG,
  allFeedback?: Feedback[],
): { summary: FeedbackSummary; annotatedFeedback: AnnotatedFeedback[]; tierBreakdown: UsageTierBreakdown } {
  if (feedback.length === 0) {
    return {
      summary: emptySummary(feedback[0]?.agentId ?? 'unknown'),
      annotatedFeedback: [],
      tierBreakdown: emptyTierBreakdown(),
    };
  }

  const agentId = feedback[0].agentId;
  const active = feedback.filter(f => !f.revoked);

  if (active.length === 0) {
    return {
      summary: emptySummary(agentId),
      annotatedFeedback: [],
      tierBreakdown: emptyTierBreakdown(),
    };
  }

  // Step 1: Get hardened base score
  const hardenedSummary = computeHardenedSummary(feedback, mitigationConfig, allFeedback);

  // Step 2: Annotate feedback with credibility
  const annotated = annotateFeedbackCredibility(active, stakedAddresses);

  // Step 3: Compute usage-weighted average
  const weights = new Map<string, number>();
  for (const af of annotated) {
    weights.set(af.id, af.credibilityWeight);
  }
  const usageWeightedAvg = computeWeightedAverage(active, weights);

  // Step 4: Blend hardened + usage-weighted (50/50)
  const blended = hardenedSummary.summaryValue * 0.5 + usageWeightedAvg * 0.5;

  // Clamp to 0-100
  const finalScore = Math.max(0, Math.min(100, blended));

  const tier = scoreToTier(finalScore);
  const accessDecision = tierToAccessDecision(tier);

  // Compute tier breakdown
  const tierBreakdown = computeTierBreakdown(annotated);

  return {
    summary: {
      agentId,
      feedbackCount: active.length,
      summaryValue: Math.round(finalScore * 100) / 100,
      summaryValueDecimals: 2,
      tier,
      accessDecision,
    },
    annotatedFeedback: annotated,
    tierBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Tier Breakdown (for scoring reports)
// ---------------------------------------------------------------------------

/** Breakdown of feedback by credibility tier */
export interface UsageTierBreakdown {
  paidAndStaked: { count: number; avgWeight: number; avgScore: number };
  paidUnstaked: { count: number; avgWeight: number; avgScore: number };
  unpaidUnstaked: { count: number; avgWeight: number; avgScore: number };
  totalVerified: number;
  totalUnverified: number;
  weightDifferential: number;
}

function emptyTierBreakdown(): UsageTierBreakdown {
  return {
    paidAndStaked: { count: 0, avgWeight: 0, avgScore: 0 },
    paidUnstaked: { count: 0, avgWeight: 0, avgScore: 0 },
    unpaidUnstaked: { count: 0, avgWeight: 0, avgScore: 0 },
    totalVerified: 0,
    totalUnverified: 0,
    weightDifferential: 0,
  };
}

function computeTierBreakdown(annotated: AnnotatedFeedback[]): UsageTierBreakdown {
  const groups: Record<CredibilityTier, AnnotatedFeedback[]> = {
    paid_and_staked: [],
    paid_unstaked: [],
    unpaid_unstaked: [],
  };

  for (const af of annotated) {
    groups[af.credibilityTier].push(af);
  }

  const avgWeight = (items: AnnotatedFeedback[]) =>
    items.length === 0 ? 0 : items.reduce((s, i) => s + i.credibilityWeight, 0) / items.length;
  const avgScore = (items: AnnotatedFeedback[]) =>
    items.length === 0 ? 0 : items.reduce((s, i) => s + i.value, 0) / items.length;

  const paidAndStaked = {
    count: groups.paid_and_staked.length,
    avgWeight: Math.round(avgWeight(groups.paid_and_staked) * 100) / 100,
    avgScore: Math.round(avgScore(groups.paid_and_staked) * 100) / 100,
  };
  const paidUnstaked = {
    count: groups.paid_unstaked.length,
    avgWeight: Math.round(avgWeight(groups.paid_unstaked) * 100) / 100,
    avgScore: Math.round(avgScore(groups.paid_unstaked) * 100) / 100,
  };
  const unpaidUnstaked = {
    count: groups.unpaid_unstaked.length,
    avgWeight: Math.round(avgWeight(groups.unpaid_unstaked) * 100) / 100,
    avgScore: Math.round(avgScore(groups.unpaid_unstaked) * 100) / 100,
  };

  const totalVerified = paidAndStaked.count + paidUnstaked.count;
  const totalUnverified = unpaidUnstaked.count;

  // Weight differential: ratio of highest avg weight to lowest
  const maxAvg = Math.max(paidAndStaked.avgWeight, paidUnstaked.avgWeight, unpaidUnstaked.avgWeight);
  const minAvg = Math.min(
    ...[paidAndStaked, paidUnstaked, unpaidUnstaked]
      .filter(g => g.count > 0)
      .map(g => g.avgWeight),
  ) || 0.1;
  const weightDifferential = minAvg > 0 ? Math.round((maxAvg / minAvg) * 100) / 100 : 0;

  return {
    paidAndStaked,
    paidUnstaked,
    unpaidUnstaked,
    totalVerified,
    totalUnverified,
    weightDifferential,
  };
}
