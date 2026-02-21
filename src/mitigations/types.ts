/**
 * Trusted ClawMon — Mitigation Types
 *
 * Configuration for the hardened scoring engine's mitigation toggles.
 * Each mitigation can be independently enabled/disabled via the dashboard.
 */

export interface MitigationConfig {
  /** Sybil: detect mutual feedback pairs, discount by discountFactor */
  graphAnalysis: {
    enabled: boolean;
    /** Factor to multiply sybil-flagged feedback by (0.1 = 90% discount) */
    discountFactor: number;
  };

  /** Sybil/General: detect rapid feedback bursts */
  velocityCheck: {
    enabled: boolean;
    /** Max feedback entries in the time window before triggering */
    maxInWindow: number;
    /** Time window in milliseconds */
    windowMs: number;
    /** Discount factor applied to feedback in a burst (0.5 = 50% discount) */
    discountFactor: number;
  };

  /** Launder: exponential decay on older feedback */
  temporalDecay: {
    enabled: boolean;
    /** Half-life in milliseconds (1 day = 86400000) */
    halfLifeMs: number;
  };

  /** Poison: discount feedback from new/recent submitters */
  submitterWeighting: {
    enabled: boolean;
    /** What fraction of submitters are considered "recent" (0.2 = bottom 20%) */
    recentThreshold: number;
    /** Discount factor for recent submitters (0.2 = 80% discount) */
    discountFactor: number;
  };

  /** Poison: discount when many new submitters appear in a short burst */
  anomalyDetection: {
    enabled: boolean;
    /** Max new submitters in the time window before triggering */
    maxNewInWindow: number;
    /** Time window in milliseconds */
    windowMs: number;
    /** Discount factor applied to anomalous feedback (0.1 = 90% discount) */
    discountFactor: number;
  };

  /** SybilRank: random walk trust propagation from seed nodes (Yu et al. 2008) */
  sybilRank: {
    enabled: boolean;
    /** Power iteration rounds (O(log n) recommended) */
    iterations: number;
    /** Trust threshold — addresses below this are flagged (0-1) */
    trustThreshold: number;
    /** Discount factor for flagged feedback */
    discountFactor: number;
    /** Seed selection strategy */
    seedStrategy: 'uniform' | 'degree_weighted';
  };

  /** Jaccard: behavioral fingerprinting via reviewer overlap clustering */
  jaccardSimilarity: {
    enabled: boolean;
    /** Minimum Jaccard similarity to consider a pair coordinated (0-1) */
    similarityThreshold: number;
    /** Minimum cluster size to flag */
    minClusterSize: number;
    /** Minimum agents reviewed per address to be analyzed */
    minAgentsReviewed: number;
    /** Discount factor for flagged feedback */
    discountFactor: number;
  };

  /** Temporal: cross-address timing correlation (lockstep + regularity) */
  temporalCorrelation: {
    enabled: boolean;
    /** Max time delta (ms) for lockstep detection */
    lockstepWindowMs: number;
    /** Minimum lockstep coincidences to flag a pair */
    minLockstepEvents: number;
    /** CV threshold for regular-interval detection (lower = more regular) */
    regularityThreshold: number;
    /** Minimum feedback count for regularity analysis */
    minFeedbackForRegularity: number;
    /** Discount factor for flagged feedback */
    discountFactor: number;
  };
}

/** Default mitigation config — all mitigations ON with spec-recommended values */
export const DEFAULT_MITIGATION_CONFIG: MitigationConfig = {
  graphAnalysis: {
    enabled: true,
    discountFactor: 0.1,       // 90% discount on sybil-flagged pairs
  },
  velocityCheck: {
    enabled: true,
    maxInWindow: 10,           // >10 feedback in window → triggered
    windowMs: 60_000,          // 60 seconds
    discountFactor: 0.5,       // 50% discount
  },
  temporalDecay: {
    enabled: true,
    halfLifeMs: 86_400_000,    // 1-day half-life
  },
  submitterWeighting: {
    enabled: true,
    recentThreshold: 0.2,      // Bottom 20% of submitters by first-seen
    discountFactor: 0.2,       // 80% discount for recent submitters
  },
  anomalyDetection: {
    enabled: true,
    maxNewInWindow: 5,         // >5 new submitters in window → triggered
    windowMs: 60_000,          // 60 seconds
    discountFactor: 0.1,       // 90% discount
  },
  sybilRank: {
    enabled: true,
    iterations: 10,
    trustThreshold: 0.2,
    discountFactor: 0.1,       // 90% discount on low-trust addresses
    seedStrategy: 'degree_weighted',
  },
  jaccardSimilarity: {
    enabled: true,
    similarityThreshold: 0.7,
    minClusterSize: 3,
    minAgentsReviewed: 2,
    discountFactor: 0.15,      // 85% discount on coordinated clusters
  },
  temporalCorrelation: {
    enabled: true,
    lockstepWindowMs: 5_000,
    minLockstepEvents: 3,
    regularityThreshold: 0.15,
    minFeedbackForRegularity: 5,
    discountFactor: 0.2,       // 80% discount on temporally correlated
  },
};

/** All mitigations disabled — used for the naive engine baseline */
export const DISABLED_MITIGATION_CONFIG: MitigationConfig = {
  graphAnalysis: { enabled: false, discountFactor: 0.1 },
  velocityCheck: { enabled: false, maxInWindow: 10, windowMs: 60_000, discountFactor: 0.5 },
  temporalDecay: { enabled: false, halfLifeMs: 86_400_000 },
  submitterWeighting: { enabled: false, recentThreshold: 0.2, discountFactor: 0.2 },
  anomalyDetection: { enabled: false, maxNewInWindow: 5, windowMs: 60_000, discountFactor: 0.1 },
  sybilRank: { enabled: false, iterations: 10, trustThreshold: 0.2, discountFactor: 0.1, seedStrategy: 'degree_weighted' },
  jaccardSimilarity: { enabled: false, similarityThreshold: 0.7, minClusterSize: 3, minAgentsReviewed: 2, discountFactor: 0.15 },
  temporalCorrelation: { enabled: false, lockstepWindowMs: 5_000, minLockstepEvents: 3, regularityThreshold: 0.15, minFeedbackForRegularity: 5, discountFactor: 0.2 },
};

/** Result of a mitigation analysis pass */
export interface MitigationResult {
  /** Original feedback ID */
  feedbackId: string;
  /** Weight multiplier to apply (0.0–1.0, where 1.0 = no discount) */
  weight: number;
  /** Which mitigations flagged this feedback */
  flags: MitigationFlag[];
}

export type MitigationFlag =
  | 'sybil_mutual_feedback'
  | 'velocity_burst'
  | 'temporal_decay'
  | 'new_submitter'
  | 'anomaly_burst'
  | 'sybilrank_low_trust'
  | 'jaccard_coordinated'
  | 'temporal_correlation';
