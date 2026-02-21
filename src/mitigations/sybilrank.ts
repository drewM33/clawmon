/**
 * Trusted ClawMon — SybilRank Sybil Detection
 *
 * Implementation of the SybilRank algorithm (Yu et al., IEEE S&P 2006/2008).
 * Uses short random walks from trusted seed nodes to propagate trust through
 * the feedback graph. Sybil regions receive less trust because they have
 * limited "attack edges" connecting them to the honest region.
 *
 * Key insight: An attacker controlling S sybil identities can create
 * unlimited edges among them, but the number of edges crossing into the
 * honest region is bounded by the attacker's real-world resources.
 * Random walks "leak" trust through those few attack edges proportionally,
 * so each sybil gets ~1/S of the trust a real node would get.
 *
 * Reference: "SybilGuard / SybilLimit / SybilRank" family of algorithms.
 */

import type { Feedback } from '../scoring/types.js';
import type { MitigationResult, MitigationFlag } from './types.js';

export interface SybilRankConfig {
  /** Number of power-iteration rounds (O(log n) recommended) */
  iterations: number;
  /** Trust threshold below which an address is flagged as likely sybil (0-1) */
  trustThreshold: number;
  /** Discount factor applied to sybil-flagged feedback */
  discountFactor: number;
  /** Seed trust strategy */
  seedStrategy: 'uniform' | 'degree_weighted';
}

export const DEFAULT_SYBILRANK_CONFIG: SybilRankConfig = {
  iterations: 10,
  trustThreshold: 0.2,
  discountFactor: 0.1,
  seedStrategy: 'degree_weighted',
};

export interface SybilRankResult {
  /** Trust score per address (0-1, higher = more trusted) */
  trustScores: Map<string, number>;
  /** Addresses flagged as likely sybil (trust < threshold) */
  flaggedAddresses: Set<string>;
  /** Number of iterations performed */
  iterationsRun: number;
  /** Total nodes in the graph */
  nodeCount: number;
  /** Total edges in the graph */
  edgeCount: number;
}

/**
 * Build a bipartite-style trust graph from feedback:
 *   - Nodes = all unique addresses (both clientAddress and agentId)
 *   - Edges = feedback relationships (clientAddress → agentId)
 *   - Edge weight = number of feedback entries between the pair
 *
 * We treat agentId as a node in the graph because in this ecosystem
 * the agent's address IS its identity.
 */
function buildGraph(allFeedback: Feedback[]): {
  adj: Map<string, Map<string, number>>;
  nodes: Set<string>;
} {
  const adj = new Map<string, Map<string, number>>();
  const nodes = new Set<string>();

  for (const fb of allFeedback) {
    if (fb.revoked) continue;

    const a = fb.clientAddress;
    const b = fb.agentId;
    nodes.add(a);
    nodes.add(b);

    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());

    adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + 1);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + 1);
  }

  return { adj, nodes };
}

/**
 * Identify seed (trusted) nodes. Seeds are addresses that:
 *   1. Have diverse feedback activity (reviewed multiple different agents)
 *   2. Have been active over a longer time span
 *   3. Are not exclusively part of mutual-feedback pairs
 *
 * In the absence of an external trust oracle, we use a heuristic:
 * top-quartile addresses by (unique agents reviewed * time span).
 */
function identifySeeds(
  allFeedback: Feedback[],
  nodes: Set<string>,
): Set<string> {
  const stats = new Map<string, { agents: Set<string>; minT: number; maxT: number; count: number }>();

  for (const fb of allFeedback) {
    if (fb.revoked) continue;
    const addr = fb.clientAddress;
    if (!stats.has(addr)) {
      stats.set(addr, { agents: new Set(), minT: fb.timestamp, maxT: fb.timestamp, count: 0 });
    }
    const s = stats.get(addr)!;
    s.agents.add(fb.agentId);
    s.minT = Math.min(s.minT, fb.timestamp);
    s.maxT = Math.max(s.maxT, fb.timestamp);
    s.count++;
  }

  // Score = unique_agents * log(1 + time_span_hours) * log(1 + count)
  const scored: { addr: string; score: number }[] = [];
  for (const [addr, s] of stats) {
    const spanHours = (s.maxT - s.minT) / 3_600_000;
    const diversity = s.agents.size;
    const score = diversity * Math.log1p(spanHours) * Math.log1p(s.count);
    scored.push({ addr, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Top quartile are seeds, minimum 1
  const seedCount = Math.max(1, Math.ceil(scored.length * 0.25));
  const seeds = new Set<string>();
  for (let i = 0; i < seedCount && i < scored.length; i++) {
    seeds.add(scored[i].addr);
  }

  return seeds;
}

/**
 * Run SybilRank: power iteration on the trust graph.
 *
 * Initialize trust at seed nodes, then iteratively propagate trust
 * along edges. Each node distributes its trust equally to neighbors.
 * After O(log n) iterations, sybil nodes end up with significantly
 * less trust than honest nodes.
 */
export function computeSybilRank(
  allFeedback: Feedback[],
  config: SybilRankConfig = DEFAULT_SYBILRANK_CONFIG,
): SybilRankResult {
  const { adj, nodes } = buildGraph(allFeedback);

  if (nodes.size === 0) {
    return {
      trustScores: new Map(),
      flaggedAddresses: new Set(),
      iterationsRun: 0,
      nodeCount: 0,
      edgeCount: 0,
    };
  }

  const seeds = identifySeeds(allFeedback, nodes);

  // Initialize trust distribution
  const trust = new Map<string, number>();
  const totalSeedTrust = 1.0;

  if (config.seedStrategy === 'degree_weighted') {
    // Seeds get trust proportional to their degree
    let totalDegree = 0;
    for (const seed of seeds) {
      totalDegree += adj.get(seed)?.size ?? 1;
    }
    for (const node of nodes) {
      if (seeds.has(node)) {
        const degree = adj.get(node)?.size ?? 1;
        trust.set(node, (totalSeedTrust * degree) / totalDegree);
      } else {
        trust.set(node, 0);
      }
    }
  } else {
    const perSeed = totalSeedTrust / seeds.size;
    for (const node of nodes) {
      trust.set(node, seeds.has(node) ? perSeed : 0);
    }
  }

  // Power iteration
  const iterations = Math.min(config.iterations, Math.ceil(Math.log2(nodes.size + 1)));

  for (let iter = 0; iter < iterations; iter++) {
    const nextTrust = new Map<string, number>();
    for (const node of nodes) {
      nextTrust.set(node, 0);
    }

    for (const [node, neighbors] of adj) {
      const currentTrust = trust.get(node) ?? 0;
      if (currentTrust === 0 || neighbors.size === 0) continue;

      // Weighted distribution: trust flows proportional to edge weight
      let totalWeight = 0;
      for (const w of neighbors.values()) totalWeight += w;

      for (const [neighbor, weight] of neighbors) {
        const share = (currentTrust * weight) / totalWeight;
        nextTrust.set(neighbor, (nextTrust.get(neighbor) ?? 0) + share);
      }
    }

    // Copy results
    for (const [node, val] of nextTrust) {
      trust.set(node, val);
    }
  }

  // Normalize trust scores to [0, 1]
  let maxTrust = 0;
  for (const val of trust.values()) {
    maxTrust = Math.max(maxTrust, val);
  }

  if (maxTrust > 0) {
    for (const [node, val] of trust) {
      trust.set(node, val / maxTrust);
    }
  }

  // Flag addresses below threshold
  const flaggedAddresses = new Set<string>();
  for (const [node, score] of trust) {
    if (score < config.trustThreshold) {
      flaggedAddresses.add(node);
    }
  }

  let edgeCount = 0;
  for (const neighbors of adj.values()) {
    edgeCount += neighbors.size;
  }

  return {
    trustScores: trust,
    flaggedAddresses,
    iterationsRun: iterations,
    nodeCount: nodes.size,
    edgeCount: edgeCount / 2,
  };
}

/**
 * Apply SybilRank as a mitigation layer.
 * Feedback from or about flagged addresses gets discounted.
 */
export function applySybilRank(
  feedback: Feedback[],
  allFeedback: Feedback[],
  config: SybilRankConfig = DEFAULT_SYBILRANK_CONFIG,
): { results: MitigationResult[]; rankResult: SybilRankResult } {
  const rankResult = computeSybilRank(allFeedback, config);

  const results: MitigationResult[] = feedback.map((fb) => {
    const submitterFlagged = rankResult.flaggedAddresses.has(fb.clientAddress);
    const agentFlagged = rankResult.flaggedAddresses.has(fb.agentId);
    const isFlagged = submitterFlagged || agentFlagged;

    // Graduated discount: lower trust = heavier discount
    let weight = 1.0;
    if (isFlagged) {
      const submitterTrust = rankResult.trustScores.get(fb.clientAddress) ?? 0;
      const normalizedTrust = Math.min(submitterTrust / config.trustThreshold, 1.0);
      weight = config.discountFactor + (1.0 - config.discountFactor) * normalizedTrust;
    }

    return {
      feedbackId: fb.id,
      weight,
      flags: isFlagged ? ['sybilrank_low_trust' as MitigationFlag] : [],
    };
  });

  return { results, rankResult };
}
