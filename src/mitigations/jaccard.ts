/**
 * Trusted ClawMon — Jaccard Similarity Clustering
 *
 * Behavioral fingerprinting that detects coordinated sybil campaigns
 * by analyzing the overlap in agents reviewed by different addresses.
 *
 * Key insight: Sybil accounts created for a campaign tend to review
 * the same set of targets. Even without mutual feedback (which
 * graph.ts catches), if 5 addresses all reviewed the same 3 skills
 * and nothing else, their pairwise Jaccard similarity ≈ 1.0.
 *
 * This catches "one-directional chain" evasion where attackers avoid
 * mutual feedback by using dedicated sybil addresses that only rate
 * (never receive ratings), making them invisible to mutual-pair detection.
 *
 * Jaccard(A,B) = |agents_A ∩ agents_B| / |agents_A ∪ agents_B|
 */

import type { Feedback } from '../scoring/types.js';
import type { MitigationResult, MitigationFlag } from './types.js';

export interface JaccardConfig {
  /** Minimum Jaccard similarity to consider a pair as coordinated (0-1) */
  similarityThreshold: number;
  /** Minimum cluster size to flag (single pairs may be coincidental) */
  minClusterSize: number;
  /** Minimum number of agents reviewed to be included in analysis */
  minAgentsReviewed: number;
  /** Discount factor applied to flagged feedback */
  discountFactor: number;
}

export const DEFAULT_JACCARD_CONFIG: JaccardConfig = {
  similarityThreshold: 0.7,
  minClusterSize: 3,
  minAgentsReviewed: 2,
  discountFactor: 0.15,
};

export interface JaccardCluster {
  /** Addresses in this cluster */
  addresses: string[];
  /** The agents they commonly reviewed */
  commonAgents: string[];
  /** Average pairwise Jaccard similarity */
  avgSimilarity: number;
}

export interface JaccardResult {
  /** Detected behavioral clusters */
  clusters: JaccardCluster[];
  /** All flagged addresses (union of all cluster members) */
  flaggedAddresses: Set<string>;
  /** Pairwise similarity scores for addresses above threshold */
  similarPairs: Array<{ a: string; b: string; similarity: number }>;
}

/**
 * Compute the Jaccard similarity coefficient between two sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detect clusters of addresses with high behavioral similarity.
 *
 * Algorithm:
 *   1. Build reviewer profiles: address → Set<agentId reviewed>
 *   2. Compute pairwise Jaccard similarity for all reviewer pairs
 *   3. Build similarity graph (edges where Jaccard > threshold)
 *   4. Extract connected components as clusters
 *   5. Filter clusters by minimum size
 */
export function detectJaccardClusters(
  allFeedback: Feedback[],
  config: JaccardConfig = DEFAULT_JACCARD_CONFIG,
): JaccardResult {
  // Build reviewer profiles
  const profiles = new Map<string, Set<string>>();
  const feedbackValues = new Map<string, Map<string, number[]>>();

  for (const fb of allFeedback) {
    if (fb.revoked) continue;

    if (!profiles.has(fb.clientAddress)) {
      profiles.set(fb.clientAddress, new Set());
    }
    profiles.get(fb.clientAddress)!.add(fb.agentId);

    if (!feedbackValues.has(fb.clientAddress)) {
      feedbackValues.set(fb.clientAddress, new Map());
    }
    if (!feedbackValues.get(fb.clientAddress)!.has(fb.agentId)) {
      feedbackValues.get(fb.clientAddress)!.set(fb.agentId, []);
    }
    feedbackValues.get(fb.clientAddress)!.get(fb.agentId)!.push(fb.value);
  }

  // Filter to addresses with enough activity
  const activeAddrs = Array.from(profiles.entries())
    .filter(([, agents]) => agents.size >= config.minAgentsReviewed)
    .map(([addr]) => addr);

  // Compute pairwise Jaccard similarities
  const similarPairs: Array<{ a: string; b: string; similarity: number }> = [];
  const simAdj = new Map<string, Set<string>>();

  for (let i = 0; i < activeAddrs.length; i++) {
    for (let j = i + 1; j < activeAddrs.length; j++) {
      const a = activeAddrs[i];
      const b = activeAddrs[j];
      const sim = jaccard(profiles.get(a)!, profiles.get(b)!);

      if (sim >= config.similarityThreshold) {
        // Additionally check value similarity -- sybils tend to give similar scores
        const valueSim = computeValueSimilarity(
          feedbackValues.get(a)!,
          feedbackValues.get(b)!,
          profiles.get(a)!,
          profiles.get(b)!,
        );

        // Combined similarity: target overlap * value alignment
        const combinedSim = sim * 0.6 + valueSim * 0.4;

        if (combinedSim >= config.similarityThreshold) {
          similarPairs.push({ a, b, similarity: combinedSim });

          if (!simAdj.has(a)) simAdj.set(a, new Set());
          if (!simAdj.has(b)) simAdj.set(b, new Set());
          simAdj.get(a)!.add(b);
          simAdj.get(b)!.add(a);
        }
      }
    }
  }

  // BFS to find connected components
  const visited = new Set<string>();
  const rawClusters: Set<string>[] = [];

  for (const node of simAdj.keys()) {
    if (visited.has(node)) continue;

    const cluster = new Set<string>();
    const queue = [node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.add(current);
      for (const neighbor of simAdj.get(current) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    rawClusters.push(cluster);
  }

  // Filter and enrich clusters
  const clusters: JaccardCluster[] = [];
  const flaggedAddresses = new Set<string>();

  for (const raw of rawClusters) {
    if (raw.size < config.minClusterSize) continue;

    const addresses = Array.from(raw);

    // Find commonly reviewed agents
    const agentSets = addresses.map((a) => profiles.get(a)!);
    const commonAgents: string[] = [];
    if (agentSets.length > 0) {
      for (const agent of agentSets[0]) {
        if (agentSets.every((s) => s.has(agent))) {
          commonAgents.push(agent);
        }
      }
    }

    // Average pairwise similarity within cluster
    let totalSim = 0;
    let pairCount = 0;
    for (let i = 0; i < addresses.length; i++) {
      for (let j = i + 1; j < addresses.length; j++) {
        totalSim += jaccard(profiles.get(addresses[i])!, profiles.get(addresses[j])!);
        pairCount++;
      }
    }

    clusters.push({
      addresses,
      commonAgents,
      avgSimilarity: pairCount > 0 ? totalSim / pairCount : 0,
    });

    for (const addr of addresses) {
      flaggedAddresses.add(addr);
    }
  }

  return { clusters, flaggedAddresses, similarPairs };
}

/**
 * Compute value similarity: how similarly do two addresses score the
 * agents they've both reviewed? Returns 0-1, where 1 = identical scoring.
 */
function computeValueSimilarity(
  valuesA: Map<string, number[]>,
  valuesB: Map<string, number[]>,
  agentsA: Set<string>,
  agentsB: Set<string>,
): number {
  const common: string[] = [];
  for (const agent of agentsA) {
    if (agentsB.has(agent)) common.push(agent);
  }

  if (common.length === 0) return 0;

  let totalDiff = 0;
  let count = 0;

  for (const agent of common) {
    const aVals = valuesA.get(agent) ?? [];
    const bVals = valuesB.get(agent) ?? [];
    if (aVals.length === 0 || bVals.length === 0) continue;

    const aAvg = aVals.reduce((s, v) => s + v, 0) / aVals.length;
    const bAvg = bVals.reduce((s, v) => s + v, 0) / bVals.length;

    // Normalized absolute difference (0-100 scale → 0-1)
    totalDiff += Math.abs(aAvg - bAvg) / 100;
    count++;
  }

  if (count === 0) return 0;
  const avgDiff = totalDiff / count;
  return 1.0 - avgDiff;
}

/**
 * Apply Jaccard similarity clustering as a mitigation layer.
 */
export function applyJaccardMitigation(
  feedback: Feedback[],
  allFeedback: Feedback[],
  config: JaccardConfig = DEFAULT_JACCARD_CONFIG,
): { results: MitigationResult[]; jaccardResult: JaccardResult } {
  const jaccardResult = detectJaccardClusters(allFeedback, config);

  const results: MitigationResult[] = feedback.map((fb) => {
    const isFlagged = jaccardResult.flaggedAddresses.has(fb.clientAddress);

    return {
      feedbackId: fb.id,
      weight: isFlagged ? config.discountFactor : 1.0,
      flags: isFlagged ? ['jaccard_coordinated' as MitigationFlag] : [],
    };
  });

  return { results, jaccardResult };
}
