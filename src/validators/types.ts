/**
 * Trusted ClawMon — Validator Types (Phase 4)
 *
 * Data models for the skill validator (principal) system.
 * Validators propose and vote on slashes for malicious skills.
 */

// ---------------------------------------------------------------------------
// Proposal Status
// ---------------------------------------------------------------------------

export enum ProposalStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
  Executed = 3,
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  [ProposalStatus.Pending]: 'Pending',
  [ProposalStatus.Approved]: 'Approved',
  [ProposalStatus.Rejected]: 'Rejected',
  [ProposalStatus.Executed]: 'Executed',
};

// ---------------------------------------------------------------------------
// Slash Proposal
// ---------------------------------------------------------------------------

export interface SlashProposal {
  caseId: string;
  skillId: number;
  severityBps: number;
  reasonHash: string;
  evidenceURI: string;
  proposer: string;
  approvals: number;
  rejections: number;
  status: ProposalStatus;
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export interface SlashVote {
  caseId: string;
  validator: string;
  approve: boolean;
  txHash: string;
}

// ---------------------------------------------------------------------------
// Validator Info
// ---------------------------------------------------------------------------

export interface ValidatorInfo {
  address: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Governance Stats
// ---------------------------------------------------------------------------

export interface SlashGovernanceStats {
  validatorCount: number;
  slashQuorum: number;
  totalProposals: number;
  pendingProposals: number;
  executedProposals: number;
  rejectedProposals: number;
}

// ---------------------------------------------------------------------------
// API Responses
// ---------------------------------------------------------------------------

export interface ProposeSlashRequest {
  skillId: number;
  severityBps: number;
  reasonHash: string;
  evidenceURI: string;
  caseId: string;
}

export interface ProposeSlashResponse {
  success: boolean;
  caseId: string;
  txHash?: string;
  error?: string;
}

export interface VoteRequest {
  caseId: string;
  approve: boolean;
}

export interface VoteResponse {
  success: boolean;
  caseId: string;
  newApprovals: number;
  newRejections: number;
  status: ProposalStatus;
  txHash?: string;
  error?: string;
}
