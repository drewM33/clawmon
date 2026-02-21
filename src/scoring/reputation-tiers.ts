/**
 * Trusted ClawMon — Reputation Tier Engine
 *
 * Manages user progression through claw → lobster → whale tiers.
 * Tier advancement is based on upvote count, accuracy (did the skills
 * you upvoted maintain or improve their score?), and skill publishing.
 *
 * Upvoting costs MON — making votes economic signals, not free spam.
 */

import type {
  ReputationTier,
  UserReputation,
} from './types.js';
import { REPUTATION_TIERS } from './types.js';

// ---------------------------------------------------------------------------
// In-Memory Store
// ---------------------------------------------------------------------------

const userReputations = new Map<string, UserReputation>();

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function getOrCreateUser(address: string): UserReputation {
  const normalized = address.toLowerCase();
  let user = userReputations.get(normalized);
  if (!user) {
    user = {
      address: normalized,
      tier: 'claw',
      totalUpvotes: 0,
      accurateUpvotes: 0,
      accuracy: 0,
      hasPublishedSkill: false,
      upvoteHistory: new Map(),
      following: new Set(),
      followers: new Set(),
    };
    userReputations.set(normalized, user);
  }
  return user;
}

export function getUserReputation(address: string): UserReputation | null {
  return userReputations.get(address.toLowerCase()) ?? null;
}

export function getAllUserReputations(): UserReputation[] {
  return Array.from(userReputations.values());
}

/**
 * Record an upvote from a user on a skill. The caller is responsible
 * for collecting the MON cost on-chain before calling this.
 */
export function recordUpvote(
  address: string,
  agentId: string,
  currentScore: number,
): { user: UserReputation; cost: number } {
  const user = getOrCreateUser(address);
  const tierConfig = REPUTATION_TIERS[user.tier];

  user.upvoteHistory.set(agentId, {
    timestamp: Date.now(),
    scoreAtUpvote: currentScore,
  });
  user.totalUpvotes++;

  recalculateTier(user);

  return { user, cost: tierConfig.upvoteCostMon };
}

/**
 * Mark a user as having published a skill.
 */
export function markPublisher(address: string): void {
  const user = getOrCreateUser(address);
  user.hasPublishedSkill = true;
  recalculateTier(user);
}

/**
 * Refresh accuracy scores for all users based on current agent scores.
 * Call periodically (e.g. after score recalculation).
 */
export function refreshAccuracy(
  currentScores: Map<string, number>,
): void {
  for (const user of userReputations.values()) {
    if (user.totalUpvotes === 0) continue;

    let accurate = 0;
    for (const [agentId, { scoreAtUpvote }] of user.upvoteHistory) {
      const currentScore = currentScores.get(agentId);
      if (currentScore !== undefined && currentScore >= scoreAtUpvote) {
        accurate++;
      }
    }

    user.accurateUpvotes = accurate;
    user.accuracy = user.totalUpvotes > 0
      ? accurate / user.totalUpvotes
      : 0;

    recalculateTier(user);
  }
}

// ---------------------------------------------------------------------------
// Follower System
// ---------------------------------------------------------------------------

export function followCurator(
  followerAddress: string,
  curatorAddress: string,
): { follower: UserReputation; curator: UserReputation } {
  const follower = getOrCreateUser(followerAddress);
  const curator = getOrCreateUser(curatorAddress);

  follower.following.add(curator.address);
  curator.followers.add(follower.address);

  return { follower, curator };
}

export function unfollowCurator(
  followerAddress: string,
  curatorAddress: string,
): void {
  const follower = getUserReputation(followerAddress);
  const curator = getUserReputation(curatorAddress);

  if (follower) follower.following.delete(curatorAddress.toLowerCase());
  if (curator) curator.followers.delete(followerAddress.toLowerCase());
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface CuratorLeaderboardEntry {
  address: string;
  tier: ReputationTier;
  totalUpvotes: number;
  accuracy: number;
  followerCount: number;
  score: number;
}

export function getCuratorLeaderboard(limit = 50): CuratorLeaderboardEntry[] {
  const entries: CuratorLeaderboardEntry[] = [];

  for (const user of userReputations.values()) {
    if (user.totalUpvotes === 0) continue;

    const tierMultiplier = user.tier === 'whale' ? 3 : user.tier === 'lobster' ? 2 : 1;
    const score = (user.accuracy * 100) * tierMultiplier
      + Math.log2(1 + user.totalUpvotes) * 5
      + Math.log2(1 + user.followers.size) * 10;

    entries.push({
      address: user.address,
      tier: user.tier,
      totalUpvotes: user.totalUpvotes,
      accuracy: user.accuracy,
      followerCount: user.followers.size,
      score: Math.round(score * 100) / 100,
    });
  }

  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Serialization (for API responses)
// ---------------------------------------------------------------------------

export interface UserReputationResponse {
  address: string;
  tier: ReputationTier;
  tierLabel: string;
  totalUpvotes: number;
  accurateUpvotes: number;
  accuracy: number;
  hasPublishedSkill: boolean;
  upvoteWeight: number;
  upvoteCost: number;
  followerCount: number;
  followingCount: number;
  nextTier: ReputationTier | null;
  nextTierRequirements: {
    upvotesNeeded: number;
    accuracyNeeded: number;
    needsPublishedSkill: boolean;
  } | null;
}

export function serializeReputation(user: UserReputation): UserReputationResponse {
  const config = REPUTATION_TIERS[user.tier];
  const nextTier = getNextTier(user.tier);
  const nextConfig = nextTier ? REPUTATION_TIERS[nextTier] : null;

  return {
    address: user.address,
    tier: user.tier,
    tierLabel: config.label,
    totalUpvotes: user.totalUpvotes,
    accurateUpvotes: user.accurateUpvotes,
    accuracy: Math.round(user.accuracy * 1000) / 1000,
    hasPublishedSkill: user.hasPublishedSkill,
    upvoteWeight: config.upvoteWeight,
    upvoteCost: config.upvoteCostMon,
    followerCount: user.followers.size,
    followingCount: user.following.size,
    nextTier,
    nextTierRequirements: nextConfig ? {
      upvotesNeeded: Math.max(0, nextConfig.minUpvotes - user.totalUpvotes),
      accuracyNeeded: Math.max(0, nextConfig.minAccuracy - user.accuracy),
      needsPublishedSkill: nextConfig.requiresPublishedSkill && !user.hasPublishedSkill,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function recalculateTier(user: UserReputation): void {
  const tiers: ReputationTier[] = ['whale', 'lobster', 'claw'];

  for (const tierName of tiers) {
    const config = REPUTATION_TIERS[tierName];
    if (
      user.totalUpvotes >= config.minUpvotes &&
      user.accuracy >= config.minAccuracy &&
      (!config.requiresPublishedSkill || user.hasPublishedSkill)
    ) {
      user.tier = tierName;
      return;
    }
  }

  user.tier = 'claw';
}

function getNextTier(current: ReputationTier): ReputationTier | null {
  switch (current) {
    case 'claw': return 'lobster';
    case 'lobster': return 'whale';
    case 'whale': return null;
  }
}
