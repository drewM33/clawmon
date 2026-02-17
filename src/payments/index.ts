/**
 * Trusted ClawMon — x402 Payment Module (Phase 9)
 *
 * Barrel export for the payment subsystem.
 */

export {
  DEFAULT_PAYMENT_CONFIG,
  DEFAULT_TIER_PRICING,
  getTierMultiplier,
  TIER_TO_NUMERIC,
  NUMERIC_TO_TIER,
  PAYWALL_CONSTANTS,
} from './types.js';

export type {
  PaymentConfig,
  TierPricing,
  x402Receipt,
  SkillPaymentProfile,
  PaymentGatewayResult,
  PaymentStats,
  PaymentActivity,
  PaymentTrustSignal,
} from './types.js';

export {
  registerSkillPricing,
  updateSkillTier,
  processSkillPayment,
  checkPaymentAccess,
  computePaymentTrustSignal,
  computeStakingYield,
  getPaymentStats,
  getSkillPaymentProfile,
  getAllSkillPaymentProfiles,
  getPaymentActivity,
  getSkillReceipts,
  getAllReceipts,
  getCallerReceiptsForSkill,
  hasPaymentHistory,
  seedSimulatedPayments,
  loadPaymentsFromChain,
} from './x402.js';
