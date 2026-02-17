/**
 * Trusted ClawMon — Naive Scoring Engine
 *
 * Mirrors the ERC-8004 getSummary computation:
 *   - Simple arithmetic average of feedback values
 *   - No temporal decay
 *   - No submitter weighting
 *   - No anomaly detection
 *
 * This is intentionally the ATTACK TARGET. It demonstrates how
 * trivially the scoring can be gamed without mitigations.
 *
 * The hardened engine (hardened.ts) wraps this with toggleable
 * mitigations to show the defense.
 */

import type { Feedback, FeedbackSummary, TrustTier } from './types.js';
import { scoreToTier, tierToAccessDecision, emptySummary } from './types.js';

// ---------------------------------------------------------------------------
// Naive Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a feedback summary using the naive (unprotected) algorithm.
 *
 * Algorithm:
 *   1. Filter out revoked feedback
 *   2. Optionally filter by clientAddresses (ERC-8004 spec)
 *   3. Compute simple arithmetic average of .value fields
 *   4. Map to trust tier and access decision
 *
 * @param feedback - Feedback entries for a single agent
 * @param clientAddresses - Optional: only include feedback from these addresses
 */
export function computeSummary(
  feedback: Feedback[],
  clientAddresses?: string[],
): FeedbackSummary {
  if (feedback.length === 0) {
    return emptySummary(feedback[0]?.agentId ?? 'unknown');
  }

  const agentId = feedback[0].agentId;

  // Step 1: filter out revoked
  let active = feedback.filter((f) => !f.revoked);

  // Step 2: filter by clientAddresses if provided
  if (clientAddresses && clientAddresses.length > 0) {
    const allowedSet = new Set(clientAddresses);
    active = active.filter((f) => allowedSet.has(f.clientAddress));
  }

  if (active.length === 0) {
    return emptySummary(agentId);
  }

  // Step 3: simple arithmetic average
  const sum = active.reduce((acc, f) => acc + f.value, 0);
  const avg = sum / active.length;

  // Step 4: map to tier and access decision
  const tier = scoreToTier(avg);
  const accessDecision = tierToAccessDecision(tier);

  return {
    agentId,
    feedbackCount: active.length,
    summaryValue: Math.round(avg * 100) / 100, // 2 decimal places
    summaryValueDecimals: 2,
    tier,
    accessDecision,
  };
}

// ---------------------------------------------------------------------------
// Multi-Agent Scoring
// ---------------------------------------------------------------------------

/**
 * Compute summaries for all agents present in the feedback corpus.
 * Returns a Map of agentId → FeedbackSummary.
 */
export function computeAllSummaries(
  allFeedback: Feedback[],
  clientAddresses?: string[],
): Map<string, FeedbackSummary> {
  // Group feedback by agentId
  const byAgent = groupByAgent(allFeedback);
  const summaries = new Map<string, FeedbackSummary>();

  for (const [agentId, agentFeedback] of byAgent) {
    summaries.set(agentId, computeSummary(agentFeedback, clientAddresses));
  }

  return summaries;
}

/**
 * Rank agents by their summary score, highest first.
 */
export function rankAgents(
  allFeedback: Feedback[],
): FeedbackSummary[] {
  const summaries = computeAllSummaries(allFeedback);
  return Array.from(summaries.values()).sort(
    (a, b) => b.summaryValue - a.summaryValue,
  );
}

// ---------------------------------------------------------------------------
// Weighted Scoring (used by hardened engine)
// ---------------------------------------------------------------------------

/**
 * Compute a weighted average given feedback entries and per-feedback weights.
 *
 * @param feedback - Active (non-revoked) feedback entries
 * @param weights - Map of feedbackId → weight (0.0–1.0+)
 * @returns Weighted average score
 */
export function computeWeightedAverage(
  feedback: Feedback[],
  weights: Map<string, number>,
): number {
  if (feedback.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const f of feedback) {
    const w = weights.get(f.id) ?? 1.0;
    weightedSum += f.value * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group feedback entries by agentId */
export function groupByAgent(
  feedback: Feedback[],
): Map<string, Feedback[]> {
  const groups = new Map<string, Feedback[]>();

  for (const f of feedback) {
    if (!groups.has(f.agentId)) {
      groups.set(f.agentId, []);
    }
    groups.get(f.agentId)!.push(f);
  }

  return groups;
}

/**
 * Get a human-readable description of a trust tier.
 */
export function tierDescription(tier: TrustTier): string {
  const descriptions: Record<TrustTier, string> = {
    AAA: 'Highest trust — extensively validated',
    AA: 'Very high trust — well established',
    A: 'High trust — reliable track record',
    BBB: 'Moderate trust — generally acceptable',
    BB: 'Below average — use with caution',
    B: 'Low trust — limited validation',
    CCC: 'Very low trust — significant concerns',
    CC: 'Near-minimum trust — likely problematic',
    C: 'Minimum trust — insufficient data or confirmed issues',
  };
  return descriptions[tier];
}
