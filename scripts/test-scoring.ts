/**
 * Trusted ClawMon — Scoring Engine Test Script
 *
 * Runs the scoring engine in pure local mode (no Monad connection) with
 * synthetic data to verify all mitigations work correctly.
 *
 * Run: npm run test:scoring
 *
 * Tests:
 *   1. Naive scorer — basic averaging and tier mapping
 *   2. Sybil detection — mutual feedback pair discount
 *   3. Velocity check — burst detection and discount
 *   4. Temporal decay — older feedback weighted less
 *   5. Submitter weighting — new submitters discounted
 *   6. Anomaly detection — new submitter burst discount
 *   7. Combined mitigations — all together
 */

import { computeSummary, computeWeightedAverage, groupByAgent } from '../src/scoring/engine.js';
import { computeHardenedSummary } from '../src/scoring/hardened.js';
import { detectMutualFeedback, detectSybilClusters } from '../src/mitigations/graph.js';
import { detectVelocitySpikes, detectBehavioralShift } from '../src/mitigations/velocity.js';
import { DEFAULT_MITIGATION_CONFIG, type MitigationConfig } from '../src/mitigations/types.js';
import type { Feedback } from '../src/scoring/types.js';
import { CREDIBILITY_WEIGHTS } from '../src/scoring/types.js';
import {
  determineCredibilityTier,
  annotateFeedbackCredibility,
  computeUsageWeightedSummary,
} from '../src/scoring/usage-weighted.js';
import {
  registerSkillPricing,
  processSkillPayment,
  getCallerReceiptsForSkill,
  hasPaymentHistory,
} from '../src/payments/x402.js';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertRange(value: number, min: number, max: number, message: string): void {
  assert(value >= min && value <= max, `${message} (${value.toFixed(2)} in [${min}, ${max}])`);
}

// ---------------------------------------------------------------------------
// Test Data Generators
// ---------------------------------------------------------------------------

let idCounter = 0;
function fb(
  agentId: string,
  clientAddress: string,
  value: number,
  timestamp?: number,
): Feedback {
  return {
    id: `test-${++idCounter}`,
    agentId,
    clientAddress,
    value,
    valueDecimals: 0,
    timestamp: timestamp ?? Date.now(),
    revoked: false,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Naive Scorer
// ---------------------------------------------------------------------------

function testNaiveScorer(): void {
  console.log('\n═══ Test 1: Naive Scorer ═══\n');

  // Uniform positive feedback → high score
  const positive = [
    fb('agent-1', 'user-a', 90),
    fb('agent-1', 'user-b', 85),
    fb('agent-1', 'user-c', 95),
    fb('agent-1', 'user-d', 88),
  ];
  const summary = computeSummary(positive);
  assert(summary.feedbackCount === 4, 'Count is 4');
  assertRange(summary.summaryValue, 88, 92, 'Average is ~89.5');
  assert(summary.tier === 'AA', `Tier is AA (got ${summary.tier})`);
  assert(summary.accessDecision === 'full_access', 'Access is full_access');

  // All low feedback → low score
  const negative = [
    fb('agent-2', 'user-a', 15),
    fb('agent-2', 'user-b', 20),
    fb('agent-2', 'user-c', 10),
  ];
  const negSummary = computeSummary(negative);
  assertRange(negSummary.summaryValue, 14, 16, 'Low average is ~15');
  assert(negSummary.tier === 'C', `Low tier is C (got ${negSummary.tier})`);
  assert(negSummary.accessDecision === 'denied', 'Low access is denied');

  // Empty feedback → default
  const empty = computeSummary([]);
  assert(empty.feedbackCount === 0, 'Empty count is 0');
  assert(empty.tier === 'C', 'Empty tier is C');

  // Revoked feedback filtered
  const withRevoked = [
    fb('agent-3', 'user-a', 90),
    { ...fb('agent-3', 'user-b', 10), revoked: true }, // Should be ignored
    fb('agent-3', 'user-c', 85),
  ];
  const revokedSummary = computeSummary(withRevoked);
  assert(revokedSummary.feedbackCount === 2, 'Revoked filtered: count is 2');
  assertRange(revokedSummary.summaryValue, 86, 89, 'Revoked filtered: avg ~87.5');
}

// ---------------------------------------------------------------------------
// Test 2: Sybil Detection (Graph Analysis)
// ---------------------------------------------------------------------------

function testSybilDetection(): void {
  console.log('\n═══ Test 2: Sybil Detection ═══\n');

  // Create mutual feedback: A rates agent-B, B rates agent-A
  const feedback = [
    fb('agent-B', 'addr-A', 95), // A rates B's agent
    fb('agent-A', 'addr-B', 95), // B rates A's agent — mutual!
    fb('agent-C', 'addr-D', 80), // D rates C — no mutual
  ];

  // Note: mutual detection checks if clientAddress X rates agentId Y
  // AND clientAddress Y rates agentId X.
  // Here: addr-A rates agent-B, and we need addr-B to rate agent-A (which is agent-A)
  // So the pair is (addr-A, agent-B) and (addr-B = "agent-B"?, agent-A)
  // Actually our implementation checks: rater addr-A rated agentId "agent-B"
  // Then checks if "agent-B" (as address) rated "addr-A" (as agentId)
  // So we need clientAddress="agent-B" rating agentId="addr-A"

  const mutualFeedback = [
    fb('skill-B', 'publisher-A', 95), // Publisher A rates skill B
    fb('skill-A', 'publisher-B', 95), // Publisher B rates skill A — MUTUAL
    fb('publisher-A', 'skill-B', 90), // This creates: skill-B rates publisher-A
  ];

  // Simpler test: direct mutual where address = agentId naming convention
  const sybilFeedback = [
    fb('sybil-2', 'sybil-1', 95), // sybil-1 rates sybil-2
    fb('sybil-1', 'sybil-2', 95), // sybil-2 rates sybil-1 — MUTUAL!
    fb('sybil-3', 'sybil-1', 90), // sybil-1 rates sybil-3
    fb('sybil-1', 'sybil-3', 90), // sybil-3 rates sybil-1 — MUTUAL!
    fb('legit-skill', 'honest-user', 80), // honest review
  ];

  const pairs = detectMutualFeedback(sybilFeedback);
  assert(pairs.length >= 2, `Found ${pairs.length} mutual pairs (expected ≥2)`);

  const clusters = detectSybilClusters(sybilFeedback);
  assert(clusters.length >= 1, `Found ${clusters.length} sybil clusters`);
  if (clusters.length > 0) {
    assert(clusters[0].size >= 2, `Largest cluster has ${clusters[0].size} members`);
  }

  // Hardened scoring should discount sybil feedback
  const sybilAgentFb = sybilFeedback.filter((f) => f.agentId === 'sybil-2');
  const config: MitigationConfig = {
    ...DEFAULT_MITIGATION_CONFIG,
    temporalDecay: { ...DEFAULT_MITIGATION_CONFIG.temporalDecay, enabled: false },
    submitterWeighting: { ...DEFAULT_MITIGATION_CONFIG.submitterWeighting, enabled: false },
    anomalyDetection: { ...DEFAULT_MITIGATION_CONFIG.anomalyDetection, enabled: false },
    velocityCheck: { ...DEFAULT_MITIGATION_CONFIG.velocityCheck, enabled: false },
  };

  const naive = computeSummary(sybilAgentFb);
  const hardened = computeHardenedSummary(sybilAgentFb, config, sybilFeedback);
  assert(
    hardened.summaryValue <= naive.summaryValue,
    `Hardened score (${hardened.summaryValue.toFixed(1)}) ≤ naive (${naive.summaryValue.toFixed(1)})`,
  );
}

// ---------------------------------------------------------------------------
// Test 3: Velocity Check
// ---------------------------------------------------------------------------

function testVelocityCheck(): void {
  console.log('\n═══ Test 3: Velocity Check ═══\n');

  const now = Date.now();

  // Normal pace: 1 review every 10 seconds (fine)
  const normalFeedback = Array.from({ length: 8 }, (_, i) =>
    fb('agent-vel', `user-${i}`, 80, now + i * 10_000),
  );
  const normalFlagged = detectVelocitySpikes(normalFeedback, 10, 60_000);
  assert(normalFlagged.size === 0, 'Normal pace: no flags');

  // Burst: 15 reviews in 30 seconds (exceeds 10 in 60s threshold)
  const burstFeedback = Array.from({ length: 15 }, (_, i) =>
    fb('agent-vel', `user-${i}`, 80, now + i * 2_000),
  );
  const burstFlagged = detectVelocitySpikes(burstFeedback, 10, 60_000);
  assert(burstFlagged.size > 0, `Burst detected: ${burstFlagged.size} flagged`);
}

// ---------------------------------------------------------------------------
// Test 4: Temporal Decay
// ---------------------------------------------------------------------------

function testTemporalDecay(): void {
  console.log('\n═══ Test 4: Temporal Decay ═══\n');

  const now = Date.now();
  const oneDay = 86_400_000;

  // Old positive feedback + recent negative feedback
  // Without decay: average of all → still positive
  // With decay: recent negative weighted more → score drops
  const feedback = [
    fb('agent-decay', 'user-a', 95, now - 7 * oneDay), // 7 days ago
    fb('agent-decay', 'user-b', 90, now - 6 * oneDay), // 6 days ago
    fb('agent-decay', 'user-c', 92, now - 5 * oneDay), // 5 days ago
    fb('agent-decay', 'user-d', 20, now - 1000),        // just now (negative)
    fb('agent-decay', 'user-e', 15, now - 500),         // just now (negative)
  ];

  const naive = computeSummary(feedback);
  const config: MitigationConfig = {
    ...DEFAULT_MITIGATION_CONFIG,
    graphAnalysis: { ...DEFAULT_MITIGATION_CONFIG.graphAnalysis, enabled: false },
    velocityCheck: { ...DEFAULT_MITIGATION_CONFIG.velocityCheck, enabled: false },
    submitterWeighting: { ...DEFAULT_MITIGATION_CONFIG.submitterWeighting, enabled: false },
    anomalyDetection: { ...DEFAULT_MITIGATION_CONFIG.anomalyDetection, enabled: false },
    temporalDecay: { enabled: true, halfLifeMs: oneDay },
  };

  const hardened = computeHardenedSummary(feedback, config, feedback);

  assert(
    hardened.summaryValue < naive.summaryValue,
    `Temporal decay lowers score: ${hardened.summaryValue.toFixed(1)} < ${naive.summaryValue.toFixed(1)}`,
  );
  // With heavy decay on old positives, the recent negatives should dominate
  assert(
    hardened.summaryValue < 60,
    `Decayed score is below 60 (got ${hardened.summaryValue.toFixed(1)})`,
  );
}

// ---------------------------------------------------------------------------
// Test 5: Submitter Weighting
// ---------------------------------------------------------------------------

function testSubmitterWeighting(): void {
  console.log('\n═══ Test 5: Submitter Weighting ═══\n');

  const now = Date.now();

  // Create a scenario: established reviewers give honest scores,
  // then a wave of new reviewers gives high scores (poison)
  const allFeedback = [
    // Old established reviewers (various agents)
    fb('other-agent', 'veteran-1', 80, now - 30 * 86_400_000),
    fb('other-agent', 'veteran-2', 75, now - 25 * 86_400_000),
    fb('other-agent', 'veteran-3', 70, now - 20 * 86_400_000),
    // Target agent: veteran reviews
    fb('target', 'veteran-1', 85, now - 10 * 86_400_000),
    fb('target', 'veteran-2', 80, now - 8 * 86_400_000),
    // Target agent: new reviewers (poison attempt)
    fb('target', 'newbie-1', 10, now - 1000),
    fb('target', 'newbie-2', 5, now - 800),
    fb('target', 'newbie-3', 15, now - 600),
  ];

  const targetFeedback = allFeedback.filter((f) => f.agentId === 'target');

  const config: MitigationConfig = {
    ...DEFAULT_MITIGATION_CONFIG,
    graphAnalysis: { ...DEFAULT_MITIGATION_CONFIG.graphAnalysis, enabled: false },
    velocityCheck: { ...DEFAULT_MITIGATION_CONFIG.velocityCheck, enabled: false },
    temporalDecay: { ...DEFAULT_MITIGATION_CONFIG.temporalDecay, enabled: false },
    anomalyDetection: { ...DEFAULT_MITIGATION_CONFIG.anomalyDetection, enabled: false },
    submitterWeighting: { enabled: true, recentThreshold: 0.5, discountFactor: 0.2 },
  };

  const naive = computeSummary(targetFeedback);
  const hardened = computeHardenedSummary(targetFeedback, config, allFeedback);

  assert(
    hardened.summaryValue > naive.summaryValue,
    `New-submitter discount protects score: ${hardened.summaryValue.toFixed(1)} > ${naive.summaryValue.toFixed(1)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 6: Behavioral Shift Detection
// ---------------------------------------------------------------------------

function testBehavioralShift(): void {
  console.log('\n═══ Test 6: Behavioral Shift Detection ═══\n');

  const now = Date.now();
  const oneDay = 86_400_000;

  // Agent with good history then sudden bad reviews
  const feedback = [
    fb('laundered', 'u1', 90, now - 10 * oneDay),
    fb('laundered', 'u2', 88, now - 9 * oneDay),
    fb('laundered', 'u3', 92, now - 8 * oneDay),
    fb('laundered', 'u4', 85, now - 7 * oneDay),
    fb('laundered', 'u5', 87, now - 6 * oneDay),
    // Sudden shift
    fb('laundered', 'u6', 20, now - 1 * oneDay),
    fb('laundered', 'u7', 15, now - 1 * oneDay + 1000),
    fb('laundered', 'u8', 10, now - 1 * oneDay + 2000),
  ];

  const result = detectBehavioralShift(feedback, 30, 0.3);
  assert(result.shifted, `Shift detected (magnitude: ${result.shiftMagnitude.toFixed(1)})`);
  assert(result.shiftMagnitude > 50, `Shift magnitude > 50 (got ${result.shiftMagnitude.toFixed(1)})`);
  assert(result.recentFeedbackIds.size > 0, `Recent feedback IDs identified`);

  // Stable agent: no shift
  const stable = [
    fb('stable', 'u1', 80, now - 5 * oneDay),
    fb('stable', 'u2', 82, now - 4 * oneDay),
    fb('stable', 'u3', 78, now - 3 * oneDay),
    fb('stable', 'u4', 81, now - 2 * oneDay),
    fb('stable', 'u5', 79, now - 1 * oneDay),
  ];
  const stableResult = detectBehavioralShift(stable, 30, 0.3);
  assert(!stableResult.shifted, 'Stable agent: no shift detected');
}

// ---------------------------------------------------------------------------
// Test 7: Combined Mitigations
// ---------------------------------------------------------------------------

function testCombinedMitigations(): void {
  console.log('\n═══ Test 7: Combined Mitigations ═══\n');

  const now = Date.now();
  const oneHour = 3_600_000;

  // Complex scenario: sybil ring + velocity burst + new submitters
  // Honest reviews are RECENT (within hours) so temporal decay doesn't kill them.
  // Sybil reviews arrive in a burst to inflate the score.
  const allFeedback = [
    // Established ecosystem (recent-ish feedback for context, so veterans are "old" submitters)
    fb('other-1', 'veteran-1', 80, now - 48 * oneHour),
    fb('other-1', 'veteran-2', 75, now - 36 * oneHour),
    fb('other-2', 'veteran-3', 70, now - 24 * oneHour),

    // Target skill: honest reviews from established reviewers (recent)
    fb('target-skill', 'veteran-1', 82, now - 6 * oneHour),
    fb('target-skill', 'veteran-2', 78, now - 5 * oneHour),
    fb('target-skill', 'veteran-3', 85, now - 4 * oneHour),
    fb('target-skill', 'veteran-1', 80, now - 3 * oneHour),
    fb('target-skill', 'veteran-2', 83, now - 2 * oneHour),

    // Sybil attack: burst of 12 fake reviews in <1 second from brand new addresses
    fb('target-skill', 'sybil-A', 99, now - 1000),
    fb('target-skill', 'sybil-B', 98, now - 900),
    fb('target-skill', 'sybil-C', 97, now - 800),
    fb('target-skill', 'sybil-D', 99, now - 700),
    fb('target-skill', 'sybil-E', 98, now - 600),
    fb('target-skill', 'sybil-F', 97, now - 500),
    fb('target-skill', 'sybil-G', 99, now - 400),
    fb('target-skill', 'sybil-H', 98, now - 300),
    fb('target-skill', 'sybil-I', 97, now - 200),
    fb('target-skill', 'sybil-J', 99, now - 100),
    fb('target-skill', 'sybil-K', 98, now - 50),
    fb('target-skill', 'sybil-L', 97, now - 25),

    // Sybil mutual pairs (so graph analysis catches them)
    fb('sybil-A', 'sybil-B', 99, now - 950),
    fb('sybil-B', 'sybil-A', 99, now - 850),
    fb('sybil-C', 'sybil-D', 99, now - 750),
    fb('sybil-D', 'sybil-C', 99, now - 650),
  ];

  const targetFb = allFeedback.filter((f) => f.agentId === 'target-skill');

  // Use config WITHOUT temporal decay so the test focuses on velocity + submitter + graph
  const config: MitigationConfig = {
    ...DEFAULT_MITIGATION_CONFIG,
    temporalDecay: { ...DEFAULT_MITIGATION_CONFIG.temporalDecay, enabled: false },
  };

  const naive = computeSummary(targetFb);
  const hardened = computeHardenedSummary(targetFb, config, allFeedback);

  console.log(`  Naive:    score=${naive.summaryValue.toFixed(1)} tier=${naive.tier} count=${naive.feedbackCount}`);
  console.log(`  Hardened: score=${hardened.summaryValue.toFixed(1)} tier=${hardened.tier} count=${hardened.feedbackCount}`);

  // Naive should be inflated by sybil votes
  assert(naive.summaryValue > 90, `Naive inflated by sybils: ${naive.summaryValue.toFixed(1)} > 90`);

  // Hardened should be lower — velocity check + submitter weighting + anomaly detection
  // discount the burst of new-submitter sybil reviews
  assert(
    hardened.summaryValue < naive.summaryValue,
    `Hardened resists inflation: ${hardened.summaryValue.toFixed(1)} < ${naive.summaryValue.toFixed(1)}`,
  );

  // Hardened should be closer to honest reviews (~82) than to sybil-inflated (~95)
  const midpoint = (82 + naive.summaryValue) / 2;
  assert(
    hardened.summaryValue < midpoint,
    `Hardened closer to honest score: ${hardened.summaryValue.toFixed(1)} < midpoint ${midpoint.toFixed(1)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 8: Credibility Tier Determination
// ---------------------------------------------------------------------------

function testCredibilityTierDetermination(): void {
  console.log('\n═══ Test 8: Credibility Tier Determination ═══\n');

  // Register a skill for payments
  registerSkillPricing('tier-test-skill', 'test-publisher', 'A');

  // Create payment receipts for paid reviewers
  processSkillPayment('tier-test-skill', 'paid-staked-user');
  processSkillPayment('tier-test-skill', 'paid-staked-user');
  processSkillPayment('tier-test-skill', 'paid-staked-user');

  processSkillPayment('tier-test-skill', 'paid-unstaked-user');
  processSkillPayment('tier-test-skill', 'paid-unstaked-user');

  // Staked addresses
  const stakedAddresses = new Set(['paid-staked-user', 'staked-but-not-paid']);

  // --- Paid + Staked tier ---
  const paidStaked = determineCredibilityTier('paid-staked-user', 'tier-test-skill', stakedAddresses);
  assert(paidStaked.tier === 'paid_and_staked', `Paid+staked tier correct (got ${paidStaked.tier})`);
  assertRange(paidStaked.weight, 5.0, 10.0, 'Paid+staked weight in 5-10x range');
  assert(paidStaked.paymentCount === 3, `Payment count correct (got ${paidStaked.paymentCount})`);
  assert(paidStaked.isStaked === true, 'Is staked');

  // --- Paid + Unstaked tier ---
  const paidUnstaked = determineCredibilityTier('paid-unstaked-user', 'tier-test-skill', stakedAddresses);
  assert(paidUnstaked.tier === 'paid_unstaked', `Paid+unstaked tier correct (got ${paidUnstaked.tier})`);
  assertRange(paidUnstaked.weight, 1.0, 2.0, 'Paid+unstaked weight in 1-2x range');
  assert(paidUnstaked.paymentCount === 2, `Payment count correct (got ${paidUnstaked.paymentCount})`);
  assert(paidUnstaked.isStaked === false, 'Is not staked');

  // --- Unpaid + Unstaked tier ---
  const unpaidUnstaked = determineCredibilityTier('random-anon', 'tier-test-skill', stakedAddresses);
  assert(unpaidUnstaked.tier === 'unpaid_unstaked', `Unpaid+unstaked tier correct (got ${unpaidUnstaked.tier})`);
  assert(unpaidUnstaked.weight === 0.1, `Unpaid+unstaked weight is 0.1x (got ${unpaidUnstaked.weight})`);
  assert(unpaidUnstaked.paymentCount === 0, 'No payments');
  assert(unpaidUnstaked.isStaked === false, 'Is not staked');

  // --- Edge case: staked but no payments = unpaid_unstaked ---
  const stakedNoPay = determineCredibilityTier('staked-but-not-paid', 'tier-test-skill', stakedAddresses);
  assert(stakedNoPay.tier === 'unpaid_unstaked', `Staked-only is still unpaid_unstaked (got ${stakedNoPay.tier})`);
}

// ---------------------------------------------------------------------------
// Test 9: Verified User Badge Annotation
// ---------------------------------------------------------------------------

function testVerifiedUserBadge(): void {
  console.log('\n═══ Test 9: Verified User Badge ═══\n');

  // Reuse the payment data from test 8
  const feedback = [
    fb('tier-test-skill', 'paid-staked-user', 92),
    fb('tier-test-skill', 'paid-unstaked-user', 85),
    fb('tier-test-skill', 'random-anon', 70),
  ];

  const stakedAddresses = new Set(['paid-staked-user']);
  const annotated = annotateFeedbackCredibility(feedback, stakedAddresses);

  // Paid + staked → verified
  const paidStakedFb = annotated.find(f => f.clientAddress === 'paid-staked-user');
  assert(paidStakedFb?.verifiedUser === true, 'Paid+staked shows Verified User badge');
  assert(paidStakedFb?.credibilityTier === 'paid_and_staked', 'Correct tier annotation');
  assertRange(paidStakedFb?.credibilityWeight ?? 0, 5.0, 10.0, 'Correct weight annotation');

  // Paid + unstaked → verified
  const paidUnstakedFb = annotated.find(f => f.clientAddress === 'paid-unstaked-user');
  assert(paidUnstakedFb?.verifiedUser === true, 'Paid+unstaked shows Verified User badge');
  assert(paidUnstakedFb?.credibilityTier === 'paid_unstaked', 'Correct tier annotation');
  assertRange(paidUnstakedFb?.credibilityWeight ?? 0, 1.0, 2.0, 'Correct weight annotation');

  // Unpaid → no badge
  const unpaidFb = annotated.find(f => f.clientAddress === 'random-anon');
  assert(unpaidFb?.verifiedUser === false, 'Unpaid+unstaked has NO Verified User badge');
  assert(unpaidFb?.credibilityTier === 'unpaid_unstaked', 'Correct tier annotation');
  assert(unpaidFb?.credibilityWeight === 0.1, 'Correct weight: 0.1x');
}

// ---------------------------------------------------------------------------
// Test 10: Usage-Weighted Scoring Impact
// ---------------------------------------------------------------------------

function testUsageWeightedScoring(): void {
  console.log('\n═══ Test 10: Usage-Weighted Scoring ═══\n');

  // Register a new skill for this test
  registerSkillPricing('usage-test-skill', 'test-pub', 'BBB');

  // Create payment history: verified users paid for the skill
  processSkillPayment('usage-test-skill', 'verified-high-1');
  processSkillPayment('usage-test-skill', 'verified-high-1');
  processSkillPayment('usage-test-skill', 'verified-high-1');
  processSkillPayment('usage-test-skill', 'verified-high-2');
  processSkillPayment('usage-test-skill', 'verified-high-2');

  const stakedAddresses = new Set(['verified-high-1']);

  // Scenario: verified users give high scores, unverified give low scores
  // Without usage weighting: average would be low due to many unverified negatives
  // With usage weighting: verified high scores get 5-10x weight, unverified get 0.1x
  const now = Date.now();
  const feedback = [
    // Verified paid+staked user: high score (5-10x weight)
    fb('usage-test-skill', 'verified-high-1', 95, now - 1000),
    // Verified paid user: high score (1-2x weight)
    fb('usage-test-skill', 'verified-high-2', 90, now - 2000),
    // Unverified users: low scores (0.1x weight each)
    fb('usage-test-skill', 'anon-low-1', 20, now - 3000),
    fb('usage-test-skill', 'anon-low-2', 15, now - 4000),
    fb('usage-test-skill', 'anon-low-3', 25, now - 5000),
    fb('usage-test-skill', 'anon-low-4', 10, now - 6000),
    fb('usage-test-skill', 'anon-low-5', 30, now - 7000),
  ];

  const naive = computeSummary(feedback);
  const { summary: usageWeighted, tierBreakdown } = computeUsageWeightedSummary(
    feedback,
    stakedAddresses,
    DEFAULT_MITIGATION_CONFIG,
    feedback,
  );

  console.log(`  Naive:          score=${naive.summaryValue.toFixed(1)} tier=${naive.tier}`);
  console.log(`  Usage-Weighted: score=${usageWeighted.summaryValue.toFixed(1)} tier=${usageWeighted.tier}`);
  console.log(`  Tier Breakdown:`);
  console.log(`    Paid+Staked:   ${tierBreakdown.paidAndStaked.count} reviews, avg weight ${tierBreakdown.paidAndStaked.avgWeight}`);
  console.log(`    Paid+Unstaked: ${tierBreakdown.paidUnstaked.count} reviews, avg weight ${tierBreakdown.paidUnstaked.avgWeight}`);
  console.log(`    Unpaid:        ${tierBreakdown.unpaidUnstaked.count} reviews, avg weight ${tierBreakdown.unpaidUnstaked.avgWeight}`);
  console.log(`  Weight Differential: ${tierBreakdown.weightDifferential}x`);

  // Naive score should be dragged down by the many low unverified scores
  assert(naive.summaryValue < 50, `Naive score dragged down by unverified: ${naive.summaryValue.toFixed(1)} < 50`);

  // Usage-weighted should be higher because verified high scores carry more weight
  assert(
    usageWeighted.summaryValue > naive.summaryValue,
    `Usage-weighted resists unverified spam: ${usageWeighted.summaryValue.toFixed(1)} > ${naive.summaryValue.toFixed(1)}`,
  );

  // Tier breakdown should reflect correct counts
  assert(tierBreakdown.paidAndStaked.count === 1, `Paid+staked count is 1 (got ${tierBreakdown.paidAndStaked.count})`);
  assert(tierBreakdown.paidUnstaked.count === 1, `Paid+unstaked count is 1 (got ${tierBreakdown.paidUnstaked.count})`);
  assert(tierBreakdown.unpaidUnstaked.count === 5, `Unpaid count is 5 (got ${tierBreakdown.unpaidUnstaked.count})`);

  // Verified count
  assert(tierBreakdown.totalVerified === 2, `Total verified is 2 (got ${tierBreakdown.totalVerified})`);
  assert(tierBreakdown.totalUnverified === 5, `Total unverified is 5 (got ${tierBreakdown.totalUnverified})`);

  // Weight differential should be significant (5x+ / 0.1 = 50x+)
  assert(
    tierBreakdown.weightDifferential >= 10,
    `Weight differential ≥ 10x (got ${tierBreakdown.weightDifferential}x)`,
  );
}

// ---------------------------------------------------------------------------
// Test 11: Payment Record Cross-Reference
// ---------------------------------------------------------------------------

function testPaymentCrossReference(): void {
  console.log('\n═══ Test 11: Payment Cross-Reference ═══\n');

  // Verify payment lookup functions
  const receipts = getCallerReceiptsForSkill('tier-test-skill', 'paid-staked-user');
  assert(receipts.length === 3, `Found 3 receipts for paid-staked-user (got ${receipts.length})`);
  assert(receipts[0].agentId === 'tier-test-skill', 'Receipt agentId matches');
  assert(receipts[0].caller === 'paid-staked-user', 'Receipt caller matches');

  const noReceipts = getCallerReceiptsForSkill('tier-test-skill', 'random-anon');
  assert(noReceipts.length === 0, 'No receipts for unpaid user');

  const hasPaid = hasPaymentHistory('paid-staked-user');
  assert(hasPaid === true, 'hasPaymentHistory returns true for paid user');

  const hasNotPaid = hasPaymentHistory('never-paid-ever');
  assert(hasNotPaid === false, 'hasPaymentHistory returns false for unpaid user');
}

// ---------------------------------------------------------------------------
// Test 12: Credibility Weight Configuration
// ---------------------------------------------------------------------------

function testCredibilityWeightConfig(): void {
  console.log('\n═══ Test 12: Credibility Weight Configuration ═══\n');

  // Verify weight ranges
  const paidStakedConfig = CREDIBILITY_WEIGHTS.paid_and_staked;
  assert(paidStakedConfig.minWeight === 5.0, `Paid+staked min weight is 5.0 (got ${paidStakedConfig.minWeight})`);
  assert(paidStakedConfig.maxWeight === 10.0, `Paid+staked max weight is 10.0 (got ${paidStakedConfig.maxWeight})`);
  assert(paidStakedConfig.verifiedBadge === true, 'Paid+staked has verified badge');

  const paidUnstakedConfig = CREDIBILITY_WEIGHTS.paid_unstaked;
  assert(paidUnstakedConfig.minWeight === 1.0, `Paid+unstaked min weight is 1.0 (got ${paidUnstakedConfig.minWeight})`);
  assert(paidUnstakedConfig.maxWeight === 2.0, `Paid+unstaked max weight is 2.0 (got ${paidUnstakedConfig.maxWeight})`);
  assert(paidUnstakedConfig.verifiedBadge === true, 'Paid+unstaked has verified badge');

  const unpaidConfig = CREDIBILITY_WEIGHTS.unpaid_unstaked;
  assert(unpaidConfig.minWeight === 0.1, `Unpaid min weight is 0.1 (got ${unpaidConfig.minWeight})`);
  assert(unpaidConfig.maxWeight === 0.1, `Unpaid max weight is 0.1 (got ${unpaidConfig.maxWeight})`);
  assert(unpaidConfig.verifiedBadge === false, 'Unpaid has NO verified badge');

  // Weight ratio: paid+staked max / unpaid = 100x
  const maxRatio = paidStakedConfig.maxWeight / unpaidConfig.minWeight;
  assert(maxRatio === 100, `Max weight ratio is 100x (got ${maxRatio})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   Trusted ClawMon — Scoring Engine Tests      ║');
  console.log('╚═══════════════════════════════════════════════╝');

  testNaiveScorer();
  testSybilDetection();
  testVelocityCheck();
  testTemporalDecay();
  testSubmitterWeighting();
  testBehavioralShift();
  testCombinedMitigations();
  testCredibilityTierDetermination();
  testVerifiedUserBadge();
  testUsageWeightedScoring();
  testPaymentCrossReference();
  testCredibilityWeightConfig();

  console.log('\n' + '═'.repeat(50));
  console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('═'.repeat(50));

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main();
