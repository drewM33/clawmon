/**
 * Trusted ClawMon — BenefitGate Contract Client (Phase 6)
 *
 * Off-chain client for the BenefitGate.sol contract.
 * Reads benefit tiers, checks authorization, and triggers activations.
 */

import { ethers } from 'ethers';
import { getProvider, getSigner } from '../monad/client.js';
import type { BenefitTierName, BenefitAllocation, BenefitStatus } from './types.js';
import { BENEFIT_CONFIGS, BENEFIT_TIER_VALUES } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BENEFIT_GATE_ADDRESS = process.env.BENEFIT_GATE_ADDRESS || '';

const GATE_ABI = [
  'function checkAndActivate(uint256 skillId) external returns (uint8)',
  'function getBenefitTier(uint256 skillId) view returns (uint8)',
  'function isAuthorized(uint256 skillId, uint8 requiredTier) view returns (bool)',
  'function getAllocation(uint256 skillId) view returns (uint8 tier, uint256 activatedAt, uint256 expiresAt, bytes32 vpsId, bytes32 computeId)',
  'function assignResources(uint256 skillId, bytes32 vpsId, bytes32 computeId) external',
  'event BenefitActivated(uint256 indexed skillId, uint8 tier, bytes32 resourceId)',
  'event BenefitDeactivated(uint256 indexed skillId, uint8 oldTier)',
  'event BenefitUpgraded(uint256 indexed skillId, uint8 oldTier, uint8 newTier)',
  'event ResourceAssigned(uint256 indexed skillId, bytes32 vpsId, bytes32 computeId)',
];

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _gateRead: ethers.Contract | null = null;
let _gateWrite: ethers.Contract | null = null;

function getGateRead(): ethers.Contract {
  if (!_gateRead) {
    if (!BENEFIT_GATE_ADDRESS) throw new Error('BENEFIT_GATE_ADDRESS not set');
    _gateRead = new ethers.Contract(BENEFIT_GATE_ADDRESS, GATE_ABI, getProvider());
  }
  return _gateRead;
}

function getGateWrite(): ethers.Contract {
  if (!_gateWrite) {
    if (!BENEFIT_GATE_ADDRESS) throw new Error('BENEFIT_GATE_ADDRESS not set');
    _gateWrite = new ethers.Contract(BENEFIT_GATE_ADDRESS, GATE_ABI, getSigner());
  }
  return _gateWrite;
}

// ---------------------------------------------------------------------------
// Tier Helpers
// ---------------------------------------------------------------------------

const TIER_NAMES: BenefitTierName[] = ['none', 'bronze', 'silver', 'gold'];

function tierValueToName(value: number): BenefitTierName {
  return TIER_NAMES[value] ?? 'none';
}

function getNextTier(current: BenefitTierName): BenefitTierName | null {
  switch (current) {
    case 'none': return 'bronze';
    case 'bronze': return 'silver';
    case 'silver': return 'gold';
    case 'gold': return null;
  }
}

/** Boost units needed for each tier (from StakeEscrow thresholds) */
const TIER_BOOST_THRESHOLDS: Record<BenefitTierName, number> = {
  none: 0,
  bronze: 2,
  silver: 7,
  gold: 14,
};

function boostUnitsToNextTier(currentTier: BenefitTierName, currentBoosts: number): number {
  const next = getNextTier(currentTier);
  if (!next) return 0;
  return Math.max(0, TIER_BOOST_THRESHOLDS[next] - currentBoosts);
}

// ---------------------------------------------------------------------------
// Read: Benefit Tier
// ---------------------------------------------------------------------------

/**
 * Get the current benefit tier for a skill (live from contract).
 */
export async function getBenefitTier(skillId: number): Promise<BenefitTierName> {
  const tierValue = await getGateRead().getBenefitTier(skillId);
  return tierValueToName(Number(tierValue));
}

/**
 * Check if a skill is authorized for a specific benefit tier.
 */
export async function isAuthorized(skillId: number, requiredTier: BenefitTierName): Promise<boolean> {
  const tierValue = BENEFIT_TIER_VALUES[requiredTier];
  return getGateRead().isAuthorized(skillId, tierValue);
}

/**
 * Get full benefit allocation for a skill.
 */
export async function getAllocation(skillId: number): Promise<BenefitAllocation> {
  const [tier, activatedAt, expiresAt, vpsId, computeId] = await getGateRead().getAllocation(skillId);
  const tierName = tierValueToName(Number(tier));
  return {
    skillId,
    tier: tierName,
    tierValue: Number(tier),
    activatedAt: Number(activatedAt),
    expiresAt: Number(expiresAt),
    vpsId: vpsId,
    computeId: computeId,
    config: BENEFIT_CONFIGS[tierName],
  };
}

// ---------------------------------------------------------------------------
// Write: Activate & Assign
// ---------------------------------------------------------------------------

/**
 * Check and activate/update benefit tier for a skill.
 * Returns the activated tier.
 */
export async function checkAndActivate(skillId: number): Promise<BenefitTierName> {
  const tx = await getGateWrite().checkAndActivate(skillId);
  const receipt = await tx.wait();

  // Parse result from events
  const activated = receipt.logs
    .map((log: ethers.Log) => {
      try { return getGateWrite().interface.parseLog(log); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) =>
      e?.name === 'BenefitActivated' || e?.name === 'BenefitUpgraded',
    );

  if (activated) {
    const tierValue = activated.name === 'BenefitActivated'
      ? Number(activated.args.tier)
      : Number(activated.args.newTier);
    return tierValueToName(tierValue);
  }

  // No event means tier unchanged — read current
  return getBenefitTier(skillId);
}

/**
 * Assign VPS/compute resource IDs after provisioning.
 */
export async function assignResources(
  skillId: number,
  vpsId: string,
  computeId: string,
): Promise<string> {
  const tx = await getGateWrite().assignResources(skillId, vpsId, computeId);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ---------------------------------------------------------------------------
// Convenience: Full Status
// ---------------------------------------------------------------------------

/**
 * Get comprehensive benefit status for a skill.
 * Requires BENEFIT_GATE_ADDRESS to be configured.
 */
export async function getBenefitStatus(skillId: number, boostUnits: number, trustLevel: number): Promise<BenefitStatus> {
  const tierName = tierValueToName(trustLevel);
  const config = BENEFIT_CONFIGS[tierName];
  const next = getNextTier(tierName);

  const benefits: string[] = [];
  if (config.priorityQueue) benefits.push('Priority queue');
  if (config.feedbackBadge) benefits.push('Feedback badge');
  if (config.vpsAccess) benefits.push('VPS sandbox access');
  if (config.analyticsDashboard) benefits.push('Analytics dashboard');
  if (config.dedicatedCompute) benefits.push('Dedicated compute');
  if (config.customDomain) benefits.push('Custom domain');
  if (config.prioritySupport) benefits.push('Priority support');

  let allocation: BenefitAllocation | null = null;
  if (BENEFIT_GATE_ADDRESS) {
    try {
      allocation = await getAllocation(skillId);
    } catch {
      // Contract not deployed or skillId not found — return without allocation
    }
  }

  return {
    skillId,
    currentTier: tierName,
    currentTierLabel: config.label,
    boostUnits,
    trustLevel,
    rateLimitPerMin: config.rateLimitPerMin,
    benefits,
    allocation,
    nextTier: next,
    boostUnitsToNextTier: boostUnitsToNextTier(tierName, boostUnits),
  };
}

/**
 * Build benefit status from trust level only (no contract call).
 * Useful when BenefitGate is not deployed.
 */
export function getBenefitStatusOffline(skillId: number, boostUnits: number, trustLevel: number): BenefitStatus {
  const tierName = tierValueToName(trustLevel);
  const config = BENEFIT_CONFIGS[tierName];
  const next = getNextTier(tierName);

  const benefits: string[] = [];
  if (config.priorityQueue) benefits.push('Priority queue');
  if (config.feedbackBadge) benefits.push('Feedback badge');
  if (config.vpsAccess) benefits.push('VPS sandbox access');
  if (config.analyticsDashboard) benefits.push('Analytics dashboard');
  if (config.dedicatedCompute) benefits.push('Dedicated compute');
  if (config.customDomain) benefits.push('Custom domain');
  if (config.prioritySupport) benefits.push('Priority support');

  return {
    skillId,
    currentTier: tierName,
    currentTierLabel: config.label,
    boostUnits,
    trustLevel,
    rateLimitPerMin: config.rateLimitPerMin,
    benefits,
    allocation: null,
    nextTier: next,
    boostUnitsToNextTier: boostUnitsToNextTier(tierName, boostUnits),
  };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function isGateConfigured(): boolean {
  return Boolean(BENEFIT_GATE_ADDRESS);
}

export function resetClients(): void {
  _gateRead = null;
  _gateWrite = null;
}
