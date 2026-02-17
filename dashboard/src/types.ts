export type TrustTier = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'CC' | 'C';

export interface AgentSummary {
  agentId: string;
  name: string;
  publisher: string;
  category: string;
  description: string;
  flagged: boolean;
  isSybil: boolean;
  feedbackCount: number;
  naiveScore: number;
  naiveTier: TrustTier;
  hardenedScore: number;
  hardenedTier: TrustTier;
  stakeWeightedScore: number;
  stakeWeightedTier: TrustTier;
  scoreDelta: number;
  onChainWeight: number;
  // Staking fields (Phase 4)
  isStaked: boolean;
  stakeAmountEth: number;
  delegatedStakeEth: number;
  totalStakeEth: number;
  stakeTier: number;
  stakeTierLabel: string;
  slashCount: number;
  lastSlashTime: number;
  // Attestation fields (Phase 5)
  attestationStatus: AttestationStatus;
  attestedScore: number | null;
  attestedTier: string | null;
  attestedAt: number | null;
  attestationFresh: boolean;
  // TEE fields (Phase 8)
  teeStatus: TEEStatus;
  teeTier3Active: boolean;
  teeTrustWeight: number;
  teeVerifiedScore: number;
  teeVerifiedTier: string;
  teeCodeHashMatch: boolean;
  teeLastAttestation: number | null;
  teeAttestationCount: number;
}

export type AttestationStatus = 'active' | 'stale' | 'revoked' | 'none';

export interface AgentDetail extends AgentSummary {
  feedback: FeedbackEntry[];
  mitigationFlags: MitigationFlags;
  feedbackAuthPolicy: string;
}

export interface FeedbackEntry {
  id: string;
  clientAddress: string;
  value: number;
  timestamp: number;
  revoked: boolean;
}

export interface MitigationFlags {
  sybilMutual: number;
  velocityBurst: number;
  temporalDecay: number;
  newSubmitter: number;
  anomalyBurst: number;
}

export interface GraphNode {
  id: string;
  type: 'agent' | 'reviewer';
  label: string;
  tier?: TrustTier;
  score?: number;
  isSybil: boolean;
  isFlagged: boolean;
  feedbackCount?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  value: number;
  isMutual: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  sybilClusters: string[][];
}

export interface Stats {
  totalAgents: number;
  totalFeedback: number;
  uniqueReviewers: number;
  flaggedAgents: number;
  sybilAgents: number;
  sybilClustersDetected: number;
  tierDistribution: Record<string, number>;
  erc8004: {
    totalRegistered: number;
    estimatedLegit: number;
    noiseRatio: number;
  };
  clawmon: {
    totalSkills: number;
    confirmedMalicious: number;
  };
}

export const TIER_COLORS: Record<TrustTier, string> = {
  AAA: '#16a34a',
  AA: '#22c55e',
  A: '#4ade80',
  BBB: '#facc15',
  BB: '#f59e0b',
  B: '#f97316',
  CCC: '#ef4444',
  CC: '#dc2626',
  C: '#991b1b',
};

export const TIER_BG_COLORS: Record<TrustTier, string> = {
  AAA: '#052e16',
  AA: '#052e16',
  A: '#052e16',
  BBB: '#422006',
  BB: '#422006',
  B: '#431407',
  CCC: '#450a0a',
  CC: '#450a0a',
  C: '#450a0a',
};

// ---------------------------------------------------------------------------
// Staking Types (Phase 4)
// ---------------------------------------------------------------------------

export interface StakingOverviewItem {
  agentId: string;
  publisher: string;
  stakeAmountEth: number;
  delegatedStakeEth: number;
  totalStakeEth: number;
  tier: number;
  tierLabel: string;
  active: boolean;
  stakedAt: number;
  slashCount: number;
  totalSlashedEth: number;
}

export interface SlashRecord {
  agentId: string;
  agentIdHash: string;
  amount: string;
  amountEth: number;
  reason: string;
  reporter: string;
  timestamp: number;
}

export interface StakingStats {
  totalAgentsStaked: number;
  totalStakedEth: number;
  totalSlashEvents: number;
  totalSlashedEth: number;
  tierDistribution: Record<string, number>;
}

export interface AgentStakingDetail {
  stake: {
    agentId: string;
    publisher: string;
    stakeAmountEth: number;
    delegatedStakeEth: number;
    totalStakeEth: number;
    stakedAt: number;
    lastSlashTime: number;
    active: boolean;
    tier: number;
  } | null;
  slashHistory: SlashRecord[];
  isStaked: boolean;
}

export const STAKE_TIER_COLORS: Record<number, string> = {
  0: '#6b6b7b', // None — muted
  1: '#3b82f6', // Tier2Low — blue
  2: '#8b5cf6', // Tier2Mid — purple
  3: '#f59e0b', // Tier2High — gold
};

export const STAKE_TIER_LABELS: Record<number, string> = {
  0: 'Unstaked',
  1: 'Tier 2 — Low',
  2: 'Tier 2 — Mid',
  3: 'Tier 2 — High',
};

// ---------------------------------------------------------------------------
// Attestation Types (Phase 5)
// ---------------------------------------------------------------------------

export interface AttestationOverviewItem {
  agentId: string;
  status: AttestationStatus;
  score: number | null;
  tier: string | null;
  attestedAt: number | null;
  isFresh: boolean;
  revoked: boolean;
  sourceChain: string | null;
  feedbackCount: number;
}

export interface AttestationStats {
  totalAttested: number;
  totalAttestations: number;
  activeCount: number;
  staleCount: number;
  revokedCount: number;
  unAttestedCount: number;
  avgScore: number;
  tierDistribution: Record<string, number>;
  lastBridgeRun: number;
  contractAddress: string;
  sourceChain: string;
}

export interface AttestationDetail {
  status: AttestationStatus;
  record: {
    agentId: string;
    agentIdHash: string;
    score: number;
    tier: string;
    tierNum: number;
    feedbackCount: number;
    sourceTimestamp: number;
    attestedAt: number;
    sourceChain: string;
    revoked: boolean;
    isFresh: boolean;
  } | null;
  ageSeconds: number;
  attestationCount: number;
}

export const ATTESTATION_STATUS_COLORS: Record<AttestationStatus, string> = {
  active: '#22c55e',
  stale: '#f59e0b',
  revoked: '#ef4444',
  none: '#6b6b7b',
};

export const ATTESTATION_STATUS_LABELS: Record<AttestationStatus, string> = {
  active: 'Active',
  stale: 'Stale',
  revoked: 'Revoked',
  none: 'Not Attested',
};

// ---------------------------------------------------------------------------
// Insurance Pool Types (Phase 6)
// ---------------------------------------------------------------------------

export type ClaimStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paid';

export interface InsuranceClaim {
  id: number;
  claimant: string;
  agentId: string;
  agentIdHash: string;
  amount: string;
  amountEth: number;
  evidenceHash: string;
  submittedAt: number;
  status: number;                // 0=Pending, 1=Approved, 2=Rejected, 3=Paid
  payoutAmount: string;
  payoutAmountEth: number;
  paidAt: number;
  approveVotes: number;
  rejectVotes: number;
}

export interface InsurancePoolState {
  poolBalance: string;
  poolBalanceEth: number;
  totalDeposited: string;
  totalDepositedEth: number;
  totalPaidOut: string;
  totalPaidOutEth: number;
  totalClaims: number;
  pendingClaims: number;
  approvedClaims: number;
  rejectedClaims: number;
  paidClaims: number;
}

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
  coverageRatio: number;
}

export interface AgentInsurance {
  agentId: string;
  isSlashed: boolean;
  claims: InsuranceClaim[];
  totalClaimedEth: number;
  totalPaidEth: number;
}

export const CLAIM_STATUS_LABELS: Record<number, string> = {
  0: 'Pending',
  1: 'Approved',
  2: 'Rejected',
  3: 'Paid',
};

export const CLAIM_STATUS_COLORS: Record<number, string> = {
  0: '#f59e0b', // Pending — amber
  1: '#22c55e', // Approved — green
  2: '#ef4444', // Rejected — red
  3: '#3b82f6', // Paid — blue
};

// ---------------------------------------------------------------------------
// TEE Attestation Types (Phase 8)
// ---------------------------------------------------------------------------

export type TEEStatus = 'verified' | 'stale' | 'mismatch' | 'failed' | 'unregistered';

export interface TEEOverviewItem {
  agentId: string;
  status: TEEStatus;
  tier3Active: boolean;
  trustWeight: number;
  codeHash: string | null;
  pinnedCodeHash: string | null;
  codeHashMatch: boolean;
  executionTimeMs: number | null;
  apiCallCount: number | null;
  errorCount: number | null;
  lastAttestationTime: number | null;
  attestationCount: number;
  platformType: string | null;
}

export interface TEEStats {
  totalRegistered: number;
  verifiedCount: number;
  staleCount: number;
  mismatchCount: number;
  failedCount: number;
  unregisteredCount: number;
  tier3ActiveCount: number;
  avgTrustWeight: number;
  avgExecutionTimeMs: number;
  totalAttestations: number;
  enclavePublicKey: string;
  platformType: string;
}

export interface TEEAgentDetail {
  agentId: string;
  status: TEEStatus;
  tier3Active: boolean;
  trustWeightMultiplier: number;
  attestationCount: number;
  successfulVerifications: number;
  failedVerifications: number;
  latestAttestation: {
    id: string;
    codeHash: string;
    executionTimeMs: number;
    apiCallCount: number;
    dataAccessCount: number;
    errorCount: number;
    timestamp: number;
    platformType: string;
  } | null;
  codeHashPin: {
    codeHash: string;
    pinnedAt: number;
    pinnedBy: string;
    auditReference?: string;
  } | null;
  verification: {
    valid: boolean;
    signatureValid: boolean;
    codeHashMatch: boolean;
    platformVerified: boolean;
    reportFresh: boolean;
    behaviorClean: boolean;
    tier3Eligible: boolean;
    notes: string[];
  } | null;
}

export const TEE_STATUS_COLORS: Record<TEEStatus, string> = {
  verified: '#22c55e',
  stale: '#f59e0b',
  mismatch: '#ef4444',
  failed: '#dc2626',
  unregistered: '#6b6b7b',
};

export const TEE_STATUS_LABELS: Record<TEEStatus, string> = {
  verified: 'Verified',
  stale: 'Stale',
  mismatch: 'Mismatch',
  failed: 'Failed',
  unregistered: 'Unregistered',
};

// ---------------------------------------------------------------------------
// x402 Payment Types (Phase 9)
// ---------------------------------------------------------------------------

export interface PaymentOverviewItem {
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
  paymentVelocity: number;
  active: boolean;
}

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
  revenueByTier: {
    premium: number;
    standard: number;
    budget: number;
  };
  topSkills: Array<{
    agentId: string;
    revenueEth: number;
    paymentCount: number;
  }>;
}

export interface PaymentActivity {
  paymentId: string;
  agentId: string;
  caller: string;
  amount: number;
  trustTier: TrustTier;
  timestamp: number;
}

export interface PaymentTrustSignal {
  agentId: string;
  totalPayments: number;
  paymentVelocity: number;
  uniqueCallers: number;
  totalRevenueEth: number;
  paymentTrustWeight: number;
}

// ---------------------------------------------------------------------------
// Governance Types (Phase 10)
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

export type ParameterCategory =
  | 'scoring'
  | 'staking'
  | 'slashing'
  | 'insurance'
  | 'review'
  | 'tee'
  | 'cross-chain';

export interface GovernanceProposal {
  id: number;
  proposer: string;
  paramKey: string;
  paramKeyHash: string;
  oldValue: number;
  newValue: number;
  description: string;
  createdAt: number;
  votingDeadline: number;
  executionTime: number;
  status: ProposalStatus;
  forVotes: number;
  againstVotes: number;
  voterCount: number;
  quorumReached: boolean;
  majorityReached: boolean;
  timelockElapsed: boolean;
}

export interface GovernanceVote {
  proposalId: number;
  voter: string;
  voteType: VoteType;
  weight: number;
  timestamp: number;
}

export interface GovernableParameter {
  key: string;
  keyHash: string;
  value: number;
  unit: string;
  displayValue: string;
  category: ParameterCategory;
  description: string;
}

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
  participationRate: number;
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
  timeRemaining: number;
  approvalRate: number;
}

export interface ProposalDetail extends GovernanceProposal {
  votes: GovernanceVote[];
  parameter: GovernableParameter;
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  [ProposalStatus.Active]: 'Active',
  [ProposalStatus.Queued]: 'Queued',
  [ProposalStatus.Executed]: 'Executed',
  [ProposalStatus.Cancelled]: 'Cancelled',
  [ProposalStatus.Defeated]: 'Defeated',
};

export const PROPOSAL_STATUS_COLORS: Record<ProposalStatus, string> = {
  [ProposalStatus.Active]: '#3b82f6',
  [ProposalStatus.Queued]: '#f59e0b',
  [ProposalStatus.Executed]: '#22c55e',
  [ProposalStatus.Cancelled]: '#6b6b7b',
  [ProposalStatus.Defeated]: '#ef4444',
};

export const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  [VoteType.Against]: 'Against',
  [VoteType.For]: 'For',
};

export const PARAMETER_CATEGORY_LABELS: Record<ParameterCategory, string> = {
  scoring: 'Scoring',
  staking: 'Staking',
  slashing: 'Slashing',
  insurance: 'Insurance',
  review: 'Review',
  tee: 'TEE',
  'cross-chain': 'Cross-Chain',
};

export const PARAMETER_CATEGORY_COLORS: Record<ParameterCategory, string> = {
  scoring: '#22c55e',
  staking: '#8b5cf6',
  slashing: '#ef4444',
  insurance: '#3b82f6',
  review: '#f59e0b',
  tee: '#06b6d4',
  'cross-chain': '#ec4899',
};

export const TIER_BAND_COLORS = {
  premium: '#f59e0b',
  standard: '#3b82f6',
  budget: '#6b6b7b',
} as const;

export const TIER_BAND_LABELS = {
  premium: 'Premium (AAA/AA/A)',
  standard: 'Standard (BBB/BB/B)',
  budget: 'Budget (CCC/CC/C)',
} as const;

// ---------------------------------------------------------------------------
// WebSocket Event Types (Phase 7)
// ---------------------------------------------------------------------------

export interface WSScoreUpdate {
  agentId: string;
  naiveScore: number;
  hardenedScore: number;
  stakeWeightedScore: number;
  naiveTier: string;
  hardenedTier: string;
  stakeWeightedTier: string;
  scoreDelta: number;
  feedbackCount: number;
}

export interface WSLeaderboardUpdate {
  agents: Array<{
    agentId: string;
    naiveScore: number;
    hardenedScore: number;
    hardenedTier: string;
    stakeWeightedScore: number;
    scoreDelta: number;
    feedbackCount: number;
  }>;
}

export interface WSStatsUpdate {
  totalAgents: number;
  totalFeedback: number;
  uniqueReviewers: number;
  sybilClustersDetected: number;
}

export interface WSFeedbackNew {
  id: string;
  agentId: string;
  clientAddress: string;
  value: number;
  tag1?: string;
  timestamp: number;
}
