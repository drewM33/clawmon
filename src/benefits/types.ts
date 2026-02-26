/**
 * Trusted ClawMon — Benefit Types (Phase 6)
 *
 * Benefit tier configuration and types for the Discord Nitro-style
 * boost-based benefit unlock system.
 */

// ---------------------------------------------------------------------------
// Benefit Tiers
// ---------------------------------------------------------------------------

export type BenefitTierName = 'none' | 'bronze' | 'silver' | 'gold';

/** Maps to BenefitGate.sol BenefitTier enum (0=None, 1=Bronze, 2=Silver, 3=Gold) */
export const BENEFIT_TIER_VALUES: Record<BenefitTierName, number> = {
  none: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

// ---------------------------------------------------------------------------
// Benefit Config
// ---------------------------------------------------------------------------

export interface VpsSpec {
  cpu: number;
  memoryMb: number;
  diskGb: number;
}

export interface ComputeSpec {
  vcpu: number;
  memoryGb: number;
  persistentState: boolean;
}

export interface BenefitConfig {
  tier: BenefitTierName;
  label: string;
  rateLimitPerMin: number;
  priorityQueue: boolean;
  feedbackBadge: boolean;
  vpsAccess: boolean;
  vpsSpec?: VpsSpec;
  dedicatedCompute: boolean;
  computeSpec?: ComputeSpec;
  customDomain: boolean;
  prioritySupport: boolean;
  analyticsDashboard: boolean;
}

export const BENEFIT_CONFIGS: Record<BenefitTierName, BenefitConfig> = {
  none: {
    tier: 'none',
    label: 'Unstaked (L0)',
    rateLimitPerMin: 10,
    priorityQueue: false,
    feedbackBadge: false,
    vpsAccess: false,
    dedicatedCompute: false,
    customDomain: false,
    prioritySupport: false,
    analyticsDashboard: false,
  },
  bronze: {
    tier: 'bronze',
    label: 'Bronze (L1)',
    rateLimitPerMin: 100,
    priorityQueue: true,
    feedbackBadge: true,
    vpsAccess: false,
    dedicatedCompute: false,
    customDomain: false,
    prioritySupport: false,
    analyticsDashboard: false,
  },
  silver: {
    tier: 'silver',
    label: 'Silver (L2)',
    rateLimitPerMin: 500,
    priorityQueue: true,
    feedbackBadge: true,
    vpsAccess: true,
    vpsSpec: { cpu: 1, memoryMb: 2048, diskGb: 20 },
    dedicatedCompute: false,
    customDomain: false,
    prioritySupport: false,
    analyticsDashboard: true,
  },
  gold: {
    tier: 'gold',
    label: 'Gold (L3)',
    rateLimitPerMin: 2000,
    priorityQueue: true,
    feedbackBadge: true,
    vpsAccess: true,
    vpsSpec: { cpu: 2, memoryMb: 4096, diskGb: 50 },
    dedicatedCompute: true,
    computeSpec: { vcpu: 2, memoryGb: 4, persistentState: true },
    customDomain: true,
    prioritySupport: true,
    analyticsDashboard: true,
  },
};

// ---------------------------------------------------------------------------
// Benefit Allocation (mirrors on-chain struct)
// ---------------------------------------------------------------------------

export interface BenefitAllocation {
  skillId: number;
  tier: BenefitTierName;
  tierValue: number;
  activatedAt: number;
  expiresAt: number;
  vpsId: string;
  computeId: string;
  config: BenefitConfig;
}

// ---------------------------------------------------------------------------
// Benefit Status (for API responses)
// ---------------------------------------------------------------------------

export interface BenefitStatus {
  skillId: number;
  currentTier: BenefitTierName;
  currentTierLabel: string;
  boostUnits: number;
  trustLevel: number;
  rateLimitPerMin: number;
  benefits: string[];
  allocation: BenefitAllocation | null;
  nextTier: BenefitTierName | null;
  boostUnitsToNextTier: number;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export interface ProvisioningRequest {
  skillId: number;
  tier: BenefitTierName;
  publisher: string;
}

export interface ProvisioningResult {
  skillId: number;
  tier: BenefitTierName;
  vpsId?: string;
  computeId?: string;
  provisionedAt: number;
}
