/**
 * Trusted ClawMon — Hardened Scoring Engine
 *
 * Wraps the naive engine with independently toggleable mitigations:
 *
 *   1. Graph analysis    — detect mutual feedback pairs → 90% discount
 *   2. Velocity check    — >10 feedback in 60s → 50% discount
 *   3. Temporal decay    — exponential, 1-day half-life
 *   4. Submitter weight  — new submitters in recent 20% → 80% discount
 *   5. Anomaly detection — >5 new submitters in 60s → 90% discount
 *
 * Each mitigation maps to a specific attack vector:
 *   - Graph analysis → Sybil farming
 *   - Temporal decay → Reputation laundering
 *   - Submitter weighting → Attestation poisoning
 *   - Velocity + Anomaly → General burst attacks
 */

import type { Feedback, FeedbackSummary } from './types.js';
import { scoreToTier, tierToAccessDecision, emptySummary } from './types.js';
import { computeSummary, computeWeightedAverage } from './engine.js';
import type { MitigationConfig, MitigationResult, MitigationFlag } from '../mitigations/types.js';
import { applyGraphAnalysis } from '../mitigations/graph.js';
import {
  detectVelocitySpikes,
  detectNewSubmitterBurst,
} from '../mitigations/velocity.js';

// ---------------------------------------------------------------------------
// Hardened Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a hardened feedback summary with all enabled mitigations applied.
 *
 * The function:
 *   1. Filters out revoked feedback
 *   2. Runs each enabled mitigation to compute per-feedback weights
 *   3. Combines weights (multiplicative — all discounts stack)
 *   4. Computes weighted average
 *   5. Maps to trust tier and access decision
 *
 * @param feedback - Feedback entries for a single agent
 * @param config - Which mitigations are enabled and their parameters
 * @param allFeedback - Full corpus of all feedback (needed for graph analysis and anomaly detection)
 */
export function computeHardenedSummary(
  feedback: Feedback[],
  config: MitigationConfig,
  allFeedback?: Feedback[],
): FeedbackSummary {
  if (feedback.length === 0) {
    return emptySummary(feedback[0]?.agentId ?? 'unknown');
  }

  const agentId = feedback[0].agentId;
  const active = feedback.filter((f) => !f.revoked);

  if (active.length === 0) {
    return emptySummary(agentId);
  }

  const corpus = allFeedback ?? active;

  // Initialize weights: every feedback starts at 1.0
  const weights = new Map<string, number>();
  const allFlags = new Map<string, MitigationFlag[]>();

  for (const f of active) {
    weights.set(f.id, 1.0);
    allFlags.set(f.id, []);
  }

  // --- 1. Graph Analysis (Sybil detection) ---
  if (config.graphAnalysis.enabled) {
    const results = applyGraphAnalysis(
      active,
      corpus,
      config.graphAnalysis.discountFactor,
    );
    mergeWeights(weights, allFlags, results);
  }

  // --- 2. Velocity Check (burst detection) ---
  if (config.velocityCheck.enabled) {
    const flaggedIds = detectVelocitySpikes(
      active,
      config.velocityCheck.maxInWindow,
      config.velocityCheck.windowMs,
    );
    const results: MitigationResult[] = active.map((f) => ({
      feedbackId: f.id,
      weight: flaggedIds.has(f.id) ? config.velocityCheck.discountFactor : 1.0,
      flags: flaggedIds.has(f.id) ? (['velocity_burst'] as MitigationFlag[]) : [],
    }));
    mergeWeights(weights, allFlags, results);
  }

  // --- 3. Temporal Decay (laundering defense) ---
  if (config.temporalDecay.enabled) {
    const now = Date.now();
    const results: MitigationResult[] = active.map((f) => {
      const ageMs = Math.max(0, now - f.timestamp);
      // Exponential decay: weight = 0.5 ^ (age / halfLife)
      const decayWeight = Math.pow(0.5, ageMs / config.temporalDecay.halfLifeMs);
      return {
        feedbackId: f.id,
        weight: decayWeight,
        flags: decayWeight < 0.5 ? (['temporal_decay'] as MitigationFlag[]) : [],
      };
    });
    mergeWeights(weights, allFlags, results);
  }

  // --- 4. Submitter Weighting (poison defense) ---
  if (config.submitterWeighting.enabled) {
    const results = applySubmitterWeighting(
      active,
      corpus,
      config.submitterWeighting.recentThreshold,
      config.submitterWeighting.discountFactor,
    );
    mergeWeights(weights, allFlags, results);
  }

  // --- 5. Anomaly Detection (new submitter burst) ---
  if (config.anomalyDetection.enabled) {
    const flaggedIds = detectNewSubmitterBurst(
      active,
      corpus,
      config.anomalyDetection.maxNewInWindow,
      config.anomalyDetection.windowMs,
    );
    const results: MitigationResult[] = active.map((f) => ({
      feedbackId: f.id,
      weight: flaggedIds.has(f.id) ? config.anomalyDetection.discountFactor : 1.0,
      flags: flaggedIds.has(f.id) ? (['anomaly_burst'] as MitigationFlag[]) : [],
    }));
    mergeWeights(weights, allFlags, results);
  }

  // --- Compute final weighted average ---
  let avg = computeWeightedAverage(active, weights);

  // --- Sybil cluster score penalty ---
  //
  // The weighted average is immune to uniform discounting: if ALL entries
  // share the same weight (e.g., all flagged at 0.1), sum(v*w)/sum(w)
  // equals the plain arithmetic average.
  //
  // To fix this, apply a direct score penalty proportional to the fraction
  // of feedback flagged by graph analysis. This ensures sybil-dominated
  // agents can't maintain high scores even when all their reviews are fake.
  //
  // At 100% flagged: score × discountFactor  (e.g., 91 × 0.1 = 9.1)
  // At  50% flagged: score × 0.55            (45% reduction)
  // At   0% flagged: no change
  //
  if (config.graphAnalysis.enabled) {
    let sybilFlaggedCount = 0;
    for (const f of active) {
      const flags = allFlags.get(f.id) ?? [];
      if (flags.includes('sybil_mutual_feedback')) {
        sybilFlaggedCount++;
      }
    }

    const sybilFraction = sybilFlaggedCount / active.length;
    if (sybilFraction > 0) {
      const penaltyMultiplier =
        1.0 - sybilFraction * (1.0 - config.graphAnalysis.discountFactor);
      avg = avg * penaltyMultiplier;
    }
  }

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
// Multi-Agent Hardened Scoring
// ---------------------------------------------------------------------------

/**
 * Compute hardened summaries for all agents in the feedback corpus.
 */
export function computeAllHardenedSummaries(
  allFeedback: Feedback[],
  config: MitigationConfig,
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
      computeHardenedSummary(agentFeedback, config, allFeedback),
    );
  }

  return summaries;
}

/**
 * Compare naive vs. hardened scores for a single agent.
 * Useful for dashboard display showing mitigation impact.
 */
export function compareScoring(
  feedback: Feedback[],
  config: MitigationConfig,
  allFeedback?: Feedback[],
): { naive: FeedbackSummary; hardened: FeedbackSummary; delta: number } {
  const naive = computeSummary(feedback);
  const hardened = computeHardenedSummary(feedback, config, allFeedback);

  return {
    naive,
    hardened,
    delta: naive.summaryValue - hardened.summaryValue,
  };
}

// ---------------------------------------------------------------------------
// Submitter Weighting
// ---------------------------------------------------------------------------

/**
 * Discount feedback from "new" submitters (recent entrants to the ecosystem).
 *
 * A submitter is "new" if they are in the most recent `recentThreshold`
 * fraction of all unique submitters, ordered by their first feedback timestamp.
 *
 * New submitters get a `discountFactor` weight (e.g., 0.2 = 80% discount).
 */
function applySubmitterWeighting(
  feedback: Feedback[],
  allFeedback: Feedback[],
  recentThreshold: number,
  discountFactor: number,
): MitigationResult[] {
  // Find first-seen timestamp for each submitter across all feedback
  const firstSeen = new Map<string, number>();
  for (const f of allFeedback) {
    if (f.revoked) continue;
    const existing = firstSeen.get(f.clientAddress);
    if (existing === undefined || f.timestamp < existing) {
      firstSeen.set(f.clientAddress, f.timestamp);
    }
  }

  // Sort submitters by first-seen timestamp
  const sortedSubmitters = Array.from(firstSeen.entries())
    .sort((a, b) => a[1] - b[1]);

  // The most recent `recentThreshold` fraction are "new"
  const cutoffIndex = Math.floor(sortedSubmitters.length * (1 - recentThreshold));
  const newSubmitters = new Set(
    sortedSubmitters.slice(cutoffIndex).map(([addr]) => addr),
  );

  return feedback.map((f) => ({
    feedbackId: f.id,
    weight: newSubmitters.has(f.clientAddress) ? discountFactor : 1.0,
    flags: newSubmitters.has(f.clientAddress)
      ? (['new_submitter'] as MitigationFlag[])
      : [],
  }));
}

// ---------------------------------------------------------------------------
// Weight Merging
// ---------------------------------------------------------------------------

/**
 * Merge mitigation results into the accumulated weights.
 * Weights are combined multiplicatively: if graph analysis gives 0.1
 * and velocity gives 0.5, the combined weight is 0.05.
 */
function mergeWeights(
  weights: Map<string, number>,
  allFlags: Map<string, MitigationFlag[]>,
  results: MitigationResult[],
): void {
  for (const r of results) {
    const current = weights.get(r.feedbackId) ?? 1.0;
    weights.set(r.feedbackId, current * r.weight);

    const flags = allFlags.get(r.feedbackId) ?? [];
    flags.push(...r.flags);
    allFlags.set(r.feedbackId, flags);
  }
}
