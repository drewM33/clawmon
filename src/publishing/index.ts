/**
 * Trusted ClawMon — Publishing Module (Phase 1 + Phase 2)
 *
 * Re-exports for the skill publishing, identity binding, and
 * feedback authorization flow.
 */

export {
  publishSkill,
  resolveIdentity,
  clawhubSkillIdHash,
  computeMetadataHash,
  getSkillIdBySlug,
  getPublisherSkillIds,
  getPublishCount,
  isBinderConfigured,
  resetClients,
} from './publisher-binder.js';

export type {
  PublishRequest,
  PublishResult,
  PublishRecord,
  PublishResponse,
  IdentityBinding,
  IdentityPath,
  RiskTier,
} from './types.js';

export { RISK_TIER_VALUES } from './types.js';

export {
  checkFeedbackAuth,
  checkFeedbackAuthOnChain,
  checkFeedbackAuthOffChain,
  setFeedbackAuthOnChain,
} from '../scoring/feedback-auth-gate.js';

export type {
  FeedbackAuthPolicy,
  FeedbackAuthResult,
} from '../scoring/feedback-auth-gate.js';
