/**
 * Trusted ClawMon — Staking Types (Phase 4)
 *
 * TypeScript representations of the on-chain TrustStaking contract state.
 * Used by the integration layer, scoring engine, and dashboard API.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Mirrors the StakeTier enum in TrustStaking.sol */
export enum StakeTier {
  None = 0,
  Tier2Low = 1,
  Tier2Mid = 2,
  Tier2High = 3,
}

/** Human-readable tier labels */
export const STAKE_TIER_LABELS: Record<StakeTier, string> = {
  [StakeTier.None]: 'Unstaked',
  [StakeTier.Tier2Low]: 'Tier 2 — Low',
  [StakeTier.Tier2Mid]: 'Tier 2 — Mid',
  [StakeTier.Tier2High]: 'Tier 2 — High',
};

// ---------------------------------------------------------------------------
// Stake Info
// ---------------------------------------------------------------------------

/** Agent staking state read from the contract */
export interface AgentStakeInfo {
  agentId: string;           // human-readable (e.g. "gmail-integration")
  agentIdHash: string;       // bytes32 keccak hash
  publisher: string;         // Ethereum address
  stakeAmount: string;       // ETH in wei (as string for BigInt safety)
  delegatedStake: string;    // ETH in wei
  totalStake: string;        // ETH in wei
  stakedAt: number;          // unix timestamp (seconds)
  lastSlashTime: number;     // unix timestamp (seconds), 0 if never slashed
  active: boolean;
  tier: StakeTier;
  // Computed fields (not from contract)
  stakeAmountEth: number;    // ETH as float for display
  delegatedStakeEth: number;
  totalStakeEth: number;
}

// ---------------------------------------------------------------------------
// Slash Records
// ---------------------------------------------------------------------------

/** Slash event record from the contract */
export interface SlashRecord {
  agentId: string;           // human-readable
  agentIdHash: string;       // bytes32
  amount: string;            // ETH in wei
  amountEth: number;         // ETH as float
  reason: string;
  reporter: string;          // Ethereum address
  timestamp: number;         // unix timestamp (seconds)
}

// ---------------------------------------------------------------------------
// Unbonding
// ---------------------------------------------------------------------------

export interface UnbondingInfo {
  amount: string;            // wei
  amountEth: number;
  availableAt: number;       // unix timestamp (seconds)
  isReady: boolean;          // availableAt <= now
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

export interface DelegationInfo {
  curator: string;           // Ethereum address
  agentId: string;
  amount: string;            // wei
  amountEth: number;
}

// ---------------------------------------------------------------------------
// Aggregated staking stats for API
// ---------------------------------------------------------------------------

export interface StakingStats {
  totalAgentsStaked: number;
  totalStakedWei: string;
  totalStakedEth: number;
  totalSlashEvents: number;
  totalSlashedWei: string;
  totalSlashedEth: number;
  tierDistribution: Record<string, number>;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface AgentStakingResponse {
  stake: AgentStakeInfo | null;
  slashHistory: SlashRecord[];
  isStaked: boolean;
}

// ---------------------------------------------------------------------------
// Insurance Pool Types (Phase 6)
// ---------------------------------------------------------------------------

export enum ClaimStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
  Paid = 3,
}

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  [ClaimStatus.Pending]: 'Pending',
  [ClaimStatus.Approved]: 'Approved',
  [ClaimStatus.Rejected]: 'Rejected',
  [ClaimStatus.Paid]: 'Paid',
};

/** A single insurance claim */
export interface InsuranceClaim {
  id: number;
  claimant: string;           // Ethereum address
  agentId: string;            // human-readable skill name
  agentIdHash: string;        // bytes32 keccak hash
  amount: string;             // claimed loss in wei
  amountEth: number;          // claimed loss in ETH (for display)
  evidenceHash: string;       // evidence reference
  submittedAt: number;        // unix timestamp (seconds)
  status: ClaimStatus;
  payoutAmount: string;       // actual payout in wei (0 if not paid)
  payoutAmountEth: number;    // actual payout in ETH
  paidAt: number;             // unix timestamp (seconds), 0 if not paid
  approveVotes: number;
  rejectVotes: number;
}

/** Insurance pool aggregate state */
export interface InsurancePoolState {
  poolBalance: string;        // wei
  poolBalanceEth: number;     // ETH
  totalDeposited: string;     // wei
  totalDepositedEth: number;
  totalPaidOut: string;       // wei
  totalPaidOutEth: number;
  totalClaims: number;
  pendingClaims: number;
  approvedClaims: number;
  rejectedClaims: number;
  paidClaims: number;
}

/** Insurance API stats response */
export interface InsuranceStats {
  poolBalanceEth: number;
  totalDepositedEth: number;
  totalPaidOutEth: number;
  totalClaims: number;
  pendingClaims: number;
  approvedClaims: number;
  rejectedClaims: number;
  paidClaims: number;
  avgPayoutEth: number;
  coverageRatio: number;      // poolBalance / totalStaked — how much of staked value is insured
}

/** Insurance API response for single agent */
export interface AgentInsuranceResponse {
  agentId: string;
  isSlashed: boolean;
  claims: InsuranceClaim[];
  totalClaimedEth: number;
  totalPaidEth: number;
}

// ---------------------------------------------------------------------------
// Insurance Pool Yield Types
// ---------------------------------------------------------------------------

/** Yield information for a staker on an agent */
export interface YieldInfo {
  agentId: string;
  staker: string;
  availableYieldWei: string;
  availableYieldEth: number;
  totalClaimedWei: string;
  totalClaimedEth: number;
}

/** Insurance pool yield state (aggregate) */
export interface InsuranceYieldState {
  surplusThresholdWei: string;
  surplusThresholdEth: number;
  currentSurplusWei: string;
  currentSurplusEth: number;
  epochCapWei: string;
  epochCapEth: number;
  epochDistributedWei: string;
  epochDistributedEth: number;
  epochRemainingWei: string;
  epochRemainingEth: number;
  lastYieldEpoch: number;
  nextEpochAt: number;
}

// ---------------------------------------------------------------------------
// Delegation Revenue Types
// ---------------------------------------------------------------------------

/** Pending delegation revenue for a curator */
export interface DelegationRevenueInfo {
  curator: string;
  pendingRevenueWei: string;
  pendingRevenueEth: number;
}

/** Revenue distribution event for an agent */
export interface RevenueDepositEvent {
  agentId: string;
  amountWei: string;
  amountEth: number;
  delegatorCount: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Tenure Info
// ---------------------------------------------------------------------------

/** Tenure information for a staked agent */
export interface TenureInfo {
  agentId: string;
  stakedAt: number;
  lastSlashTime: number;
  cleanTenureSeconds: number;
  cleanTenureDays: number;
  tenureFraction: number;         // 0.0 to 1.0 (1.0 = target tenure reached)
}

// ---------------------------------------------------------------------------
// Contract constants (mirrored from Solidity)
// ---------------------------------------------------------------------------

export const STAKING_CONSTANTS = {
  MIN_STAKE_WEI: '10000000000000000',   // 0.01 ETH
  MIN_STAKE_ETH: 0.01,
  TIER2_MID_WEI: '50000000000000000',   // 0.05 ETH
  TIER2_MID_ETH: 0.05,
  TIER2_HIGH_WEI: '250000000000000000', // 0.25 ETH
  TIER2_HIGH_ETH: 0.25,
  UNBONDING_PERIOD_SECONDS: 7 * 24 * 60 * 60,
  REPORTER_BPS: 4000,
  INSURANCE_BPS: 3000,
  TREASURY_BPS: 2000,
  DELEGATOR_REVENUE_BPS: 2000,          // 20 % of publisher share to delegators
} as const;

export const INSURANCE_CONSTANTS = {
  MAX_PAYOUT_BPS: 5000,                // 50 % of pool per claim
  MIN_CLAIM_WEI: '1000000000000000',   // 0.001 ETH
  MIN_CLAIM_ETH: 0.001,
  QUORUM: 3,
  YIELD_CAP_BPS: 1000,                 // 10 % of surplus per epoch
  YIELD_EPOCH_SECONDS: 30 * 24 * 60 * 60, // 30 days
  SURPLUS_THRESHOLD_ETH: 1.0,          // default 1 ETH (testnet)
} as const;

export const TENURE_CONSTANTS = {
  TENURE_DISCOUNT_MAX_BPS: 1000,       // 10 % max protocol fee discount
  TENURE_TARGET_SECONDS: 90 * 24 * 60 * 60, // 90 days for full discount
  TENURE_BOOST_MAX: 8,                 // max +8 reputation score points
  TENURE_BOOST_TARGET_DAYS: 180,       // 6 months for full reputation boost
} as const;
