/**
 * Trusted ClawMon — x402 Micropayment Gateway (Phase 9)
 *
 * Implements the x402 payment flow:
 *   1. Skill pricing registration (trust-tier influenced)
 *   2. Payment processing with fee distribution
 *   3. Access gateway that checks payment before granting skill access
 *   4. Payment history as a trust signal for the scoring engine
 *   5. Revenue analytics (per-skill, per-tier, aggregate)
 *
 * Fee split per the spec:
 *   80% → Skill publisher
 *   10% → Protocol treasury
 *   10% → Insurance pool
 */

import { ethers } from 'ethers';
import type { TrustTier } from '../scoring/types.js';
import { scoreToTier } from '../scoring/types.js';
import {
  DEFAULT_PAYMENT_CONFIG,
  DEFAULT_TIER_PRICING,
  getTierMultiplier,
  TIER_TO_NUMERIC,
  NUMERIC_TO_TIER,
} from './types.js';
import type {
  PaymentConfig,
  TierPricing,
  x402Receipt,
  SkillPaymentProfile,
  PaymentGatewayResult,
  PaymentStats,
  PaymentActivity,
  PaymentTrustSignal,
} from './types.js';
import { getProvider as getMonadProvider } from '../monad/client.js';

// ---------------------------------------------------------------------------
// On-Chain Contract (SkillPaywall.sol)
// ---------------------------------------------------------------------------

const PAYWALL_ABI = [
  'function getPaymentStats() view returns (uint256 totalPayments, uint256 totalProtocolRevenue, uint256 totalPublisherPayouts, uint256 totalInsuranceContributions, uint256 registeredSkillCount)',
  'function getPaymentCount() view returns (uint256)',
  'function getRegisteredSkillCount() view returns (uint256)',
  'function getSkillPricing(bytes32 agentId) view returns (uint256 pricePerCall, uint8 trustTier, bool active, address publisher, uint256 effectivePrice)',
  'function getSkillUsage(bytes32 agentId) view returns (uint256 paymentCount, uint256 totalRevenue)',
  'function getPayment(uint256 paymentId) view returns (uint256 id, bytes32 agentId, address caller, address publisher, uint256 amount, uint256 publisherPayout, uint256 protocolPayout, uint256 insurancePayout, uint256 timestamp)',
  'function paymentIds(uint256 index) view returns (uint256)',
  'function registeredSkills(uint256 index) view returns (bytes32)',
];

const PAYWALL_ADDRESS = process.env.PAYWALL_CONTRACT_ADDRESS || '';

let _paywallContract: ethers.Contract | null = null;
function getPaywallContract(): ethers.Contract | null {
  if (!PAYWALL_ADDRESS) return null;
  if (!_paywallContract) {
    _paywallContract = new ethers.Contract(PAYWALL_ADDRESS, PAYWALL_ABI, getMonadProvider());
  }
  return _paywallContract;
}

/**
 * Load payment data from the deployed SkillPaywall contract.
 * Populates the in-memory cache so existing getter functions work.
 */
export async function loadPaymentsFromChain(agentNames: string[]): Promise<void> {
  skillProfiles.clear();
  allReceipts.length = 0;
  activityFeed.length = 0;
  callerHistory.clear();
  receiptIdCounter = 0;

  const contract = getPaywallContract();
  if (!contract) {
    console.log('  [payments] No contract configured — payment data will be empty');
    return;
  }

  try {
    // Read aggregate stats
    const stats = await contract.getPaymentStats();
    const totalPayments = Number(stats.totalPayments);
    const registeredCount = Number(stats.registeredSkillCount);

    // Read registered skill profiles
    for (let i = 0; i < registeredCount; i++) {
      try {
        const hash = await contract.registeredSkills(i);
        const pricing = await contract.getSkillPricing(hash);
        const usage = await contract.getSkillUsage(hash);

        // Find matching agent name
        const matchedName = agentNames.find(n => ethers.id(n) === hash) ?? hash;
        const tierNum = Number(pricing.trustTier);
        const tier = NUMERIC_TO_TIER[tierNum] ?? ('C' as TrustTier);

        const totalRev = parseFloat(ethers.formatEther(usage.totalRevenue));
        const profile: SkillPaymentProfile = {
          agentId: matchedName,
          publisher: pricing.publisher,
          basePriceEth: parseFloat(ethers.formatEther(pricing.pricePerCall)),
          effectivePriceEth: parseFloat(ethers.formatEther(pricing.effectivePrice)),
          trustTier: tier,
          tierMultiplier: 1.0,
          totalPayments: Number(usage.paymentCount),
          totalRevenueEth: totalRev,
          publisherRevenueEth: totalRev * 0.8,
          protocolRevenueEth: totalRev * 0.1,
          insuranceRevenueEth: totalRev * 0.1,
          lastPaymentTime: 0,
          paymentVelocity: 0,
          active: pricing.active,
        };
        skillProfiles.set(matchedName, profile);
      } catch {
        // Skip skills that fail to read
      }
    }

    // Read recent payment records (last 100 or all if fewer)
    const readCount = Math.min(totalPayments, 100);
    for (let i = totalPayments - readCount; i < totalPayments; i++) {
      try {
        const payId = Number(await contract.paymentIds(i));
        const p = await contract.getPayment(payId);
        const matchedName = agentNames.find(n => ethers.id(n) === p.agentId) ?? p.agentId;

        const receipt: x402Receipt = {
          paymentId: `chain-${Number(p.id)}`,
          agentId: matchedName,
          caller: p.caller,
          amount: parseFloat(ethers.formatEther(p.amount)),
          trustTier: skillProfiles.get(matchedName)?.trustTier ?? ('C' as TrustTier),
          publisherPayout: parseFloat(ethers.formatEther(p.publisherPayout)),
          protocolPayout: parseFloat(ethers.formatEther(p.protocolPayout)),
          insurancePayout: parseFloat(ethers.formatEther(p.insurancePayout)),
          timestamp: Number(p.timestamp) * 1000,
        };
        allReceipts.push(receipt);

        // Track caller history
        if (!callerHistory.has(p.caller)) callerHistory.set(p.caller, new Set());
        callerHistory.get(p.caller)!.add(matchedName);
      } catch {
        // Skip payments that fail to read
      }
    }

    receiptIdCounter = totalPayments;
    console.log(`  [payments] Loaded ${skillProfiles.size} skill profiles, ${allReceipts.length} payment records from chain`);
  } catch (err) {
    console.log('  [payments] Failed to read from chain:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

/** Skill pricing profiles */
const skillProfiles = new Map<string, SkillPaymentProfile>();

/** All payment receipts */
const allReceipts: x402Receipt[] = [];

/** Payment activity feed (recent payments for dashboard) */
const activityFeed: PaymentActivity[] = [];

/** Caller → set of agentIds they've paid for */
const callerHistory = new Map<string, Set<string>>();

let receiptIdCounter = 0;

// ---------------------------------------------------------------------------
// Skill Registration & Pricing
// ---------------------------------------------------------------------------

/**
 * Register a skill for x402 payments with trust-tier-influenced pricing.
 */
export function registerSkillPricing(
  agentId: string,
  publisher: string,
  trustTier: TrustTier,
  config: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
  tierPricing: TierPricing = DEFAULT_TIER_PRICING,
): SkillPaymentProfile {
  const multiplier = getTierMultiplier(trustTier, tierPricing);
  const effectivePrice = config.skillPricePerCall * multiplier;

  const profile: SkillPaymentProfile = {
    agentId,
    publisher,
    basePriceEth: config.skillPricePerCall,
    effectivePriceEth: effectivePrice,
    trustTier,
    tierMultiplier: multiplier,
    totalPayments: 0,
    totalRevenueEth: 0,
    publisherRevenueEth: 0,
    protocolRevenueEth: 0,
    insuranceRevenueEth: 0,
    lastPaymentTime: 0,
    paymentVelocity: 0,
    active: true,
  };

  skillProfiles.set(agentId, profile);
  return profile;
}

/**
 * Update a skill's trust tier and reprice accordingly.
 */
export function updateSkillTier(
  agentId: string,
  newTier: TrustTier,
  config: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
  tierPricing: TierPricing = DEFAULT_TIER_PRICING,
): SkillPaymentProfile | null {
  const profile = skillProfiles.get(agentId);
  if (!profile) return null;

  const multiplier = getTierMultiplier(newTier, tierPricing);
  profile.trustTier = newTier;
  profile.tierMultiplier = multiplier;
  profile.effectivePriceEth = config.skillPricePerCall * multiplier;

  return profile;
}

// ---------------------------------------------------------------------------
// Payment Processing
// ---------------------------------------------------------------------------

/**
 * Process an x402 micropayment for a skill invocation.
 * Returns a receipt with fee distribution breakdown.
 */
export function processSkillPayment(
  agentId: string,
  caller: string,
  config: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
): x402Receipt | null {
  const profile = skillProfiles.get(agentId);
  if (!profile || !profile.active) return null;

  const amount = profile.effectivePriceEth;
  const publisherPayout = amount * config.publisherShare;
  const protocolPayout = amount * config.protocolShare;
  const insurancePayout = amount * config.insuranceShare;

  const receipt: x402Receipt = {
    paymentId: `x402-${++receiptIdCounter}`,
    agentId,
    caller,
    publisher: profile.publisher,
    amount,
    publisherPayout,
    protocolPayout,
    insurancePayout,
    trustTier: profile.trustTier,
    effectivePrice: amount,
    timestamp: Date.now(),
  };

  // Update profile counters
  profile.totalPayments++;
  profile.totalRevenueEth += amount;
  profile.publisherRevenueEth += publisherPayout;
  profile.protocolRevenueEth += protocolPayout;
  profile.insuranceRevenueEth += insurancePayout;
  profile.lastPaymentTime = receipt.timestamp;

  // Compute payment velocity (payments in last 24h)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentPayments = allReceipts.filter(
    r => r.agentId === agentId && r.timestamp >= oneDayAgo,
  ).length + 1;
  profile.paymentVelocity = recentPayments / 24;

  // Store receipt
  allReceipts.push(receipt);

  // Update activity feed (keep last 100)
  activityFeed.push({
    paymentId: receipt.paymentId,
    agentId,
    caller,
    amount,
    trustTier: profile.trustTier,
    timestamp: receipt.timestamp,
  });
  if (activityFeed.length > 100) {
    activityFeed.splice(0, activityFeed.length - 100);
  }

  // Track caller history
  if (!callerHistory.has(caller)) {
    callerHistory.set(caller, new Set());
  }
  callerHistory.get(caller)!.add(agentId);

  return receipt;
}

// ---------------------------------------------------------------------------
// Access Gateway
// ---------------------------------------------------------------------------

/**
 * Check whether a caller has access to invoke a skill.
 * In a real x402 implementation, this would validate an HTTP 402 payment header.
 * For the demo, we process payment inline and return the gateway result.
 */
export function checkPaymentAccess(
  agentId: string,
  caller: string,
  config: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
): PaymentGatewayResult {
  const profile = skillProfiles.get(agentId);

  if (!profile) {
    return {
      accessGranted: false,
      denyReason: 'Skill not registered for x402 payments',
      effectivePriceEth: 0,
      trustTier: 'C',
      isFree: false,
    };
  }

  if (!profile.active) {
    return {
      accessGranted: false,
      denyReason: 'Skill payments are currently disabled',
      effectivePriceEth: profile.effectivePriceEth,
      trustTier: profile.trustTier,
      isFree: false,
    };
  }

  // Budget tier skills with very low effective price are considered free
  const isFree = profile.effectivePriceEth < 0.0001;

  if (isFree) {
    return {
      accessGranted: true,
      effectivePriceEth: 0,
      trustTier: profile.trustTier,
      isFree: true,
    };
  }

  // Process payment
  const receipt = processSkillPayment(agentId, caller, config);

  if (!receipt) {
    return {
      accessGranted: false,
      denyReason: 'Payment processing failed',
      effectivePriceEth: profile.effectivePriceEth,
      trustTier: profile.trustTier,
      isFree: false,
    };
  }

  return {
    accessGranted: true,
    effectivePriceEth: receipt.effectivePrice,
    trustTier: profile.trustTier,
    isFree: false,
    receipt,
  };
}

// ---------------------------------------------------------------------------
// Scoring Engine Integration — Payment Trust Signal
// ---------------------------------------------------------------------------

/**
 * Compute a payment-based trust signal for the scoring engine.
 * Skills with consistent, organic payment history are more trustworthy.
 *
 * Trust weight factors:
 *   - Volume: more payments = more trust (log scale, cap at 1.5)
 *   - Diversity: more unique callers = more trust (cap at 1.3)
 *   - Velocity: abnormally high velocity is suspicious (penalty if > 50/hr)
 *   - Revenue: revenue indicates real value (cap at 1.2)
 *
 * Combined weight is 0.0 to 2.0 (multiplicative with base score).
 */
export function computePaymentTrustSignal(agentId: string): PaymentTrustSignal {
  const profile = skillProfiles.get(agentId);
  const receipts = allReceipts.filter(r => r.agentId === agentId);

  if (!profile || receipts.length === 0) {
    return {
      agentId,
      totalPayments: 0,
      paymentVelocity: 0,
      uniqueCallers: 0,
      totalRevenueEth: 0,
      paymentTrustWeight: 1.0, // Neutral
    };
  }

  const uniqueCallers = new Set(receipts.map(r => r.caller)).size;
  const totalRevenueEth = receipts.reduce((sum, r) => sum + r.amount, 0);

  // Volume factor: log2(payments + 1) / 6, capped at 1.5
  const volumeFactor = Math.min(1.5, Math.log2(receipts.length + 1) / 6 + 0.8);

  // Diversity factor: unique callers diversity, capped at 1.3
  const diversityFactor = Math.min(1.3, Math.log2(uniqueCallers + 1) / 4 + 0.8);

  // Velocity penalty: if velocity > 50/hr, apply penalty
  const velocityPenalty = profile.paymentVelocity > 50 ? 0.7 : 1.0;

  // Revenue factor: log scale revenue, capped at 1.2
  const revenueFactor = Math.min(1.2, Math.log10(totalRevenueEth * 1000 + 1) / 3 + 0.8);

  // Combined weight (geometric mean-ish)
  const paymentTrustWeight = Math.min(
    2.0,
    Math.max(0.0, volumeFactor * diversityFactor * velocityPenalty * revenueFactor),
  );

  return {
    agentId,
    totalPayments: receipts.length,
    paymentVelocity: profile.paymentVelocity,
    uniqueCallers,
    totalRevenueEth,
    paymentTrustWeight: Math.round(paymentTrustWeight * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Revenue Analytics
// ---------------------------------------------------------------------------

/**
 * Compute staking yield APR from protocol revenue.
 * 60% of protocol's 10% share goes to staking yield pool.
 */
export function computeStakingYield(
  totalProtocolRevenue: number,
  totalStaked: number,
): number {
  if (totalStaked <= 0) return 0;
  const yieldPool = totalProtocolRevenue * 0.60;
  return (yieldPool / totalStaked) * 100;
}

/**
 * Get aggregate payment statistics for the dashboard.
 */
export function getPaymentStats(agentIds?: string[]): PaymentStats {
  const ids = agentIds ?? Array.from(skillProfiles.keys());
  const profiles = ids
    .map(id => skillProfiles.get(id))
    .filter((p): p is SkillPaymentProfile => p !== undefined);

  const totalPayments = profiles.reduce((sum, p) => sum + p.totalPayments, 0);
  const totalRevenueEth = profiles.reduce((sum, p) => sum + p.totalRevenueEth, 0);
  const totalPublisherPayoutsEth = profiles.reduce((sum, p) => sum + p.publisherRevenueEth, 0);
  const totalProtocolRevenueEth = profiles.reduce((sum, p) => sum + p.protocolRevenueEth, 0);
  const totalInsuranceContributionsEth = profiles.reduce((sum, p) => sum + p.insuranceRevenueEth, 0);
  const activeProfiles = profiles.filter(p => p.active);

  // Unique callers across all receipts
  const allCallers = new Set(allReceipts.map(r => r.caller));

  // Revenue by tier band
  const revenueByTier = { premium: 0, standard: 0, budget: 0 };
  for (const p of profiles) {
    if (p.tierMultiplier >= 2.0) revenueByTier.premium += p.totalRevenueEth;
    else if (p.tierMultiplier >= 1.0) revenueByTier.standard += p.totalRevenueEth;
    else revenueByTier.budget += p.totalRevenueEth;
  }

  // Top skills by revenue (top 10)
  const topSkills = profiles
    .filter(p => p.totalPayments > 0)
    .sort((a, b) => b.totalRevenueEth - a.totalRevenueEth)
    .slice(0, 10)
    .map(p => ({
      agentId: p.agentId,
      revenueEth: Math.round(p.totalRevenueEth * 10000) / 10000,
      paymentCount: p.totalPayments,
    }));

  return {
    totalPayments,
    totalRevenueEth: Math.round(totalRevenueEth * 10000) / 10000,
    totalPublisherPayoutsEth: Math.round(totalPublisherPayoutsEth * 10000) / 10000,
    totalProtocolRevenueEth: Math.round(totalProtocolRevenueEth * 10000) / 10000,
    totalInsuranceContributionsEth: Math.round(totalInsuranceContributionsEth * 10000) / 10000,
    registeredSkillCount: profiles.length,
    activeSkillCount: activeProfiles.length,
    uniqueCallers: allCallers.size,
    avgPaymentEth: totalPayments > 0
      ? Math.round((totalRevenueEth / totalPayments) * 10000) / 10000
      : 0,
    stakingYieldApr: 0, // Computed separately with staking data
    revenueByTier,
    topSkills,
  };
}

/**
 * Get the payment profile for a specific skill.
 */
export function getSkillPaymentProfile(agentId: string): SkillPaymentProfile | null {
  return skillProfiles.get(agentId) ?? null;
}

/**
 * Get all skill payment profiles.
 */
export function getAllSkillPaymentProfiles(): Map<string, SkillPaymentProfile> {
  return new Map(skillProfiles);
}

/**
 * Get recent payment activity for the dashboard feed.
 */
export function getPaymentActivity(limit: number = 50): PaymentActivity[] {
  return activityFeed.slice(-limit).reverse();
}

/**
 * Get all receipts for a specific skill.
 */
export function getSkillReceipts(agentId: string): x402Receipt[] {
  return allReceipts.filter(r => r.agentId === agentId);
}

/**
 * Get all receipts (for testing/export).
 */
export function getAllReceipts(): x402Receipt[] {
  return [...allReceipts];
}

/**
 * Get all receipts for a specific caller on a specific skill.
 * Used by the usage-weighted scoring engine to verify that a reviewer
 * has actually paid for a skill before leaving feedback.
 */
export function getCallerReceiptsForSkill(agentId: string, caller: string): x402Receipt[] {
  return allReceipts.filter(r => r.agentId === agentId && r.caller === caller);
}

/**
 * Check whether an address has any payment history in the system.
 */
export function hasPaymentHistory(caller: string): boolean {
  return callerHistory.has(caller) && callerHistory.get(caller)!.size > 0;
}

// ---------------------------------------------------------------------------
// Seed Simulated Payment Data
// ---------------------------------------------------------------------------

/**
 * Generate simulated payment history for all registered skills.
 * Higher-tier skills get more payments, reflecting organic usage patterns.
 */
export function seedSimulatedPayments(
  seeds: Array<{
    agentId: string;
    publisher: string;
    tier: TrustTier;
    feedbackCount: number;
    flagged: boolean;
    isSybil: boolean;
    category: string;
  }>,
  config: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
): void {
  const baseTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const seed of seeds) {
    // Register skill pricing
    registerSkillPricing(seed.agentId, seed.publisher, seed.tier, config);

    // Flagged/sybil skills get very few or no payments
    if (seed.flagged || seed.isSybil) {
      const count = Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const caller = `0x${seed.agentId.slice(0, 4)}caller${i}`;
        const receipt = processSkillPayment(seed.agentId, caller, config);
        if (receipt) {
          (receipt as any).timestamp = baseTimestamp + Math.random() * 2 * 24 * 60 * 60 * 1000;
        }
      }
      continue;
    }

    // Payment count scales with tier and feedback count
    let paymentMultiplier = 1;
    switch (seed.tier) {
      case 'AAA': case 'AA': paymentMultiplier = 8; break;
      case 'A': paymentMultiplier = 6; break;
      case 'BBB': paymentMultiplier = 4; break;
      case 'BB': paymentMultiplier = 3; break;
      case 'B': paymentMultiplier = 2; break;
      default: paymentMultiplier = 1; break;
    }

    const baseCount = Math.max(1, Math.floor(seed.feedbackCount * 0.5));
    const paymentCount = Math.min(80, Math.floor(baseCount * paymentMultiplier * (0.5 + Math.random())));

    // Generate callers (some repeat)
    const uniqueCallerCount = Math.max(1, Math.floor(paymentCount * 0.4));
    const callers: string[] = [];
    for (let i = 0; i < uniqueCallerCount; i++) {
      callers.push(`0x${Math.random().toString(16).slice(2, 10)}${i.toString(16).padStart(4, '0')}`);
    }

    for (let i = 0; i < paymentCount; i++) {
      const caller = callers[Math.floor(Math.random() * callers.length)];
      const receipt = processSkillPayment(seed.agentId, caller, config);
      if (receipt) {
        // Backdate the timestamp to spread over 7 days
        const offset = Math.random() * 7 * 24 * 60 * 60 * 1000;
        (receipt as any).timestamp = baseTimestamp + offset;
      }
    }

    // Recalculate velocity based on simulated timestamps
    const profile = skillProfiles.get(seed.agentId);
    if (profile) {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentCount = allReceipts.filter(
        r => r.agentId === seed.agentId && r.timestamp >= oneDayAgo,
      ).length;
      profile.paymentVelocity = recentCount / 24;
    }
  }
}
