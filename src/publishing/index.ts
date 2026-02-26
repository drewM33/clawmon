/**
 * Trusted ClawMon — Publishing Module (Phase 1)
 *
 * Re-exports for the skill publishing and identity binding flow.
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
