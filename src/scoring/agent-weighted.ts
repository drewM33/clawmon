/**
 * Trusted ClawMon — Agent-Weighted Scoring (Phase 5)
 *
 * Weights agent-to-agent feedback differently based on the reviewer's:
 *   - Reputation tier (whale=5x, lobster=2x, claw=1x)
 *   - Published skill + stake status (3x bonus)
 *   - Unknown/new agent discount (0.5x)
 *
 * Integrates with the existing scoring engine by providing per-feedback
 * weight multipliers that the hardened engine can apply.
 */

import type { Feedback, FeedbackSummary } from './types.js';
import { scoreToTier, tierToAccessDecision, emptySummary } from './types.js';
import { computeWeightedAverage } from './engine.js';
import { getUserReputation } from './reputation-tiers.js';
import { isAgentReview, extractReviewerAgentId } from '../feedback/agent-feedback.js';
import type { AgentReviewWeightConfig } from '../feedback/types.js';
import { DEFAULT_AGENT_REVIEW_WEIGHTS } from '../feedback/types.js';

// ---------------------------------------------------------------------------
// Weight Computation
// ---------------------------------------------------------------------------

/**
 * Compute the weight multiplier for an agent reviewer based on their
 * reputation tier and staking/publishing status.
 *
 * @param reviewerAddress - Wallet address of the reviewing agent
 * @param config - Weight configuration (defaults to standard weights)
 * @returns weight multiplier and tier label
 */
export function computeAgentReviewWeight(
  reviewerAddress: string,
  config: AgentReviewWeightConfig = DEFAULT_AGENT_REVIEW_WEIGHTS,
): { weight: number; tier: string } {
  const reputation = getUserReputation(reviewerAddress);

  // Unknown / no reputation tracked
  if (!reputation) {
    return { weight: config.unknownAgentWeight, tier: 'unknown' };
  }

  // Whale tier → highest weight
  if (reputation.tier === 'whale') {
    return { weight: config.whaleTierWeight, tier: 'whale' };
  }

  // Published skill + staked → bonus weight (even if not whale)
  if (reputation.hasPublishedSkill) {
    return { weight: config.publishedAndStakedWeight, tier: `${reputation.tier}+publisher` };
  }

  // Lobster tier
  if (reputation.tier === 'lobster') {
    return { weight: config.lobsterTierWeight, tier: 'lobster' };
  }

  // Claw tier (base)
  return { weight: 1.0, tier: 'claw' };
}

// ---------------------------------------------------------------------------
// Agent-Weighted Summary
// ---------------------------------------------------------------------------

/**
 * Compute a feedback summary that applies agent-review weighting.
 *
 * Human feedback uses weight 1.0 (standard).
 * Agent feedback (tag1="agent-review") uses reputation-based weights.
 *
 * @param feedback - All feedback entries for a skill
 * @param config - Optional weight config override
 * @returns Weighted summary including both human and agent feedback
 */
export function computeAgentWeightedSummary(
  feedback: Feedback[],
  config: AgentReviewWeightConfig = DEFAULT_AGENT_REVIEW_WEIGHTS,
): FeedbackSummary {
  if (feedback.length === 0) {
    return emptySummary('unknown');
  }

  const agentId = feedback[0].agentId;
  const active = feedback.filter((f) => !f.revoked);

  if (active.length === 0) {
    return emptySummary(agentId);
  }

  // Build weight map
  const weights = new Map<string, number>();

  for (const f of active) {
    if (isAgentReview(f.tag1)) {
      // Agent feedback — weight by reviewer reputation
      const { weight } = computeAgentReviewWeight(f.clientAddress, config);
      weights.set(f.id, weight);
    } else {
      // Human feedback — standard weight
      weights.set(f.id, 1.0);
    }
  }

  const avg = computeWeightedAverage(active, weights);
  const tier = scoreToTier(avg);
  const accessDecision = tierToAccessDecision(tier);

  return {
    agentId,
    feedbackCount: active.length,
    summaryValue: Math.round(avg * 100) / 100,
    summaryValueDecimals: 2,
    tier,
    accessDecision,
  };
}

// ---------------------------------------------------------------------------
// Agent Feedback Statistics
// ---------------------------------------------------------------------------

export interface AgentFeedbackStats {
  agentId: string;
  totalFeedback: number;
  humanFeedbackCount: number;
  agentFeedbackCount: number;
  humanAvg: number;
  agentAvg: number;
  agentWeightedAvg: number;
  combinedWeightedAvg: number;
  uniqueAgentReviewers: number;
}

/**
 * Get detailed statistics breaking down human vs agent feedback.
 */
export function getAgentFeedbackStats(
  feedback: Feedback[],
  config: AgentReviewWeightConfig = DEFAULT_AGENT_REVIEW_WEIGHTS,
): AgentFeedbackStats {
  const agentId = feedback[0]?.agentId ?? 'unknown';
  const active = feedback.filter((f) => !f.revoked);

  const humanFeedback = active.filter((f) => !isAgentReview(f.tag1));
  const agentFeedback = active.filter((f) => isAgentReview(f.tag1));

  // Simple averages
  const humanAvg = humanFeedback.length > 0
    ? humanFeedback.reduce((s, f) => s + f.value, 0) / humanFeedback.length
    : 0;
  const agentAvg = agentFeedback.length > 0
    ? agentFeedback.reduce((s, f) => s + f.value, 0) / agentFeedback.length
    : 0;

  // Weighted agent average
  const agentWeights = new Map<string, number>();
  for (const f of agentFeedback) {
    const { weight } = computeAgentReviewWeight(f.clientAddress, config);
    agentWeights.set(f.id, weight);
  }
  const agentWeightedAvg = agentFeedback.length > 0
    ? computeWeightedAverage(agentFeedback, agentWeights)
    : 0;

  // Combined weighted (full summary)
  const combined = computeAgentWeightedSummary(feedback, config);

  // Unique agent reviewers
  const reviewerIds = new Set<number>();
  for (const f of agentFeedback) {
    const rid = extractReviewerAgentId(f.tag2);
    if (rid >= 0) reviewerIds.add(rid);
  }

  return {
    agentId,
    totalFeedback: active.length,
    humanFeedbackCount: humanFeedback.length,
    agentFeedbackCount: agentFeedback.length,
    humanAvg: Math.round(humanAvg * 100) / 100,
    agentAvg: Math.round(agentAvg * 100) / 100,
    agentWeightedAvg: Math.round(agentWeightedAvg * 100) / 100,
    combinedWeightedAvg: combined.summaryValue,
    uniqueAgentReviewers: reviewerIds.size,
  };
}
