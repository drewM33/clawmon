/**
 * Trusted ClawMon — Governance Types (Phase 10)
 *
 * TypeScript types mirroring the Governance.sol contract and
 * the off-chain governance service layer.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ProposalStatus {
  Active = 0,
  Queued = 1,
  Executed = 2,
  Cancelled = 3,
  Defeated = 4,
}

export enum VoteType {
  Against = 0,
  For = 1,
}

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

export interface GovernanceProposal {
  id: number;
  proposer: string;
  paramKey: string;           // human-readable parameter key
  paramKeyHash: string;       // bytes32 keccak256 hash
  oldValue: number;
  newValue: number;
  description: string;
  createdAt: number;          // unix timestamp
  votingDeadline: number;     // unix timestamp
  executionTime: number;      // unix timestamp (0 if not queued)
  status: ProposalStatus;
  forVotes: number;           // stake-weighted votes FOR (in ETH)
  againstVotes: number;       // stake-weighted votes AGAINST (in ETH)
  voterCount: number;
  quorumReached: boolean;
  majorityReached: boolean;
  timelockElapsed: boolean;
}

export interface GovernanceVote {
  proposalId: number;
  voter: string;
  voteType: VoteType;
  weight: number;             // ETH staked for this vote
  timestamp: number;
}

export interface GovernableParameter {
  key: string;
  keyHash: string;            // bytes32 keccak256
  value: number;
  unit: string;               // 'wei', 'bps', 'seconds', 'ether'
  displayValue: string;       // human-readable (e.g., "0.01 ETH", "40%")
  category: ParameterCategory;
  description: string;
}

export type ParameterCategory =
  | 'scoring'
  | 'staking'
  | 'slashing'
  | 'insurance'
  | 'review'
  | 'tee'
  | 'cross-chain';

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

export interface GovernanceStats {
  totalProposals: number;
  activeProposals: number;
  queuedProposals: number;
  executedProposals: number;
  cancelledProposals: number;
  defeatedProposals: number;
  totalParameters: number;
  totalVotesCast: number;
  totalVoteWeightEth: number;
  participationRate: number;  // percentage of proposals with quorum
}

export interface ProposalListItem {
  id: number;
  paramKey: string;
  description: string;
  status: ProposalStatus;
  statusLabel: string;
  forVotes: number;
  againstVotes: number;
  voterCount: number;
  quorumReached: boolean;
  createdAt: number;
  votingDeadline: number;
  executionTime: number;
  timeRemaining: number;      // seconds until deadline/execution
  approvalRate: number;       // percentage of FOR votes
}

export interface ProposalDetail extends GovernanceProposal {
  votes: GovernanceVote[];
  parameter: GovernableParameter;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  [ProposalStatus.Active]: 'Active',
  [ProposalStatus.Queued]: 'Queued',
  [ProposalStatus.Executed]: 'Executed',
  [ProposalStatus.Cancelled]: 'Cancelled',
  [ProposalStatus.Defeated]: 'Defeated',
};

export const PROPOSAL_STATUS_COLORS: Record<ProposalStatus, string> = {
  [ProposalStatus.Active]: '#3b82f6',     // blue
  [ProposalStatus.Queued]: '#f59e0b',     // amber
  [ProposalStatus.Executed]: '#22c55e',   // green
  [ProposalStatus.Cancelled]: '#6b6b7b',  // gray
  [ProposalStatus.Defeated]: '#ef4444',   // red
};

export const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  [VoteType.Against]: 'Against',
  [VoteType.For]: 'For',
};

/** Default protocol parameters with metadata for display */
export const DEFAULT_PARAMETERS: Array<{
  key: string;
  value: number;
  unit: string;
  category: ParameterCategory;
  description: string;
}> = [
  { key: 'SCORING_WEIGHT_NAIVE', value: 100, unit: 'bps', category: 'scoring', description: 'Naive scoring engine weight multiplier (basis points, 100 = 1.00x)' },
  { key: 'SCORING_WEIGHT_HARDENED', value: 150, unit: 'bps', category: 'scoring', description: 'Hardened scoring engine weight multiplier (basis points, 150 = 1.50x)' },
  { key: 'SCORING_WEIGHT_STAKE', value: 200, unit: 'bps', category: 'scoring', description: 'Stake-weighted scoring multiplier (basis points, 200 = 2.00x)' },
  { key: 'MIN_STAKE_WEI', value: 0.15, unit: 'ether', category: 'staking', description: 'Minimum MON stake required for Tier 2 listing' },
  { key: 'SLASH_REPORTER_BPS', value: 4000, unit: 'bps', category: 'slashing', description: 'Percentage of slashed funds sent to the reporter' },
  { key: 'SLASH_INSURANCE_BPS', value: 3000, unit: 'bps', category: 'slashing', description: 'Percentage of slashed funds sent to insurance pool' },
  { key: 'SLASH_TREASURY_BPS', value: 2000, unit: 'bps', category: 'slashing', description: 'Percentage of slashed funds sent to protocol treasury' },
  { key: 'SLASH_BURN_BPS', value: 1000, unit: 'bps', category: 'slashing', description: 'Percentage of slashed funds permanently burned' },
  { key: 'INSURANCE_MAX_PAYOUT_BPS', value: 5000, unit: 'bps', category: 'insurance', description: 'Maximum insurance payout as percentage of pool balance' },
  { key: 'INSURANCE_POOL_CAP_BPS', value: 5000, unit: 'bps', category: 'insurance', description: 'Insurance pool cap as percentage of total staked MON (5000 = 50%)' },
  { key: 'CHALLENGE_BOND_BPS', value: 1000, unit: 'bps', category: 'slashing', description: 'Challenge bond as percentage of target stake (1000 = 10%)' },
  { key: 'REVIEW_BOND_WEI', value: 0.001, unit: 'ether', category: 'review', description: 'MON bond required to submit a review' },
  { key: 'UNBONDING_PERIOD', value: 604800, unit: 'seconds', category: 'staking', description: 'Cooldown period before staked funds can be withdrawn' },
  { key: 'TEE_FRESHNESS_WINDOW', value: 86400, unit: 'seconds', category: 'tee', description: 'Maximum age of TEE attestation before considered stale' },
  { key: 'FOREIGN_STAKE_DISCOUNT_BPS', value: 5000, unit: 'bps', category: 'cross-chain', description: 'Discount applied to foreign-chain stake recognition' },
];
