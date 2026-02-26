/**
 * Trusted ClawMon — Agent Feedback Types (Phase 5)
 *
 * Types for agent-to-agent feedback on the ERC-8004 ReputationRegistry.
 * Agents use tag1="agent-review" to distinguish from human feedback.
 */

import type { FeedbackFile } from '../erc8004/types.js';

// ---------------------------------------------------------------------------
// Agent Feedback File (extends ERC-8004 FeedbackFile)
// ---------------------------------------------------------------------------

/**
 * Extended off-chain feedback file for agent-to-agent reviews.
 * Stored at feedbackURI, referenced by giveFeedback() on-chain.
 */
export interface AgentFeedbackFile extends FeedbackFile {
  /** The reviewing agent's ERC-8004 agentId */
  reviewerAgentId: number;
  /** Which skill the reviewer used to evaluate the target */
  reviewerSkillUsed: string;
  /** Structured automated assessment */
  automatedAssessment: AutomatedAssessment;
}

export interface AutomatedAssessment {
  /** Security posture score (0-100) */
  securityScore: number;
  /** Reliability and uptime score (0-100) */
  reliabilityScore: number;
  /** Performance and latency score (0-100) */
  performanceScore: number;
  /** Human-readable summary of the assessment */
  summary: string;
}

// ---------------------------------------------------------------------------
// Agent Review Params (submission request)
// ---------------------------------------------------------------------------

export interface AgentReviewParams {
  /** Target skill's ERC-8004 agentId */
  targetAgentId: number;
  /** Reviewer agent's ERC-8004 agentId */
  reviewerAgentId: number;
  /** Overall feedback value (0-100) */
  value: number;
  /** Which skill the reviewer used to evaluate */
  reviewerSkillUsed: string;
  /** Automated assessment breakdown */
  automatedAssessment: AutomatedAssessment;
  /** Optional endpoint the review relates to */
  endpoint?: string;
  /** Optional URI for the full feedback file */
  feedbackURI?: string;
  /** Optional content hash of the feedback file */
  feedbackHash?: string;
}

// ---------------------------------------------------------------------------
// Agent Review Result
// ---------------------------------------------------------------------------

export interface AgentReviewResult {
  /** Target skill's agentId */
  targetAgentId: number;
  /** Reviewer's agentId */
  reviewerAgentId: number;
  /** Reviewer wallet address */
  reviewerAddress: string;
  /** Feedback value submitted */
  value: number;
  /** On-chain feedback index */
  feedbackIndex: number;
  /** Transaction hash */
  txHash: string;
  /** Weight applied based on reviewer reputation */
  reviewerWeight: number;
  /** Reviewer's reputation tier */
  reviewerTier: string;
}

// ---------------------------------------------------------------------------
// Agent Review Weight Config
// ---------------------------------------------------------------------------

export interface AgentReviewWeightConfig {
  /** Weight for whale-tier agent reviewers (default: 5x) */
  whaleTierWeight: number;
  /** Weight for agents with published skill + stake (default: 3x) */
  publishedAndStakedWeight: number;
  /** Weight for lobster-tier agent reviewers (default: 2x) */
  lobsterTierWeight: number;
  /** Weight for new/unknown agent reviewers (default: 0.5x) */
  unknownAgentWeight: number;
}

export const DEFAULT_AGENT_REVIEW_WEIGHTS: AgentReviewWeightConfig = {
  whaleTierWeight: 5.0,
  publishedAndStakedWeight: 3.0,
  lobsterTierWeight: 2.0,
  unknownAgentWeight: 0.5,
};

// ---------------------------------------------------------------------------
// Agent Feedback Tag Constants
// ---------------------------------------------------------------------------

/** Tag1 value for agent-to-agent reviews (distinguishes from human feedback) */
export const AGENT_REVIEW_TAG1 = 'agent-review';
