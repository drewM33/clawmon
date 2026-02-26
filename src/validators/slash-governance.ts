/**
 * Trusted ClawMon — Slash Governance Client (Phase 4)
 *
 * Off-chain client for the validator committee and slash proposal system.
 * Interfaces with the extended SlashingManager contract.
 *
 * Usage:
 *   import { proposeSlash, voteOnSlash, getProposal } from './slash-governance.js';
 */

import { ethers } from 'ethers';
import { getProvider, getSigner } from '../monad/client.js';
import type { SlashProposal, SlashGovernanceStats } from './types.js';
import { ProposalStatus } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SLASHING_MANAGER_ADDRESS = process.env.SLASHING_MANAGER_ADDRESS || '';

const SLASHING_ABI = [
  // Write
  'function proposeSlash(uint256 skillId, uint16 severityBps, bytes32 reasonHash, string evidenceURI, bytes32 caseId) external',
  'function voteOnSlash(bytes32 caseId, bool approve) external',
  // Read
  'function getProposal(bytes32 caseId) view returns (uint256 skillId, uint16 severityBps, bytes32 reasonHash, address proposer, uint256 approvals, uint256 rejections, uint8 status)',
  'function getProposalCount() view returns (uint256)',
  'function getProposalEvidenceURI(bytes32 caseId) view returns (string)',
  'function proposalCaseIds(uint256 index) view returns (bytes32)',
  'function isValidator(address) view returns (bool)',
  'function validatorCount() view returns (uint256)',
  'function slashQuorum() view returns (uint256)',
  'function hasVoted(bytes32, address) view returns (bool)',
  // Events
  'event SlashProposed(bytes32 indexed caseId, uint256 indexed skillId, address indexed proposer, uint16 severityBps, bytes32 reasonHash)',
  'event SlashVoted(bytes32 indexed caseId, address indexed validator, bool approve)',
  'event ProposalExecuted(bytes32 indexed caseId, uint256 indexed skillId, uint256 amount)',
  'event ProposalRejected(bytes32 indexed caseId, uint256 indexed skillId)',
];

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _read: ethers.Contract | null = null;
let _write: ethers.Contract | null = null;

function isConfigured(): boolean {
  return Boolean(SLASHING_MANAGER_ADDRESS);
}

function getRead(): ethers.Contract {
  if (!_read) {
    if (!SLASHING_MANAGER_ADDRESS) throw new Error('SLASHING_MANAGER_ADDRESS not set');
    _read = new ethers.Contract(SLASHING_MANAGER_ADDRESS, SLASHING_ABI, getProvider());
  }
  return _read;
}

function getWrite(): ethers.Contract {
  if (!_write) {
    if (!SLASHING_MANAGER_ADDRESS) throw new Error('SLASHING_MANAGER_ADDRESS not set');
    _write = new ethers.Contract(SLASHING_MANAGER_ADDRESS, SLASHING_ABI, getSigner());
  }
  return _write;
}

// ---------------------------------------------------------------------------
// Write: Propose & Vote
// ---------------------------------------------------------------------------

/**
 * Propose a slash for a malicious skill.
 * The proposer's vote is auto-counted as an approval.
 */
export async function proposeSlash(
  skillId: number,
  severityBps: number,
  reasonHash: string,
  evidenceURI: string,
  caseId: string,
): Promise<{ txHash: string }> {
  const tx = await getWrite().proposeSlash(skillId, severityBps, reasonHash, evidenceURI, caseId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Vote on a slash proposal.
 */
export async function voteOnSlash(
  caseId: string,
  approve: boolean,
): Promise<{ txHash: string }> {
  const tx = await getWrite().voteOnSlash(caseId, approve);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ---------------------------------------------------------------------------
// Read: Proposals
// ---------------------------------------------------------------------------

/**
 * Get a single proposal by caseId.
 */
export async function getProposal(caseId: string): Promise<SlashProposal> {
  const contract = getRead();
  const [skillId, severityBps, reasonHash, proposer, approvals, rejections, status] =
    await contract.getProposal(caseId);
  const evidenceURI = await contract.getProposalEvidenceURI(caseId);

  return {
    caseId,
    skillId: Number(skillId),
    severityBps: Number(severityBps),
    reasonHash,
    evidenceURI,
    proposer,
    approvals: Number(approvals),
    rejections: Number(rejections),
    status: Number(status) as ProposalStatus,
  };
}

/**
 * Get all proposals.
 */
export async function getAllProposals(): Promise<SlashProposal[]> {
  const contract = getRead();
  const count = Number(await contract.getProposalCount());
  const proposals: SlashProposal[] = [];

  for (let i = 0; i < count; i++) {
    const caseId = await contract.proposalCaseIds(i);
    proposals.push(await getProposal(caseId));
  }

  return proposals;
}

/**
 * Get pending proposals only.
 */
export async function getPendingProposals(): Promise<SlashProposal[]> {
  const all = await getAllProposals();
  return all.filter(p => p.status === ProposalStatus.Pending);
}

// ---------------------------------------------------------------------------
// Read: Validator info
// ---------------------------------------------------------------------------

/**
 * Check if an address is a validator.
 */
export async function checkIsValidator(address: string): Promise<boolean> {
  return getRead().isValidator(address);
}

/**
 * Check if a validator has voted on a proposal.
 */
export async function checkHasVoted(caseId: string, address: string): Promise<boolean> {
  return getRead().hasVoted(caseId, address);
}

/**
 * Get governance stats.
 */
export async function getGovernanceStats(): Promise<SlashGovernanceStats> {
  const contract = getRead();
  const [vCount, quorum, proposalCount] = await Promise.all([
    contract.validatorCount(),
    contract.slashQuorum(),
    contract.getProposalCount(),
  ]);

  const all = await getAllProposals();
  const pending = all.filter(p => p.status === ProposalStatus.Pending).length;
  const executed = all.filter(p => p.status === ProposalStatus.Executed).length;
  const rejected = all.filter(p => p.status === ProposalStatus.Rejected).length;

  return {
    validatorCount: Number(vCount),
    slashQuorum: Number(quorum),
    totalProposals: Number(proposalCount),
    pendingProposals: pending,
    executedProposals: executed,
    rejectedProposals: rejected,
  };
}

export function isGovernanceConfigured(): boolean {
  return isConfigured();
}

export function resetClients(): void {
  _read = null;
  _write = null;
}
