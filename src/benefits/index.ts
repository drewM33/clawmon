/**
 * Trusted ClawMon — Benefits Module (Phase 6)
 *
 * Re-exports for benefit tier gating, rate limiting, and provisioning.
 */

export type {
  BenefitTierName,
  BenefitConfig,
  BenefitAllocation,
  BenefitStatus,
  VpsSpec,
  ComputeSpec,
  ProvisioningRequest,
  ProvisioningResult,
} from './types.js';

export {
  BENEFIT_CONFIGS,
  BENEFIT_TIER_VALUES,
} from './types.js';

export {
  getBenefitTier,
  isAuthorized,
  getAllocation,
  checkAndActivate,
  assignResources,
  getBenefitStatus,
  getBenefitStatusOffline,
  isGateConfigured,
  resetClients,
} from './gate-client.js';

export {
  checkRateLimit,
  benefitRateLimiter,
  cleanupExpiredEntries,
  resetRateLimits,
} from './rate-limiter.js';

export {
  provisionForTier,
  handleTierChange,
  getProvisionedResources,
  getAllProvisionedResources,
  resetProvisioning,
} from './provisioner.js';
