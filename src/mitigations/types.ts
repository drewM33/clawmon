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
};

/** All mitigations disabled — used for the naive engine baseline */
export const DISABLED_MITIGATION_CONFIG: MitigationConfig = {
  graphAnalysis: { enabled: false, discountFactor: 0.1 },
  velocityCheck: { enabled: false, maxInWindow: 10, windowMs: 60_000, discountFactor: 0.5 },
  temporalDecay: { enabled: false, halfLifeMs: 86_400_000 },
  submitterWeighting: { enabled: false, recentThreshold: 0.2, discountFactor: 0.2 },
  anomalyDetection: { enabled: false, maxNewInWindow: 5, windowMs: 60_000, discountFactor: 0.1 },
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
  | 'anomaly_burst';
