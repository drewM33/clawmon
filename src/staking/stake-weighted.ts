/**
 * Trusted ClawMon — Stake-Weighted Reputation Scoring (Phase 4)
 *
 * Integrates staking economics into the scoring engine:
 *
 *   1. Reviewer stake weighting:
 *      Reviews from higher-staked reviewers carry more weight.
 *      Weight = min(multiplierCap, 1 + reviewerStake / baselineStake)
 *
 *   2. Publisher stake trust boost:
 *      Agents with higher total stake get a trust multiplier on their score.
 *      This reflects skin-in-the-game: more stake → more to lose → more trustworthy.
 *
 *   3. Slash penalty:
 *      Agents with recent slashing history get a score penalty.
 *
 * This module wraps the hardened scoring engine, adding stake-weighted
 * adjustments on top of the existing mitigations.
 */

import type { Feedback, FeedbackSummary } from '../scoring/types.js';
import { scoreToTier, tierToAccessDecision, emptySummary } from '../scoring/types.js';
import { computeHardenedSummary } from '../scoring/hardened.js';
import type { MitigationConfig } from '../mitigations/types.js';
import { DEFAULT_MITIGATION_CONFIG } from '../mitigations/types.js';
import type { AgentStakeInfo, SlashRecord } from './types.js';
import { STAKING_CONSTANTS } from './types.js';
import { getQualityBoost } from '../scoring/quality.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface StakeWeightedConfig {
  enabled: boolean;
  /** Baseline stake (ETH) for reviewer weight = 1.0 */
  baselineStake: number;
  /** Maximum weight multiplier for high-stake reviewers */
  multiplierCap: number;
  /** Publisher stake trust boost: score += boost * min(1, totalStake / targetStake) */
  publisherBoostMax: number;
  /** Target publisher stake (ETH) for full boost */
  publisherTargetStake: number;
  /** Slash penalty: recent slash reduces score by this factor per slash event */
  slashPenaltyPerEvent: number;
  /** Slash recency window (ms): only slashes within this window apply penalty */
  slashRecencyWindowMs: number;
  /** Tenure boost: max score points for long-tenured, incident-free staking */
  tenureBoostMax: number;
  /** Target tenure in days for full tenure boost */
  tenureTargetDays: number;
}

export const DEFAULT_STAKE_WEIGHTED_CONFIG: StakeWeightedConfig = {
  enabled: true,
  baselineStake: 0.05,       // 0.05 MON baseline
  multiplierCap: 5.0,        // max 5x weight for high-stake reviewers
  publisherBoostMax: 10,     // up to +10 score points for well-staked agents
  publisherTargetStake: 0.25, // full boost at 0.25 MON total stake
  slashPenaltyPerEvent: 15,  // -15 score points per recent slash
  slashRecencyWindowMs: 30 * 24 * 60 * 60 * 1000, // 30-day window
  tenureBoostMax: 8,         // up to +8 score points for long tenure
  tenureTargetDays: 180,     // 6 months for full tenure boost
};

// ---------------------------------------------------------------------------
// Stake → Trust Multiplier
// ---------------------------------------------------------------------------

/**
 * Convert a stake amount (ETH) to a trust multiplier for the agent's score.
 * Range: 0.0 (no stake) to 1.0 (at or above target stake).
 */
export function stakeToTrustMultiplier(
  totalStakeEth: number,
  targetStake: number = DEFAULT_STAKE_WEIGHTED_CONFIG.publisherTargetStake,
): number {
  if (totalStakeEth <= 0) return 0;
  return Math.min(1.0, totalStakeEth / targetStake);
}

// ---------------------------------------------------------------------------
// Stake-Weighted Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a stake-weighted feedback summary.
 *
 * Process:
 *   1. Run hardened scoring (all existing mitigations)
 *   2. Apply reviewer stake weighting (higher-staked reviewers get more weight)
 *   3. Apply publisher stake boost (+score for well-staked agents)
 *   4. Apply tenure boost (+score for long, incident-free staking)
 *   5. Apply slash penalty (-score for recently slashed agents)
 *
 * @param feedback - Feedback for a single agent
 * @param agentStake - The agent's staking state (null = unstaked)
 * @param slashHistory - Recent slash records for this agent
 * @param reviewerStakes - Map of reviewer address → their total stake (ETH)
 * @param mitigationConfig - Mitigation settings for the hardened engine
 * @param stakeConfig - Stake-weighted configuration
 * @param allFeedback - Full feedback corpus
 */
export function computeStakeWeightedSummary(
  feedback: Feedback[],
  agentStake: AgentStakeInfo | null,
  slashHistory: SlashRecord[] = [],
  reviewerStakes: Map<string, number> = new Map(),
  mitigationConfig: MitigationConfig = DEFAULT_MITIGATION_CONFIG,
  stakeConfig: StakeWeightedConfig = DEFAULT_STAKE_WEIGHTED_CONFIG,
  allFeedback?: Feedback[],
): FeedbackSummary {
  if (feedback.length === 0) {
    return emptySummary(feedback[0]?.agentId ?? 'unknown');
  }

  if (!stakeConfig.enabled) {
    return computeHardenedSummary(feedback, mitigationConfig, allFeedback);
  }

  const agentId = feedback[0].agentId;

  // Step 1: Get hardened base score (includes graph, velocity, decay, etc.)
  const hardenedSummary = computeHardenedSummary(feedback, mitigationConfig, allFeedback);
  let adjustedScore = hardenedSummary.summaryValue;

  // Step 2: Reviewer stake weighting
  // If we have reviewer stake info, compute a stake-weighted average
  // that shifts the score toward higher-staked reviewer opinions.
  if (reviewerStakes.size > 0) {
    const active = feedback.filter(f => !f.revoked);
    let weightedSum = 0;
    let totalWeight = 0;

    for (const f of active) {
      const reviewerStake = reviewerStakes.get(f.clientAddress) ?? 0;
      const weight = Math.min(
        stakeConfig.multiplierCap,
        1 + reviewerStake / stakeConfig.baselineStake,
      );
      weightedSum += f.value * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      const stakeWeightedAvg = weightedSum / totalWeight;
      // Blend: 60% hardened score + 40% stake-weighted average
      adjustedScore = adjustedScore * 0.6 + stakeWeightedAvg * 0.4;
    }
  }

  // Step 3: Publisher stake trust boost
  if (agentStake && agentStake.active) {
    const trustMultiplier = stakeToTrustMultiplier(
      agentStake.totalStakeEth,
      stakeConfig.publisherTargetStake,
    );
    const boost = stakeConfig.publisherBoostMax * trustMultiplier;
    adjustedScore += boost;
  }

  // Step 4: Tenure boost — reward incident-free longevity
  if (agentStake && agentStake.active && agentStake.stakedAt > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    // Clean tenure starts from the later of stakedAt or lastSlashTime
    const tenureStart = agentStake.lastSlashTime > agentStake.stakedAt
      ? agentStake.lastSlashTime
      : agentStake.stakedAt;
    const tenureDays = (nowSec - tenureStart) / (24 * 60 * 60);
    const tenureFraction = Math.min(1.0, tenureDays / stakeConfig.tenureTargetDays);
    const tenureBoost = stakeConfig.tenureBoostMax * tenureFraction;
    adjustedScore += tenureBoost;
  }

  // Step 5: Quality documentation boost
  const qualityBoost = getQualityBoost(agentId);
  if (qualityBoost > 0) {
    adjustedScore += qualityBoost;
  }

  // Step 6: Slash penalty
  if (slashHistory.length > 0) {
    const now = Date.now();
    const recentSlashes = slashHistory.filter(
      s => (now - s.timestamp * 1000) < stakeConfig.slashRecencyWindowMs,
    );
    const penalty = recentSlashes.length * stakeConfig.slashPenaltyPerEvent;
    adjustedScore -= penalty;
  }

  // Clamp to 0-100
  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  const tier = scoreToTier(adjustedScore);
  const accessDecision = tierToAccessDecision(tier);

  return {
    agentId,
    feedbackCount: hardenedSummary.feedbackCount,
    summaryValue: Math.round(adjustedScore * 100) / 100,
    summaryValueDecimals: 2,
    tier,
    accessDecision,
  };
}

// ---------------------------------------------------------------------------
// TEE-Integrated Scoring (Phase 8)
// ---------------------------------------------------------------------------

/**
 * Compute a stake-weighted score that also factors in TEE attestation status.
 *
 * TEE integration:
 *   - TEE-verified agents (Tier 3): +tier3ScoreBoost to their score
 *   - TEE trust weight is applied as a multiplier to the final score blend
 *   - Agents with failed TEE verification get a mild penalty (0.8x)
 *
 * This gives TEE-verified feedback *higher trust weight* than unverified,
 * as specified in the Phase 8 requirements.
 *
 * @param teeTrustWeight - Multiplier from TEE verification (1.0 = neutral, 1.5 = Tier 3 boost, 0.8 = failed)
 * @param tier3Active - Whether the agent has active Tier 3 status
 * @param tier3ScoreBoost - Score points to add for Tier 3 agents (default 5)
 */
export function computeTEEWeightedSummary(
  feedback: Feedback[],
  agentStake: AgentStakeInfo | null,
  slashHistory: SlashRecord[] = [],
  reviewerStakes: Map<string, number> = new Map(),
  mitigationConfig: MitigationConfig = DEFAULT_MITIGATION_CONFIG,
  stakeConfig: StakeWeightedConfig = DEFAULT_STAKE_WEIGHTED_CONFIG,
  allFeedback?: Feedback[],
  teeTrustWeight: number = 1.0,
  tier3Active: boolean = false,
  tier3ScoreBoost: number = 5,
): FeedbackSummary {
  // Get the stake-weighted base score
  const stakeWeighted = computeStakeWeightedSummary(
    feedback,
    agentStake,
    slashHistory,
    reviewerStakes,
    mitigationConfig,
    stakeConfig,
    allFeedback,
  );

  if (feedback.length === 0) return stakeWeighted;

  let adjustedScore = stakeWeighted.summaryValue;

  // Apply TEE trust weight as a score modifier
  // Weight > 1.0 boosts score, weight < 1.0 penalizes
  if (teeTrustWeight !== 1.0) {
    const delta = adjustedScore * (teeTrustWeight - 1.0);
    adjustedScore += delta * 0.3; // Dampen the effect to prevent extreme swings
  }

  // Apply Tier 3 score boost for fully verified agents
  if (tier3Active) {
    adjustedScore += tier3ScoreBoost;
  }

  // Clamp to 0-100
  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  const tier = scoreToTier(adjustedScore);
  const accessDecision = tierToAccessDecision(tier);

  return {
    agentId: stakeWeighted.agentId,
    feedbackCount: stakeWeighted.feedbackCount,
    summaryValue: Math.round(adjustedScore * 100) / 100,
    summaryValueDecimals: 2,
    tier,
    accessDecision,
  };
}

/**
 * Compute stake-weighted summaries for all agents.
 */
export function computeAllStakeWeightedSummaries(
  allFeedback: Feedback[],
  agentStakes: Map<string, AgentStakeInfo | null>,
  agentSlashHistories: Map<string, SlashRecord[]>,
  reviewerStakes: Map<string, number> = new Map(),
  mitigationConfig: MitigationConfig = DEFAULT_MITIGATION_CONFIG,
  stakeConfig: StakeWeightedConfig = DEFAULT_STAKE_WEIGHTED_CONFIG,
): Map<string, FeedbackSummary> {
  const byAgent = new Map<string, Feedback[]>();
  for (const f of allFeedback) {
    if (!byAgent.has(f.agentId)) byAgent.set(f.agentId, []);
    byAgent.get(f.agentId)!.push(f);
  }

  const summaries = new Map<string, FeedbackSummary>();
  for (const [agentId, agentFeedback] of byAgent) {
    summaries.set(
      agentId,
      computeStakeWeightedSummary(
        agentFeedback,
        agentStakes.get(agentId) ?? null,
        agentSlashHistories.get(agentId) ?? [],
        reviewerStakes,
        mitigationConfig,
        stakeConfig,
        allFeedback,
      ),
    );
  }

  return summaries;
}
