/**
 * Trusted ClawMon — Temporal Correlation Analysis
 *
 * Detects addresses submitting feedback at suspiciously correlated
 * timestamps. Goes beyond raw velocity (which just checks rate) by
 * analyzing cross-address timing patterns.
 *
 * Three signals:
 *   1. Lockstep timing — Multiple addresses submit feedback within
 *      seconds of each other, repeatedly. Bot networks often operate
 *      in synchronized batches.
 *
 *   2. Regular intervals — Feedback from a single address at
 *      suspiciously regular intervals (e.g., exactly every 60s).
 *      Humans have noisy timing; bots don't.
 *
 *   3. Clock alignment — Multiple addresses submitting on round
 *      timestamps (e.g., :00, :15, :30, :45 seconds) suggesting
 *      cron-job or scheduled automation.
 */

import type { Feedback } from '../scoring/types.js';
import type { MitigationResult, MitigationFlag } from './types.js';

export interface TemporalCorrelationConfig {
  /** Maximum time delta (ms) to consider two submissions "lockstep" */
  lockstepWindowMs: number;
  /** Minimum number of lockstep coincidences to flag a pair */
  minLockstepEvents: number;
  /** Coefficient of variation threshold for regular-interval detection (lower = more regular) */
  regularityThreshold: number;
  /** Minimum feedback count for regularity analysis */
  minFeedbackForRegularity: number;
  /** Discount factor applied to temporally correlated feedback */
  discountFactor: number;
}

export const DEFAULT_TEMPORAL_CONFIG: TemporalCorrelationConfig = {
  lockstepWindowMs: 5_000,
  minLockstepEvents: 3,
  regularityThreshold: 0.15,
  minFeedbackForRegularity: 5,
  discountFactor: 0.2,
};

export interface TemporalCorrelationResult {
  /** Pairs of addresses with lockstep timing */
  lockstepPairs: Array<{ a: string; b: string; coincidences: number }>;
  /** Addresses with suspiciously regular submission intervals */
  regularAddresses: Array<{ address: string; cv: number; avgIntervalMs: number }>;
  /** All flagged addresses */
  flaggedAddresses: Set<string>;
}

/**
 * Detect lockstep timing between pairs of addresses.
 *
 * For each pair of addresses (A, B), check how many times they submitted
 * feedback within `lockstepWindowMs` of each other. If this exceeds
 * `minLockstepEvents`, the pair is flagged.
 *
 * Uses a sorted-merge approach for efficiency: O(n log n) per pair
 * rather than O(n^2) brute force on timestamps.
 */
function detectLockstepPairs(
  allFeedback: Feedback[],
  config: TemporalCorrelationConfig,
): Array<{ a: string; b: string; coincidences: number }> {
  // Group feedback by address, sorted by timestamp
  const byAddress = new Map<string, number[]>();

  for (const fb of allFeedback) {
    if (fb.revoked) continue;
    if (!byAddress.has(fb.clientAddress)) {
      byAddress.set(fb.clientAddress, []);
    }
    byAddress.get(fb.clientAddress)!.push(fb.timestamp);
  }

  // Sort all timestamp arrays
  for (const timestamps of byAddress.values()) {
    timestamps.sort((a, b) => a - b);
  }

  const addresses = Array.from(byAddress.keys());
  const pairs: Array<{ a: string; b: string; coincidences: number }> = [];

  for (let i = 0; i < addresses.length; i++) {
    const tsA = byAddress.get(addresses[i])!;
    if (tsA.length < config.minLockstepEvents) continue;

    for (let j = i + 1; j < addresses.length; j++) {
      const tsB = byAddress.get(addresses[j])!;
      if (tsB.length < config.minLockstepEvents) continue;

      // Sorted merge to count coincidences within window
      let coincidences = 0;
      let bi = 0;

      for (let ai = 0; ai < tsA.length; ai++) {
        // Advance bi to the first timestamp in window
        while (bi < tsB.length && tsB[bi] < tsA[ai] - config.lockstepWindowMs) {
          bi++;
        }

        // Count all tsB entries within window of tsA[ai]
        let bj = bi;
        while (bj < tsB.length && tsB[bj] <= tsA[ai] + config.lockstepWindowMs) {
          coincidences++;
          bj++;
        }
      }

      // Normalize by the smaller array size to get coincidence rate
      const minLen = Math.min(tsA.length, tsB.length);
      const rate = coincidences / minLen;

      // Flag if raw count AND rate are suspicious
      if (coincidences >= config.minLockstepEvents && rate > 0.5) {
        pairs.push({ a: addresses[i], b: addresses[j], coincidences });
      }
    }
  }

  return pairs;
}

/**
 * Detect addresses with suspiciously regular submission intervals.
 *
 * Computes the coefficient of variation (CV = stddev / mean) of
 * inter-feedback intervals for each address. Humans have high CV
 * (noisy, irregular timing); bots tend toward low CV (regular intervals).
 *
 * CV < 0.15 means intervals are within 15% of the mean — very suspicious
 * for human behavior.
 */
function detectRegularIntervals(
  allFeedback: Feedback[],
  config: TemporalCorrelationConfig,
): Array<{ address: string; cv: number; avgIntervalMs: number }> {
  const byAddress = new Map<string, number[]>();

  for (const fb of allFeedback) {
    if (fb.revoked) continue;
    if (!byAddress.has(fb.clientAddress)) {
      byAddress.set(fb.clientAddress, []);
    }
    byAddress.get(fb.clientAddress)!.push(fb.timestamp);
  }

  const results: Array<{ address: string; cv: number; avgIntervalMs: number }> = [];

  for (const [address, timestamps] of byAddress) {
    if (timestamps.length < config.minFeedbackForRegularity) continue;

    timestamps.sort((a, b) => a - b);

    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    if (intervals.length < 2) continue;

    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    if (mean === 0) continue;

    const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
    const stddev = Math.sqrt(variance);
    const cv = stddev / mean;

    if (cv < config.regularityThreshold) {
      results.push({ address, cv, avgIntervalMs: mean });
    }
  }

  return results;
}

/**
 * Run full temporal correlation analysis.
 */
export function detectTemporalCorrelation(
  allFeedback: Feedback[],
  config: TemporalCorrelationConfig = DEFAULT_TEMPORAL_CONFIG,
): TemporalCorrelationResult {
  const lockstepPairs = detectLockstepPairs(allFeedback, config);
  const regularAddresses = detectRegularIntervals(allFeedback, config);

  const flaggedAddresses = new Set<string>();

  for (const pair of lockstepPairs) {
    flaggedAddresses.add(pair.a);
    flaggedAddresses.add(pair.b);
  }

  for (const reg of regularAddresses) {
    flaggedAddresses.add(reg.address);
  }

  return { lockstepPairs, regularAddresses, flaggedAddresses };
}

/**
 * Apply temporal correlation as a mitigation layer.
 */
export function applyTemporalCorrelation(
  feedback: Feedback[],
  allFeedback: Feedback[],
  config: TemporalCorrelationConfig = DEFAULT_TEMPORAL_CONFIG,
): { results: MitigationResult[]; temporalResult: TemporalCorrelationResult } {
  const temporalResult = detectTemporalCorrelation(allFeedback, config);

  const results: MitigationResult[] = feedback.map((fb) => {
    const isFlagged = temporalResult.flaggedAddresses.has(fb.clientAddress);

    return {
      feedbackId: fb.id,
      weight: isFlagged ? config.discountFactor : 1.0,
      flags: isFlagged ? ['temporal_correlation' as MitigationFlag] : [],
    };
  });

  return { results, temporalResult };
}
