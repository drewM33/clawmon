/**
 * Trusted ClawMon — Feedback Module (Phase 5)
 *
 * Re-exports for agent-to-agent feedback submission, validation,
 * and weighted scoring.
 */

export {
  submitAgentReview,
  validateAgentReview,
  buildAgentFeedbackFile,
  isAgentReview,
  extractReviewerAgentId,
} from './agent-feedback.js';

export type {
  AgentFeedbackFile,
  AgentReviewParams,
  AgentReviewResult,
  AutomatedAssessment,
  AgentReviewWeightConfig,
} from './types.js';

export {
  AGENT_REVIEW_TAG1,
  DEFAULT_AGENT_REVIEW_WEIGHTS,
} from './types.js';
