/**
 * Trusted ClawMon — Graph Analysis Mitigation
 *
 * Detects mutual feedback pairs (A rates B AND B rates A) which are
 * a strong signal of sybil collusion. Feedback from detected pairs
 * is discounted by the configured factor (default 90% discount).
 *
 * Maps to real-world incident: 22,000 fake ERC-8004 registrations,
 * batch-minted identities gaming trust scores (Crapis, Bankless Feb 15).
 */

import type { Feedback } from '../scoring/types.js';
import type { MitigationResult } from './types.js';

/**
 * A mutual feedback pair: two addresses that have rated each other's agents.
 * In the skill context, this means two publishers whose skills rate each other.
 */
export interface MutualPair {
  addressA: string;
  addressB: string;
  /** Feedback IDs from A→B and B→A */
  feedbackIds: string[];
}

/**
 * Detect mutual feedback rings in a corpus of feedback.
 *
 * A mutual pair exists when:
 *   - clientAddress X submits feedback for agentId owned by Y
 *   - clientAddress Y submits feedback for agentId owned by X
 *
 * Since we don't always know agent ownership in Phase 1, we use a simpler
 * heuristic: two addresses that submit feedback for each other's agentIds
 * (treating agentId as a proxy for publisher identity).
 *
 * For this implementation we check: if address A rates agent B, and
 * address B rates agent A — that's a mutual pair.
 */
export function detectMutualFeedback(allFeedback: Feedback[]): MutualPair[] {
  // Build a map: clientAddress → Set<agentId they rated>
  const ratedBy = new Map<string, Map<string, string[]>>();

  for (const fb of allFeedback) {
    if (fb.revoked) continue;

    if (!ratedBy.has(fb.clientAddress)) {
      ratedBy.set(fb.clientAddress, new Map());
    }
    const agentMap = ratedBy.get(fb.clientAddress)!;
    if (!agentMap.has(fb.agentId)) {
      agentMap.set(fb.agentId, []);
    }
    agentMap.get(fb.agentId)!.push(fb.id);
  }

  // Also build: agentId → Set<clientAddress that rated it>
  // and: agentId as address → rated agents (treat agentId as address proxy)
  // Detect mutual pairs: A rated agent-B AND B rated agent-A
  // Here we treat agentId as the "identity" of the publisher
  const pairs: MutualPair[] = [];
  const seen = new Set<string>();

  const addresses = Array.from(ratedBy.keys());

  for (let i = 0; i < addresses.length; i++) {
    const addrA = addresses[i];
    const agentsRatedByA = ratedBy.get(addrA)!;

    for (const [agentB, feedbackIdsAtoB] of agentsRatedByA) {
      // Check if agentB (as an address) has rated any agent matching addrA
      // The mutual condition: B rates "addrA" as an agentId
      if (ratedBy.has(agentB)) {
        const agentsRatedByB = ratedBy.get(agentB)!;
        if (agentsRatedByB.has(addrA)) {
          const pairKey = [addrA, agentB].sort().join('::');
          if (!seen.has(pairKey)) {
            seen.add(pairKey);
            const feedbackIdsBtoA = agentsRatedByB.get(addrA)!;
            pairs.push({
              addressA: addrA,
              addressB: agentB,
              feedbackIds: [...feedbackIdsAtoB, ...feedbackIdsBtoA],
            });
          }
        }
      }
    }
  }

  return pairs;
}

/**
 * Apply graph analysis discount to feedback.
 *
 * Two-level detection:
 *   1. **Pair-level**: Individual feedback entries in mutual pairs get discounted.
 *   2. **Cluster-level**: When an agent belongs to a sybil cluster (connected
 *      component of mutual pairs), ALL feedback for that agent is discounted —
 *      not just the specific mutual pair entries. This catches evasion via
 *      secondary addresses (e.g., "sybil-1-alt" self-reviews) that wouldn't
 *      form mutual pairs themselves but target a known-sybil agent.
 *
 * Additionally, any feedback FROM an address that belongs to a sybil cluster
 * is discounted, even if the target agent is legitimate.
 */
export function applyGraphAnalysis(
  feedback: Feedback[],
  allFeedback: Feedback[],
  discountFactor: number,
): MitigationResult[] {
  // Pair-level: flag specific mutual feedback IDs
  const pairs = detectMutualFeedback(allFeedback);
  const mutualFeedbackIds = new Set<string>();
  for (const pair of pairs) {
    for (const id of pair.feedbackIds) {
      mutualFeedbackIds.add(id);
    }
  }

  // Cluster-level: find connected components of mutual-pair addresses
  const clusters = detectSybilClusters(allFeedback);
  const sybilAddresses = new Set<string>();
  for (const cluster of clusters) {
    for (const address of cluster) {
      sybilAddresses.add(address);
    }
  }

  return feedback.map((fb) => {
    const inMutualPair = mutualFeedbackIds.has(fb.id);
    const agentInCluster = sybilAddresses.has(fb.agentId);
    const submitterInCluster = sybilAddresses.has(fb.clientAddress);
    const isFlagged = inMutualPair || agentInCluster || submitterInCluster;

    return {
      feedbackId: fb.id,
      weight: isFlagged ? discountFactor : 1.0,
      flags: isFlagged ? ['sybil_mutual_feedback' as const] : [],
    };
  });
}

/**
 * Detect sybil clusters: groups of addresses that are densely interconnected
 * via mutual feedback. Returns sets of addresses that form clusters.
 */
export function detectSybilClusters(allFeedback: Feedback[]): Set<string>[] {
  const pairs = detectMutualFeedback(allFeedback);

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const pair of pairs) {
    if (!adj.has(pair.addressA)) adj.set(pair.addressA, new Set());
    if (!adj.has(pair.addressB)) adj.set(pair.addressB, new Set());
    adj.get(pair.addressA)!.add(pair.addressB);
    adj.get(pair.addressB)!.add(pair.addressA);
  }

  // BFS to find connected components
  const visited = new Set<string>();
  const clusters: Set<string>[] = [];

  for (const node of adj.keys()) {
    if (visited.has(node)) continue;

    const cluster = new Set<string>();
    const queue = [node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.add(current);
      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (cluster.size >= 2) {
      clusters.push(cluster);
    }
  }

  return clusters;
}
