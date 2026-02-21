/**
 * Trusted ClawMon — x402 Payment Types (Phase 9)
 *
 * TypeScript representations of x402 micropayment structures.
 * Payment pricing is influenced by trust tiers — higher trust = premium pricing.
 */

import type { TrustTier } from '../scoring/types.js';

// ---------------------------------------------------------------------------
// Payment Configuration
// ---------------------------------------------------------------------------

/** Fee split configuration for x402 payments */
export interface PaymentConfig {
  /** Base price per skill invocation in MON */
  skillPricePerCall: number;
  /** Publisher share (0.80 = 80%) */
  publisherShare: number;
  /** Protocol treasury share (0.10 = 10%) */
  protocolShare: number;
  /** Insurance pool share (0.10 = 10%) */
  insuranceShare: number;
}

/** Default payment configuration */
export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  skillPricePerCall: 0.001,    // 0.001 MON base price per call
  publisherShare: 0.80,
  protocolShare: 0.10,
  insuranceShare: 0.10,
};

// ---------------------------------------------------------------------------
// Trust Tier Pricing
// ---------------------------------------------------------------------------

/** Price multiplier by trust tier band */
export interface TierPricing {
  /** Premium tiers (AAA, AA, A) — high trust, premium pricing */
  premiumMultiplier: number;
  /** Standard tiers (BBB, BB, B) — moderate trust, base pricing */
  standardMultiplier: number;
  /** Budget tiers (CCC, CC, C) — low trust, discounted / free */
  budgetMultiplier: number;
}

/** Default tier pricing multipliers */
export const DEFAULT_TIER_PRICING: TierPricing = {
  premiumMultiplier: 2.0,     // AAA/AA/A charge 2x base
  standardMultiplier: 1.0,    // BBB/BB/B charge 1x base
  budgetMultiplier: 0.5,      // CCC/CC/C charge 0.5x base
};

/** Map a trust tier to its pricing band */
export function getTierMultiplier(tier: TrustTier, pricing: TierPricing = DEFAULT_TIER_PRICING): number {
  switch (tier) {
    case 'AAA':
    case 'AA':
    case 'A':
      return pricing.premiumMultiplier;
    case 'BBB':
    case 'BB':
    case 'B':
      return pricing.standardMultiplier;
    case 'CCC':
    case 'CC':
    case 'C':
      return pricing.budgetMultiplier;
  }
}

/** Trust tier to numeric value (for contract tier param) */
export const TIER_TO_NUMERIC: Record<TrustTier, number> = {
  C: 0, CC: 1, CCC: 2,
  B: 3, BB: 4, BBB: 5,
  A: 6, AA: 7, AAA: 8,
};

/** Numeric tier to TrustTier */
export const NUMERIC_TO_TIER: Record<number, TrustTier> = {
  0: 'C', 1: 'CC', 2: 'CCC',
  3: 'B', 4: 'BB', 5: 'BBB',
  6: 'A', 7: 'AA', 8: 'AAA',
};

// ---------------------------------------------------------------------------
// x402 Receipt
// ---------------------------------------------------------------------------

/** Receipt issued after a successful x402 payment */
export interface x402Receipt {
  /** Unique payment ID */
  paymentId: string;
  /** The skill/agent that was paid for */
  agentId: string;
  /** Address of the caller (payer) */
  caller: string;
  /** Publisher address that received their share */
  publisher: string;
  /** Total amount paid (MON) */
  amount: number;
  /** Publisher's payout (MON) */
  publisherPayout: number;
  /** Protocol treasury's share (MON) */
  protocolPayout: number;
  /** Insurance pool's share (MON) */
  insurancePayout: number;
  /** Trust tier at time of payment */
  trustTier: TrustTier;
  /** Effective price charged (with tier multiplier) */
  effectivePrice: number;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** On-chain transaction hash (present for verified payments) */
  txHash?: string;
}

// ---------------------------------------------------------------------------
// Skill Payment Profile
// ---------------------------------------------------------------------------

/** Payment profile for a skill — tracks revenue and usage */
export interface SkillPaymentProfile {
  agentId: string;
  publisher: string;
  basePriceEth: number;
  effectivePriceEth: number;
  trustTier: TrustTier;
  tierMultiplier: number;
  totalPayments: number;
  totalRevenueEth: number;
  publisherRevenueEth: number;
  protocolRevenueEth: number;
  insuranceRevenueEth: number;
  lastPaymentTime: number;
  /** Payment velocity (payments per hour in last 24h) */
  paymentVelocity: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Payment Gateway Response
// ---------------------------------------------------------------------------

/** Access gateway check result */
export interface PaymentGatewayResult {
  /** Whether access is granted */
  accessGranted: boolean;
  /** If denied, the reason */
  denyReason?: string;
  /** The effective price for this skill */
  effectivePriceEth: number;
  /** Trust tier of the skill */
  trustTier: TrustTier;
  /** Whether the skill is free (budget tier with minimal price) */
  isFree: boolean;
  /** Payment receipt (if payment was processed) */
  receipt?: x402Receipt;
}

// ---------------------------------------------------------------------------
// Payment Stats (API response)
// ---------------------------------------------------------------------------

/** Aggregate payment statistics */
export interface PaymentStats {
  totalPayments: number;
  totalRevenueEth: number;
  totalPublisherPayoutsEth: number;
  totalProtocolRevenueEth: number;
  totalInsuranceContributionsEth: number;
  registeredSkillCount: number;
  activeSkillCount: number;
  uniqueCallers: number;
  avgPaymentEth: number;
  stakingYieldApr: number;
  /** Revenue by tier band */
  revenueByTier: {
    premium: number;
    standard: number;
    budget: number;
  };
  /** Top skills by revenue */
  topSkills: Array<{
    agentId: string;
    revenueEth: number;
    paymentCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Payment Activity (for dashboard feed)
// ---------------------------------------------------------------------------

/** A single payment activity item for the dashboard feed */
export interface PaymentActivity {
  paymentId: string;
  agentId: string;
  caller: string;
  amount: number;
  trustTier: TrustTier;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Scoring Integration — Payment Trust Signal
// ---------------------------------------------------------------------------

/** Payment-based trust signal for the scoring engine */
export interface PaymentTrustSignal {
  agentId: string;
  /** Total payments received (higher = more trust) */
  totalPayments: number;
  /** Payment velocity (payments/hr — too high may be suspicious) */
  paymentVelocity: number;
  /** Unique callers (diversity of payers) */
  uniqueCallers: number;
  /** Total revenue in MON */
  totalRevenueEth: number;
  /** Computed trust weight from payment history (0.0 - 2.0) */
  paymentTrustWeight: number;
}

// ---------------------------------------------------------------------------
// Contract Constants (mirrored from Solidity)
// ---------------------------------------------------------------------------

export const PAYWALL_CONSTANTS = {
  PUBLISHER_BPS: 8000,
  PROTOCOL_BPS: 1000,
  INSURANCE_BPS: 1000,
  TOTAL_BPS: 10000,
  MIN_PAYMENT_WEI: '100000000000000',      // 0.0001 MON
  MIN_PAYMENT_ETH: 0.0001,
  PREMIUM_MULTIPLIER_BPS: 20000,           // 2.0x
  STANDARD_MULTIPLIER_BPS: 10000,          // 1.0x
  BUDGET_MULTIPLIER_BPS: 5000,             // 0.5x
} as const;
