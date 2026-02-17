/**
 * Trusted ClawMon — Velocity Mitigation
 *
 * Detects rapid feedback bursts (>N feedback in a time window) and
 * behavioral score shifts (>30pt deviation from historical average).
 * Feedback in detected bursts is discounted.
 *
 * Maps to real-world incident: batch-registered sybil identities
 * submitting coordinated feedback waves.
 */

import type { Feedback } from '../scoring/types.js';
import type { MitigationResult, MitigationFlag } from './types.js';

// ---------------------------------------------------------------------------
// Velocity Spike Detection
// ---------------------------------------------------------------------------

/**
 * Detect feedback submitted in rapid bursts.
 *
 * Scans the feedback timeline with a sliding window. If more than
 * `maxInWindow` entries fall within `windowMs`, all entries in
 * that window are flagged.
 */
export function detectVelocitySpikes(
  feedback: Feedback[],
  maxInWindow: number,
  windowMs: number,
): Set<string> {
  if (feedback.length === 0) return new Set();

  // Sort by timestamp ascending
  const sorted = [...feedback]
    .filter((f) => !f.revoked)
    .sort((a, b) => a.timestamp - b.timestamp);

  const flaggedIds = new Set<string>();
  let windowStart = 0;

  for (let windowEnd = 0; windowEnd < sorted.length; windowEnd++) {
    // Advance window start to maintain window size
    while (
      windowStart < windowEnd &&
      sorted[windowEnd].timestamp - sorted[windowStart].timestamp > windowMs
    ) {
      windowStart++;
    }

    // Check if too many entries in this window
    const windowSize = windowEnd - windowStart + 1;
    if (windowSize > maxInWindow) {
      // Flag all entries in the current window
      for (let i = windowStart; i <= windowEnd; i++) {
        flaggedIds.add(sorted[i].id);
      }
    }
  }

  return flaggedIds;
}

// ---------------------------------------------------------------------------
// Behavioral Shift Detection (for laundering)
// ---------------------------------------------------------------------------

/**
 * Detect a behavioral shift in an agent's feedback pattern.
 *
 * Computes the historical average of feedback values, then checks if
 * recent feedback deviates significantly. Used to detect laundering:
 * a trusted skill that suddenly receives negative feedback.
 *
 * Returns the set of feedback IDs that are part of the "shift" period
 * (i.e., recent feedback that deviates from historical baseline).
 */
export function detectBehavioralShift(
  feedback: Feedback[],
  deviationThreshold: number = 30,
  recentWindowFraction: number = 0.3,
): { shifted: boolean; shiftMagnitude: number; recentFeedbackIds: Set<string> } {
  const active = feedback.filter((f) => !f.revoked);
  if (active.length < 5) {
    return { shifted: false, shiftMagnitude: 0, recentFeedbackIds: new Set() };
  }

  const sorted = [...active].sort((a, b) => a.timestamp - b.timestamp);
  const splitIndex = Math.floor(sorted.length * (1 - recentWindowFraction));

  const historical = sorted.slice(0, splitIndex);
  const recent = sorted.slice(splitIndex);

  if (historical.length === 0 || recent.length === 0) {
    return { shifted: false, shiftMagnitude: 0, recentFeedbackIds: new Set() };
  }

  const historicalAvg =
    historical.reduce((sum, f) => sum + f.value, 0) / historical.length;
  const recentAvg =
    recent.reduce((sum, f) => sum + f.value, 0) / recent.length;

  const magnitude = Math.abs(recentAvg - historicalAvg);
  const recentIds = new Set(recent.map((f) => f.id));

  return {
    shifted: magnitude >= deviationThreshold,
    shiftMagnitude: magnitude,
    recentFeedbackIds: recentIds,
  };
}

// ---------------------------------------------------------------------------
// Anomaly Detection (new submitter burst)
// ---------------------------------------------------------------------------

/**
 * Detect a burst of new submitters appearing in a short window.
 * Used for poison attack detection: when >N new addresses submit
 * feedback for the same agent within a time window.
 *
 * "New" means the address has no prior feedback in the full corpus
 * before the current window.
 */
export function detectNewSubmitterBurst(
  agentFeedback: Feedback[],
  allFeedback: Feedback[],
  maxNewInWindow: number,
  windowMs: number,
): Set<string> {
  // Find the first-seen timestamp for each address across all feedback
  const firstSeen = new Map<string, number>();
  for (const fb of allFeedback) {
    if (fb.revoked) continue;
    const existing = firstSeen.get(fb.clientAddress);
    if (existing === undefined || fb.timestamp < existing) {
      firstSeen.set(fb.clientAddress, fb.timestamp);
    }
  }

  // Get feedback for this specific agent, sorted by time
  const sorted = [...agentFeedback]
    .filter((f) => !f.revoked)
    .sort((a, b) => a.timestamp - b.timestamp);

  const flaggedIds = new Set<string>();

  // Sliding window to detect new-submitter bursts
  for (let i = 0; i < sorted.length; i++) {
    const windowEnd = sorted[i].timestamp;
    const windowBegin = windowEnd - windowMs;

    // Count new submitters in this window
    const newInWindow: Feedback[] = [];
    for (let j = 0; j <= i; j++) {
      if (sorted[j].timestamp < windowBegin) continue;
      const addr = sorted[j].clientAddress;
      const addrFirstSeen = firstSeen.get(addr) ?? sorted[j].timestamp;
      // "New" = first appearance is within this window
      if (addrFirstSeen >= windowBegin) {
        newInWindow.push(sorted[j]);
      }
    }

    if (newInWindow.length > maxNewInWindow) {
      for (const fb of newInWindow) {
        flaggedIds.add(fb.id);
      }
    }
  }

  return flaggedIds;
}

// ---------------------------------------------------------------------------
// Combined Velocity Analysis
// ---------------------------------------------------------------------------

/**
 * Apply all velocity-based mitigations and return per-feedback weights.
 */
export function applyVelocityMitigations(
  feedback: Feedback[],
  allFeedback: Feedback[],
  config: {
    velocityCheck: { maxInWindow: number; windowMs: number; discountFactor: number };
    anomalyDetection: { maxNewInWindow: number; windowMs: number; discountFactor: number };
  },
): MitigationResult[] {
  const velocityFlagged = detectVelocitySpikes(
    feedback,
    config.velocityCheck.maxInWindow,
    config.velocityCheck.windowMs,
  );

  const anomalyFlagged = detectNewSubmitterBurst(
    feedback,
    allFeedback,
    config.anomalyDetection.maxNewInWindow,
    config.anomalyDetection.windowMs,
  );

  return feedback.map((fb) => {
    const flags: MitigationFlag[] = [];
    let weight = 1.0;

    if (velocityFlagged.has(fb.id)) {
      flags.push('velocity_burst');
      weight = Math.min(weight, config.velocityCheck.discountFactor);
    }

    if (anomalyFlagged.has(fb.id)) {
      flags.push('anomaly_burst');
      weight = Math.min(weight, config.anomalyDetection.discountFactor);
    }

    return { feedbackId: fb.id, weight, flags };
  });
}
