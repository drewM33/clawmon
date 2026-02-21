/**
 * Trusted ClawMon — Conviction Scoring Engine
 *
 * Rewards users who identify good skills early. If you upvote a skill
 * when its score is low and it later rises, you earn a conviction bonus
 * on your yield. This creates a discovery incentive — the earlier you
 * stake conviction on a skill that turns out well, the more you earn.
 *
 * Conviction multiplier formula:
 *   improvement = max(0, currentScore - scoreAtUpvote)
 *   timeFactor  = min(1.0, daysSinceUpvote / 30)
 *   conviction  = 1.0 + (improvement / 100) * timeFactor * maxBonus
 *
 * Where maxBonus is 1.0 (i.e. up to 2x yield for perfect conviction).
 */

import {
  getUserReputation,
  getAllUserReputations,
} from './reputation-tiers.js';
import type { ReputationTier } from './types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ConvictionConfig {
  maxBonus: number;
  maturityDays: number;
  tierBonuses: Record<ReputationTier, number>;
}

export const DEFAULT_CONVICTION_CONFIG: ConvictionConfig = {
  maxBonus: 1.0,        // up to 2x yield (1.0 + 1.0)
  maturityDays: 30,     // full time factor after 30 days
  tierBonuses: {
    claw: 0,            // no tier bonus
    lobster: 0.1,       // +10% yield bonus for lobster tier
    whale: 0.25,        // +25% yield bonus for whale tier
  },
};

// ---------------------------------------------------------------------------
// Conviction Calculation
// ---------------------------------------------------------------------------

export interface ConvictionScore {
  address: string;
  agentId: string;
  scoreAtUpvote: number;
  currentScore: number;
  improvement: number;
  daysSinceUpvote: number;
  timeFactor: number;
  convictionMultiplier: number;
}

/**
 * Calculate conviction scores for a single user across all their upvoted skills.
 */
export function computeUserConviction(
  address: string,
  currentScores: Map<string, number>,
  config: ConvictionConfig = DEFAULT_CONVICTION_CONFIG,
): ConvictionScore[] {
  const user = getUserReputation(address);
  if (!user) return [];

  const now = Date.now();
  const scores: ConvictionScore[] = [];

  for (const [agentId, { timestamp, scoreAtUpvote }] of user.upvoteHistory) {
    const currentScore = currentScores.get(agentId) ?? 0;
    const improvement = Math.max(0, currentScore - scoreAtUpvote);
    const daysSince = (now - timestamp) / (24 * 60 * 60 * 1000);
    const timeFactor = Math.min(1.0, daysSince / config.maturityDays);

    const convictionMultiplier = 1.0 + (improvement / 100) * timeFactor * config.maxBonus;

    scores.push({
      address: user.address,
      agentId,
      scoreAtUpvote,
      currentScore,
      improvement,
      daysSinceUpvote: Math.round(daysSince * 10) / 10,
      timeFactor: Math.round(timeFactor * 1000) / 1000,
      convictionMultiplier: Math.round(convictionMultiplier * 1000) / 1000,
    });
  }

  return scores;
}

/**
 * Compute the aggregate yield multiplier for a user, combining:
 *   1. Average conviction across upvoted skills
 *   2. Tier bonus (lobster/whale get a flat % boost)
 */
export function computeYieldMultiplier(
  address: string,
  currentScores: Map<string, number>,
  config: ConvictionConfig = DEFAULT_CONVICTION_CONFIG,
): { multiplier: number; convictionAvg: number; tierBonus: number; breakdown: ConvictionScore[] } {
  const user = getUserReputation(address);
  if (!user) {
    return { multiplier: 1.0, convictionAvg: 1.0, tierBonus: 0, breakdown: [] };
  }

  const convictionScores = computeUserConviction(address, currentScores, config);

  const convictionAvg = convictionScores.length > 0
    ? convictionScores.reduce((sum, s) => sum + s.convictionMultiplier, 0) / convictionScores.length
    : 1.0;

  const tierBonus = config.tierBonuses[user.tier] ?? 0;

  const multiplier = convictionAvg + tierBonus;

  return {
    multiplier: Math.round(multiplier * 1000) / 1000,
    convictionAvg: Math.round(convictionAvg * 1000) / 1000,
    tierBonus,
    breakdown: convictionScores,
  };
}

// ---------------------------------------------------------------------------
// Leaderboard with Conviction
// ---------------------------------------------------------------------------

export interface ConvictionLeaderboardEntry {
  address: string;
  tier: ReputationTier;
  totalUpvotes: number;
  accuracy: number;
  followerCount: number;
  avgConviction: number;
  yieldMultiplier: number;
  score: number;
}

/**
 * Build a curator leaderboard that incorporates conviction scores.
 */
export function getConvictionLeaderboard(
  currentScores: Map<string, number>,
  limit = 50,
  config: ConvictionConfig = DEFAULT_CONVICTION_CONFIG,
): ConvictionLeaderboardEntry[] {
  const entries: ConvictionLeaderboardEntry[] = [];

  for (const user of getAllUserReputations()) {
    if (user.totalUpvotes === 0) continue;

    const { multiplier, convictionAvg } = computeYieldMultiplier(
      user.address, currentScores, config,
    );

    const tierWeight = user.tier === 'whale' ? 3 : user.tier === 'lobster' ? 2 : 1;
    const score = (user.accuracy * 100) * tierWeight
      + (convictionAvg - 1.0) * 200
      + Math.log2(1 + user.totalUpvotes) * 5
      + Math.log2(1 + user.followers.size) * 10;

    entries.push({
      address: user.address,
      tier: user.tier,
      totalUpvotes: user.totalUpvotes,
      accuracy: Math.round(user.accuracy * 1000) / 1000,
      followerCount: user.followers.size,
      avgConviction: convictionAvg,
      yieldMultiplier: multiplier,
      score: Math.round(score * 100) / 100,
    });
  }

  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, limit);
}
