/**
 * Trusted ClawMon — Validators Module (Phase 4)
 */

export {
  proposeSlash,
  voteOnSlash,
  getProposal,
  getAllProposals,
  getPendingProposals,
  checkIsValidator,
  checkHasVoted,
  getGovernanceStats,
  isGovernanceConfigured,
  resetClients,
} from './slash-governance.js';

export type {
  SlashProposal,
  SlashVote,
  ValidatorInfo,
  SlashGovernanceStats,
  ProposeSlashRequest,
  ProposeSlashResponse,
  VoteRequest,
  VoteResponse,
} from './types.js';

export { ProposalStatus, PROPOSAL_STATUS_LABELS } from './types.js';
