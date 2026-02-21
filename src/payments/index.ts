/**
 * Trusted ClawMon — x402 Payment Module (Phase 9 + Phase 13)
 *
 * Barrel export for the payment subsystem.
 *
 * Phase 9:  On-chain payment settlement via SkillPaywall contract
 * Phase 13: Live x402 HTTP protocol, execution proofs, skill proxy
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
  registerSkillOnChain,
  updateSkillTier,
  recordVerifiedPayment,
  getPaymentRequirements,
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
  loadPaymentsFromChain,
} from './x402.js';

// Phase 13: x402 HTTP protocol
export {
  buildPaymentRequired,
  verifyPaymentTx,
  decodePaymentSignature,
  encodePaymentRequired,
  encodePaymentResponse,
  buildProofOfPayment,
  getPaywallAddress,
} from './x402-protocol.js';

export type {
  PaymentRequirement,
  PaymentRequiredResponse,
  VerifiedPayment,
  PaymentVerificationResult,
} from './x402-protocol.js';

// Phase 13: Execution proofs
export {
  generateExecutionReceipt,
  verifyExecutionReceipt,
  hashOutput,
  isValidReceiptShape,
} from './execution-proof.js';

export type {
  ExecutionReceipt,
  ReceiptVerification,
} from './execution-proof.js';

// Phase 13: Skill proxy
export {
  registerSkillEndpoint,
  getSkillEndpoint,
  getAllSkillEndpoints,
  handleSkillInvoke,
  handleSkillPricing,
} from './skill-proxy.js';

export type {
  SkillEndpoint,
} from './skill-proxy.js';
