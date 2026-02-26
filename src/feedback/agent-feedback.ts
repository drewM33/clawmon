/**
 * Trusted ClawMon — Agent-to-Agent Feedback (Phase 5)
 *
 * Agents submit feedback on other agents' skills via ERC-8004 ReputationRegistry.
 * Uses tag1="agent-review" and tag2=reviewerAgentId for attribution.
 *
 * Key rules:
 *   - Self-feedback is blocked (reviewer cannot review own skill)
 *   - Feedback is weighted by reviewer's reputation tier + staking status
 *   - FeedbackURI points to AgentFeedbackFile with automated assessment
 */

import { ethers } from 'ethers';
import { giveFeedback as erc8004GiveFeedback, getAgentOwner, getAgentRegistry } from '../erc8004/client.js';
import { getSigner } from '../monad/client.js';
import { getUserReputation } from '../scoring/reputation-tiers.js';
import { computeAgentReviewWeight } from '../scoring/agent-weighted.js';
import type { AgentReviewParams, AgentReviewResult, AgentFeedbackFile } from './types.js';
import { AGENT_REVIEW_TAG1 } from './types.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an agent review request is well-formed and not self-feedback.
 * Throws descriptive errors on invalid input.
 */
export async function validateAgentReview(params: AgentReviewParams): Promise<void> {
  // Value range
  if (params.value < 0 || params.value > 100) {
    throw new Error('INVALID_VALUE: feedback value must be 0-100');
  }

  // Self-feedback prevention: reviewer and target must be different agents
  if (params.reviewerAgentId === params.targetAgentId) {
    throw new Error('SELF_FEEDBACK: agent cannot review its own skill');
  }

  // Automated assessment score ranges
  const { automatedAssessment } = params;
  if (
    automatedAssessment.securityScore < 0 || automatedAssessment.securityScore > 100 ||
    automatedAssessment.reliabilityScore < 0 || automatedAssessment.reliabilityScore > 100 ||
    automatedAssessment.performanceScore < 0 || automatedAssessment.performanceScore > 100
  ) {
    throw new Error('INVALID_ASSESSMENT: all assessment scores must be 0-100');
  }

  // Verify reviewer owns the reviewerAgentId (wallet check)
  const signer = getSigner();
  const reviewerOwner = await getAgentOwner(params.reviewerAgentId);
  if (reviewerOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error('NOT_REVIEWER_OWNER: signer does not own the reviewer agent');
  }
}

// ---------------------------------------------------------------------------
// Submit Agent Review
// ---------------------------------------------------------------------------

/**
 * Submit agent-to-agent feedback on the ERC-8004 ReputationRegistry.
 *
 * Flow:
 *   1. Validate params (range, self-feedback, ownership)
 *   2. Compute reviewer weight from reputation tier + stake status
 *   3. Build tag2 = reviewer agentId for attribution
 *   4. Call giveFeedback() on ReputationRegistry with tag1="agent-review"
 *   5. Return result with weight + tier info
 */
export async function submitAgentReview(
  params: AgentReviewParams,
): Promise<AgentReviewResult> {
  // 1. Validate
  await validateAgentReview(params);

  // 2. Compute reviewer weight
  const signer = getSigner();
  const { weight, tier } = computeAgentReviewWeight(signer.address);

  // 3. Build feedback hash from assessment (deterministic)
  const assessmentJson = JSON.stringify(params.automatedAssessment);
  const feedbackHash = ethers.id(assessmentJson);

  // 4. Submit via ERC-8004
  const { txHash, feedbackIndex } = await erc8004GiveFeedback({
    agentId: params.targetAgentId,
    value: params.value,
    valueDecimals: 0,
    tag1: AGENT_REVIEW_TAG1,
    tag2: String(params.reviewerAgentId),
    endpoint: params.endpoint ?? '',
    feedbackURI: params.feedbackURI ?? '',
    feedbackHash,
  });

  // 5. Return result
  return {
    targetAgentId: params.targetAgentId,
    reviewerAgentId: params.reviewerAgentId,
    reviewerAddress: signer.address,
    value: params.value,
    feedbackIndex,
    txHash,
    reviewerWeight: weight,
    reviewerTier: tier,
  };
}

// ---------------------------------------------------------------------------
// Build Feedback File
// ---------------------------------------------------------------------------

/**
 * Build a compliant AgentFeedbackFile for storage at feedbackURI.
 */
export function buildAgentFeedbackFile(
  params: AgentReviewParams,
  clientAddress: string,
): AgentFeedbackFile {
  return {
    agentRegistry: getAgentRegistry(),
    agentId: params.targetAgentId,
    clientAddress: `eip155:10143:${clientAddress}`,
    createdAt: new Date().toISOString(),
    value: params.value,
    valueDecimals: 0,
    tag1: AGENT_REVIEW_TAG1,
    tag2: String(params.reviewerAgentId),
    endpoint: params.endpoint,
    reviewerAgentId: params.reviewerAgentId,
    reviewerSkillUsed: params.reviewerSkillUsed,
    automatedAssessment: params.automatedAssessment,
  };
}

// ---------------------------------------------------------------------------
// Query Agent Reviews
// ---------------------------------------------------------------------------

/**
 * Check if a feedback entry is an agent review (tag1 = "agent-review").
 */
export function isAgentReview(tag1: string | undefined): boolean {
  return tag1 === AGENT_REVIEW_TAG1;
}

/**
 * Extract reviewer agentId from tag2 (set during submitAgentReview).
 * Returns -1 if not parseable.
 */
export function extractReviewerAgentId(tag2: string | undefined): number {
  if (!tag2) return -1;
  const parsed = parseInt(tag2, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
}
