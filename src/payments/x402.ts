/**
 * Trusted ClawMon — x402 Micropayment Gateway (Phase 9)
 *
 * Manages skill pricing and records verified on-chain payments:
 *   1. Skill pricing registration (trust-tier influenced)
 *   2. Recording verified on-chain payments from SkillPaywall contract
 *   3. Payment history as a trust signal for the scoring engine
 *   4. Revenue analytics (per-skill, per-tier, aggregate)
 *
 * Payments are settled on-chain via the SkillPaywall contract.
 * The caller's wallet calls payForSkill(), then the server verifies the
 * tx receipt (via x402-protocol.ts) and records it here.
 *
 * Fee split (enforced by SkillPaywall.sol):
 *   80% → Skill publisher
 *   10% → Protocol treasury
 *   10% → Insurance pool
 */

import { ethers } from 'ethers';
import type { TrustTier } from '../scoring/types.js';
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
import { getProvider as getMonadProvider, getSigner as getMonadSigner } from '../monad/client.js';

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
  'function registerSkill(bytes32 agentId, address publisher, uint256 pricePerCall, uint8 trustTier)',
  'function owner() view returns (address)',
];

const PAYWALL_ADDRESS = process.env.PAYWALL_CONTRACT_ADDRESS || '';

const MIN_PAYMENT = ethers.parseEther('0.0001');

let _paywallContract: ethers.Contract | null = null;
function getPaywallContract(): ethers.Contract | null {
  if (!PAYWALL_ADDRESS) return null;
  if (!_paywallContract) {
    _paywallContract = new ethers.Contract(PAYWALL_ADDRESS, PAYWALL_ABI, getMonadProvider());
  }
  return _paywallContract;
}

let _paywallWriteContract: ethers.Contract | null = null;
function getPaywallWriteContract(): ethers.Contract | null {
  if (!PAYWALL_ADDRESS) return null;
  try {
    if (!_paywallWriteContract) {
      _paywallWriteContract = new ethers.Contract(PAYWALL_ADDRESS, PAYWALL_ABI, getMonadSigner());
    }
    return _paywallWriteContract;
  } catch {
    return null;
  }
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

        const amountEth = parseFloat(ethers.formatEther(p.amount));
        const receipt: x402Receipt = {
          paymentId: `chain-${Number(p.id)}`,
          agentId: matchedName,
          caller: p.caller,
          publisher: p.publisher ?? '',
          amount: amountEth,
          trustTier: skillProfiles.get(matchedName)?.trustTier ?? ('C' as TrustTier),
          effectivePrice: amountEth,
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
 * Also registers the skill on the SkillPaywall contract if configured and
 * the publisher is a valid ETH address.
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

  // Fire-and-forget on-chain registration.
  // Use the operator wallet as a fallback publisher for skills whose publisher
  // is a GitHub username or other non-ETH identifier.
  registerSkillOnChain(agentId, publisher, trustTier).catch(() => {});

  return profile;
}

/**
 * Register a skill on the SkillPaywall contract (on-chain).
 * Only succeeds when the server's MONAD_PRIVATE_KEY is the contract owner.
 *
 * If the publisher is not a valid ETH address the operator wallet is used
 * as a fallback so the payForSkill flow still works for every skill.
 */
export async function registerSkillOnChain(
  agentId: string,
  publisher: string,
  trustTier: TrustTier,
): Promise<boolean> {
  const contract = getPaywallWriteContract();
  if (!contract) return false;

  const agentIdHash = ethers.id(agentId);
  const tierNum = TIER_TO_NUMERIC[trustTier] ?? 5;
  const pricePerCall = ethers.parseEther('0.001');

  // Fallback: use operator address when publisher isn't an ETH address
  const isEthAddress = /^0x[0-9a-fA-F]{40}$/.test(publisher);
  let onChainPublisher = publisher;
  if (!isEthAddress) {
    try {
      const runner = contract.runner as ethers.Signer | undefined;
      onChainPublisher = runner?.getAddress ? await runner.getAddress() : '';
    } catch {
      return false;
    }
    if (!onChainPublisher) return false;
  }

  // Check if already registered
  try {
    const pricing = await contract.getSkillPricing(agentIdHash);
    if (pricing[2]) return true; // already active
  } catch {
    // getSkillPricing reverts for unregistered skills — expected
  }

  try {
    const tx = await contract.registerSkill(agentIdHash, onChainPublisher, pricePerCall, tierNum);
    await tx.wait();
    console.log(`  [paywall] Registered on-chain: ${agentId} → ${onChainPublisher.slice(0, 10)}... tier=${trustTier}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Already registered')) return true;
    console.log(`  [paywall] On-chain registration failed for ${agentId}: ${msg.slice(0, 80)}`);
    return false;
  }
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
 * Record a verified on-chain payment in the in-memory cache.
 *
 * This does NOT initiate a payment -- it records one that has already been
 * verified on-chain (via `verifyPaymentTx` from x402-protocol.ts). Call this
 * after the caller's wallet has submitted a `payForSkill` transaction to the
 * SkillPaywall contract and the server has confirmed the tx receipt.
 */
export function recordVerifiedPayment(params: {
  agentId: string;
  caller: string;
  txHash: string;
  amountEth: number;
  publisherPayoutEth: number;
  protocolPayoutEth: number;
  insurancePayoutEth: number;
  onChainPaymentId: number;
  blockTimestamp: number;
}): x402Receipt {
  const profile = skillProfiles.get(params.agentId);
  const trustTier = profile?.trustTier ?? ('C' as TrustTier);

  const receipt: x402Receipt = {
    paymentId: `chain-${params.onChainPaymentId}`,
    agentId: params.agentId,
    caller: params.caller,
    publisher: profile?.publisher ?? '',
    amount: params.amountEth,
    publisherPayout: params.publisherPayoutEth,
    protocolPayout: params.protocolPayoutEth,
    insurancePayout: params.insurancePayoutEth,
    trustTier,
    effectivePrice: params.amountEth,
    timestamp: params.blockTimestamp * 1000,
    txHash: params.txHash,
  };

  // Update profile counters if the skill is registered
  if (profile) {
    profile.totalPayments++;
    profile.totalRevenueEth += params.amountEth;
    profile.publisherRevenueEth += params.publisherPayoutEth;
    profile.protocolRevenueEth += params.protocolPayoutEth;
    profile.insuranceRevenueEth += params.insurancePayoutEth;
    profile.lastPaymentTime = receipt.timestamp;

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentPayments = allReceipts.filter(
      r => r.agentId === params.agentId && r.timestamp >= oneDayAgo,
    ).length + 1;
    profile.paymentVelocity = recentPayments / 24;
  }

  allReceipts.push(receipt);

  activityFeed.push({
    paymentId: receipt.paymentId,
    agentId: params.agentId,
    caller: params.caller,
    amount: params.amountEth,
    trustTier,
    timestamp: receipt.timestamp,
  });
  if (activityFeed.length > 100) {
    activityFeed.splice(0, activityFeed.length - 100);
  }

  if (!callerHistory.has(params.caller)) {
    callerHistory.set(params.caller, new Set());
  }
  callerHistory.get(params.caller)!.add(params.agentId);

  return receipt;
}

// ---------------------------------------------------------------------------
// Pricing Queries
// ---------------------------------------------------------------------------

/**
 * Get the x402 payment requirements for a skill.
 * Returns pricing info so the caller's wallet can submit `payForSkill` on-chain.
 */
export function getPaymentRequirements(
  agentId: string,
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

  const isFree = profile.effectivePriceEth < 0.0001;

  return {
    accessGranted: false,
    effectivePriceEth: isFree ? 0 : profile.effectivePriceEth,
    trustTier: profile.trustTier,
    isFree,
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

