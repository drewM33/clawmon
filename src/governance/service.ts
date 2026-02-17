/**
 * Trusted ClawMon — Governance Service (Phase 10)
 *
 * In-memory governance simulation for the dashboard.
 * Seeds realistic proposals and votes on startup, provides
 * query functions consumed by the API endpoints.
 *
 * Mirrors the Governance.sol contract logic but runs off-chain
 * for fast dashboard rendering without requiring live contract reads.
 */

import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import {
  ProposalStatus,
  VoteType,
  DEFAULT_PARAMETERS,
  PROPOSAL_STATUS_LABELS,
} from './types.js';
import type {
  GovernanceProposal,
  GovernanceVote,
  GovernableParameter,
  GovernanceStats,
  ProposalListItem,
  ProposalDetail,
  ParameterCategory,
} from './types.js';
import { getProvider as getMonadProvider } from '../monad/client.js';

// ---------------------------------------------------------------------------
// On-Chain Contract (Governance.sol)
// ---------------------------------------------------------------------------

const GOVERNANCE_ABI = [
  'function getGovernanceStats() view returns (uint256 totalProposals, uint256 activeProposals, uint256 queuedProposals, uint256 executedProposals, uint256 cancelledProposals, uint256 defeatedProposals, uint256 totalParameters)',
  'function getProposalCount() view returns (uint256)',
  'function proposalIds(uint256 index) view returns (uint256)',
  'function getProposalCore(uint256 proposalId) view returns (uint256 id, address proposer, bytes32 paramKey, uint256 oldValue, uint256 newValue, string description, uint8 status)',
  'function getProposalVoting(uint256 proposalId) view returns (uint256 createdAt, uint256 votingDeadline, uint256 executionTime, uint256 forVotes, uint256 againstVotes, uint256 voterCount)',
  'function getParameterCount() view returns (uint256)',
  'function getParameterKeyAt(uint256 index) view returns (bytes32)',
  'function getParameter(bytes32 paramKey) view returns (uint256)',
  'function parameterExists(bytes32 paramKey) view returns (bool)',
];

const GOVERNANCE_ADDRESS = process.env.GOVERNANCE_CONTRACT_ADDRESS || '';
const QUORUM_ETH = 0.05;

let _govContract: ethers.Contract | null = null;
function getGovernanceContract(): ethers.Contract | null {
  if (!GOVERNANCE_ADDRESS) return null;
  if (!_govContract) {
    _govContract = new ethers.Contract(GOVERNANCE_ADDRESS, GOVERNANCE_ABI, getMonadProvider());
  }
  return _govContract;
}

/**
 * Load governance data from the deployed Governance contract.
 * Populates the in-memory cache so existing getter functions work.
 */
export async function loadGovernanceFromChain(): Promise<void> {
  proposalStore.clear();
  voteStore.clear();
  parameterStore.clear();
  nextProposalId = 0;

  const contract = getGovernanceContract();
  if (!contract) {
    console.log('  [governance] No contract configured — governance data will be empty');
    initializeParameters();
    return;
  }

  try {
    // Read parameters from chain
    const paramCount = Number(await contract.getParameterCount());
    const paramKeyToName = new Map<string, string>();

    // Build reverse lookup: keccak256(name) → name
    for (const p of DEFAULT_PARAMETERS) {
      const hash = ethers.id(p.key);
      paramKeyToName.set(hash, p.key);
    }

    for (let i = 0; i < paramCount; i++) {
      try {
        const keyHash = await contract.getParameterKeyAt(i);
        const value = Number(await contract.getParameter(keyHash));
        const knownName = paramKeyToName.get(keyHash);
        const defaultParam = knownName ? DEFAULT_PARAMETERS.find(p => p.key === knownName) : undefined;

        const key = knownName ?? keyHash;
        parameterStore.set(key, {
          key,
          keyHash,
          value,
          unit: defaultParam?.unit ?? 'raw',
          displayValue: defaultParam ? formatParamValue(value, defaultParam.unit) : String(value),
          category: (defaultParam?.category ?? 'scoring') as ParameterCategory,
          description: defaultParam?.description ?? `On-chain parameter ${keyHash.slice(0, 10)}...`,
        });
      } catch {
        // Skip parameters that fail to read
      }
    }

    // Read proposals from chain
    const proposalCount = Number(await contract.getProposalCount());
    for (let i = 0; i < proposalCount; i++) {
      try {
        const pId = Number(await contract.proposalIds(i));
        const core = await contract.getProposalCore(pId);
        const voting = await contract.getProposalVoting(pId);

        const paramKeyHash = core.paramKey;
        const paramName = paramKeyToName.get(paramKeyHash) ?? paramKeyHash;
        const status = Number(core.status) as ProposalStatus;
        const forVotes = parseFloat(ethers.formatEther(voting.forVotes));
        const againstVotes = parseFloat(ethers.formatEther(voting.againstVotes));
        const totalVotes = forVotes + againstVotes;

        const proposal: GovernanceProposal = {
          id: Number(core.id),
          proposer: core.proposer,
          paramKey: paramName,
          paramKeyHash,
          oldValue: Number(core.oldValue),
          newValue: Number(core.newValue),
          description: core.description,
          createdAt: Number(voting.createdAt) * 1000,
          votingDeadline: Number(voting.votingDeadline) * 1000,
          executionTime: Number(voting.executionTime) * 1000,
          status,
          forVotes,
          againstVotes,
          voterCount: Number(voting.voterCount),
          quorumReached: totalVotes >= QUORUM_ETH,
          majorityReached: forVotes > againstVotes,
          timelockElapsed: status === ProposalStatus.Executed,
        };

        proposalStore.set(Number(core.id), proposal);
        voteStore.set(Number(core.id), []);
        nextProposalId = Math.max(nextProposalId, Number(core.id) + 1);
      } catch {
        // Skip proposals that fail to read
      }
    }

    console.log(`  [governance] Loaded ${proposalStore.size} proposals, ${parameterStore.size} parameters from chain`);
  } catch (err) {
    console.log('  [governance] Failed to read from chain:', err instanceof Error ? err.message : err);
    initializeParameters();
  }
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const proposalStore = new Map<number, GovernanceProposal>();
const voteStore = new Map<number, GovernanceVote[]>();
const parameterStore = new Map<string, GovernableParameter>();
let nextProposalId = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paramKeyHash(key: string): string {
  return '0x' + createHash('sha256').update(key).digest('hex');
}

function formatParamValue(value: number, unit: string): string {
  switch (unit) {
    case 'bps':
      return `${(value / 100).toFixed(2)}%`;
    case 'ether':
      return `${value} ETH`;
    case 'wei':
      return `${value} wei`;
    case 'seconds': {
      if (value >= 86400) return `${(value / 86400).toFixed(0)} days`;
      if (value >= 3600) return `${(value / 3600).toFixed(0)} hours`;
      return `${value} seconds`;
    }
    default:
      return String(value);
  }
}

function randomAddress(seed: string, idx: number): string {
  const hash = createHash('sha256').update(`${seed}-voter-${idx}`).digest('hex');
  return '0x' + hash.slice(0, 40);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initializeParameters(): void {
  for (const param of DEFAULT_PARAMETERS) {
    parameterStore.set(param.key, {
      key: param.key,
      keyHash: paramKeyHash(param.key),
      value: param.value,
      unit: param.unit,
      displayValue: formatParamValue(param.value, param.unit),
      category: param.category,
      description: param.description,
    });
  }
}

// ---------------------------------------------------------------------------
// Seed Data
// ---------------------------------------------------------------------------

interface SeedProposal {
  paramKey: string;
  newValue: number;
  description: string;
  status: ProposalStatus;
  forVotesEth: number;
  againstVotesEth: number;
  voterCount: number;
  daysAgo: number;
}

const SEED_PROPOSALS: SeedProposal[] = [
  {
    paramKey: 'MIN_STAKE_WEI',
    newValue: 0.02,
    description: 'Double minimum stake to 0.02 ETH — Sybil attack cost analysis shows current 0.01 ETH minimum is too low for economic security. Doubling raises the cost of a 20-skill sybil ring from 0.2 ETH to 0.4 ETH.',
    status: ProposalStatus.Executed,
    forVotesEth: 0.35,
    againstVotesEth: 0.08,
    voterCount: 12,
    daysAgo: 14,
  },
  {
    paramKey: 'SLASH_REPORTER_BPS',
    newValue: 4500,
    description: 'Increase reporter reward from 40% to 45% — incentivize faster reporting of malicious skills. Community feedback indicates reporters feel under-compensated relative to the effort required.',
    status: ProposalStatus.Executed,
    forVotesEth: 0.22,
    againstVotesEth: 0.15,
    voterCount: 9,
    daysAgo: 10,
  },
  {
    paramKey: 'INSURANCE_MAX_PAYOUT_BPS',
    newValue: 6000,
    description: 'Raise insurance max payout from 50% to 60% of pool — victims of the recent crypto-wallet-helper exploit lost more than the 50% cap covered. Higher cap improves victim compensation without draining the pool.',
    status: ProposalStatus.Active,
    forVotesEth: 0.18,
    againstVotesEth: 0.04,
    voterCount: 7,
    daysAgo: 2,
  },
  {
    paramKey: 'SCORING_WEIGHT_STAKE',
    newValue: 250,
    description: 'Increase stake-weighted scoring multiplier from 2.00x to 2.50x — give more weight to staked reviewer opinions to further differentiate quality signals.',
    status: ProposalStatus.Active,
    forVotesEth: 0.06,
    againstVotesEth: 0.03,
    voterCount: 4,
    daysAgo: 1,
  },
  {
    paramKey: 'TEE_FRESHNESS_WINDOW',
    newValue: 43200,
    description: 'Reduce TEE freshness window from 24h to 12h — tighter attestation cadence catches code changes faster, strengthening Tier 3 guarantees.',
    status: ProposalStatus.Queued,
    forVotesEth: 0.12,
    againstVotesEth: 0.02,
    voterCount: 6,
    daysAgo: 5,
  },
  {
    paramKey: 'UNBONDING_PERIOD',
    newValue: 1209600,
    description: 'Extend unbonding period from 7 days to 14 days — recent incident where a publisher unstaked immediately before a slash proposal. Longer cooldown gives the community more time to file slash proposals.',
    status: ProposalStatus.Defeated,
    forVotesEth: 0.03,
    againstVotesEth: 0.09,
    voterCount: 5,
    daysAgo: 8,
  },
  {
    paramKey: 'REVIEW_BOND_WEI',
    newValue: 0.002,
    description: 'Double review bond from 0.001 ETH to 0.002 ETH — attestation poisoning attack cost analysis shows current bond is insufficient to deter mass fake reviews.',
    status: ProposalStatus.Cancelled,
    forVotesEth: 0.05,
    againstVotesEth: 0.01,
    voterCount: 3,
    daysAgo: 12,
  },
  {
    paramKey: 'FOREIGN_STAKE_DISCOUNT_BPS',
    newValue: 4000,
    description: 'Reduce foreign stake discount from 50% to 40% — cross-chain bridges have improved reliability, warranting more credit for foreign stakes.',
    status: ProposalStatus.Active,
    forVotesEth: 0.02,
    againstVotesEth: 0.01,
    voterCount: 2,
    daysAgo: 0,
  },
];

function generateVotes(proposalId: number, seed: SeedProposal): GovernanceVote[] {
  const votes: GovernanceVote[] = [];
  const baseTime = Date.now() - seed.daysAgo * 24 * 60 * 60 * 1000;

  // Distribute vote weight across voters
  const totalFor = seed.forVotesEth;
  const totalAgainst = seed.againstVotesEth;
  const forVoters = Math.max(1, Math.round(seed.voterCount * (totalFor / (totalFor + totalAgainst))));
  const againstVoters = seed.voterCount - forVoters;

  for (let i = 0; i < forVoters; i++) {
    const weight = totalFor / forVoters;
    votes.push({
      proposalId,
      voter: randomAddress(seed.paramKey, i),
      voteType: VoteType.For,
      weight: Math.round(weight * 10000) / 10000,
      timestamp: baseTime + (i + 1) * 3600 * 1000,
    });
  }

  for (let i = 0; i < againstVoters; i++) {
    const weight = totalAgainst / againstVoters;
    votes.push({
      proposalId,
      voter: randomAddress(seed.paramKey + '-against', i),
      voteType: VoteType.Against,
      weight: Math.round(weight * 10000) / 10000,
      timestamp: baseTime + (forVoters + i + 1) * 3600 * 1000,
    });
  }

  return votes;
}

export function seedGovernanceData(): void {
  initializeParameters();

  const QUORUM_ETH = 0.05;

  for (const seed of SEED_PROPOSALS) {
    const param = parameterStore.get(seed.paramKey);
    if (!param) continue;

    const id = nextProposalId++;
    const baseTime = Date.now() - seed.daysAgo * 24 * 60 * 60 * 1000;
    const votingDeadline = baseTime + 3 * 24 * 60 * 60 * 1000; // 3 days
    const totalVotes = seed.forVotesEth + seed.againstVotesEth;

    const proposal: GovernanceProposal = {
      id,
      proposer: randomAddress('owner', 0),
      paramKey: seed.paramKey,
      paramKeyHash: param.keyHash,
      oldValue: param.value,
      newValue: seed.newValue,
      description: seed.description,
      createdAt: baseTime,
      votingDeadline,
      executionTime: seed.status === ProposalStatus.Queued || seed.status === ProposalStatus.Executed
        ? votingDeadline + 24 * 60 * 60 * 1000
        : 0,
      status: seed.status,
      forVotes: seed.forVotesEth,
      againstVotes: seed.againstVotesEth,
      voterCount: seed.voterCount,
      quorumReached: totalVotes >= QUORUM_ETH,
      majorityReached: seed.forVotesEth > seed.againstVotesEth,
      timelockElapsed: seed.status === ProposalStatus.Executed,
    };

    proposalStore.set(id, proposal);
    voteStore.set(id, generateVotes(id, seed));

    // Apply executed proposals to parameters
    if (seed.status === ProposalStatus.Executed) {
      const p = parameterStore.get(seed.paramKey)!;
      p.value = seed.newValue;
      p.displayValue = formatParamValue(seed.newValue, p.unit);
    }
  }

  console.log(`Seeded governance: ${proposalStore.size} proposals, ${parameterStore.size} parameters`);
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

export function getGovernanceStats(): GovernanceStats {
  let active = 0, queued = 0, executed = 0, cancelled = 0, defeated = 0;
  let totalVotesCast = 0;
  let totalVoteWeightEth = 0;
  let quorumMet = 0;

  for (const [, p] of proposalStore) {
    switch (p.status) {
      case ProposalStatus.Active: active++; break;
      case ProposalStatus.Queued: queued++; break;
      case ProposalStatus.Executed: executed++; break;
      case ProposalStatus.Cancelled: cancelled++; break;
      case ProposalStatus.Defeated: defeated++; break;
    }
    totalVotesCast += p.voterCount;
    totalVoteWeightEth += p.forVotes + p.againstVotes;
    if (p.quorumReached) quorumMet++;
  }

  const total = proposalStore.size;

  return {
    totalProposals: total,
    activeProposals: active,
    queuedProposals: queued,
    executedProposals: executed,
    cancelledProposals: cancelled,
    defeatedProposals: defeated,
    totalParameters: parameterStore.size,
    totalVotesCast,
    totalVoteWeightEth: Math.round(totalVoteWeightEth * 10000) / 10000,
    participationRate: total > 0 ? Math.round((quorumMet / total) * 100) : 0,
  };
}

export function getAllProposals(): ProposalListItem[] {
  const now = Date.now();
  const items: ProposalListItem[] = [];

  for (const [, p] of proposalStore) {
    const totalVotes = p.forVotes + p.againstVotes;
    const approvalRate = totalVotes > 0
      ? Math.round((p.forVotes / totalVotes) * 100)
      : 0;

    let timeRemaining = 0;
    if (p.status === ProposalStatus.Active) {
      timeRemaining = Math.max(0, Math.floor((p.votingDeadline - now) / 1000));
    } else if (p.status === ProposalStatus.Queued) {
      timeRemaining = Math.max(0, Math.floor((p.executionTime - now) / 1000));
    }

    items.push({
      id: p.id,
      paramKey: p.paramKey,
      description: p.description,
      status: p.status,
      statusLabel: PROPOSAL_STATUS_LABELS[p.status],
      forVotes: p.forVotes,
      againstVotes: p.againstVotes,
      voterCount: p.voterCount,
      quorumReached: p.quorumReached,
      createdAt: p.createdAt,
      votingDeadline: p.votingDeadline,
      executionTime: p.executionTime,
      timeRemaining,
      approvalRate,
    });
  }

  // Sort: active first, then by creation date descending
  items.sort((a, b) => {
    const statusOrder: Record<ProposalStatus, number> = {
      [ProposalStatus.Active]: 0,
      [ProposalStatus.Queued]: 1,
      [ProposalStatus.Executed]: 2,
      [ProposalStatus.Defeated]: 3,
      [ProposalStatus.Cancelled]: 4,
    };
    const diff = statusOrder[a.status] - statusOrder[b.status];
    if (diff !== 0) return diff;
    return b.createdAt - a.createdAt;
  });

  return items;
}

export function getProposalDetail(proposalId: number): ProposalDetail | null {
  const proposal = proposalStore.get(proposalId);
  if (!proposal) return null;

  const votes = voteStore.get(proposalId) ?? [];
  const param = parameterStore.get(proposal.paramKey);

  if (!param) return null;

  return {
    ...proposal,
    votes,
    parameter: param,
  };
}

export function getAllParameters(): GovernableParameter[] {
  return Array.from(parameterStore.values());
}

export function getParametersByCategory(): Record<ParameterCategory, GovernableParameter[]> {
  const result: Record<ParameterCategory, GovernableParameter[]> = {
    scoring: [],
    staking: [],
    slashing: [],
    insurance: [],
    review: [],
    tee: [],
    'cross-chain': [],
  };

  for (const [, param] of parameterStore) {
    result[param.category].push(param);
  }

  return result;
}

export function getParameter(key: string): GovernableParameter | null {
  return parameterStore.get(key) ?? null;
}

export function getActiveProposals(): GovernanceProposal[] {
  return Array.from(proposalStore.values()).filter(
    p => p.status === ProposalStatus.Active || p.status === ProposalStatus.Queued,
  );
}

export function getProposalVotes(proposalId: number): GovernanceVote[] {
  return voteStore.get(proposalId) ?? [];
}

// ---------------------------------------------------------------------------
// Mutation Functions (for API simulation)
// ---------------------------------------------------------------------------

export function createProposal(
  paramKey: string,
  newValue: number,
  description: string,
  proposer: string,
): GovernanceProposal | null {
  const param = parameterStore.get(paramKey);
  if (!param) return null;
  if (param.value === newValue) return null;

  const id = nextProposalId++;
  const now = Date.now();

  const proposal: GovernanceProposal = {
    id,
    proposer,
    paramKey,
    paramKeyHash: param.keyHash,
    oldValue: param.value,
    newValue,
    description,
    createdAt: now,
    votingDeadline: now + 3 * 24 * 60 * 60 * 1000,
    executionTime: 0,
    status: ProposalStatus.Active,
    forVotes: 0,
    againstVotes: 0,
    voterCount: 0,
    quorumReached: false,
    majorityReached: false,
    timelockElapsed: false,
  };

  proposalStore.set(id, proposal);
  voteStore.set(id, []);

  return proposal;
}

export function castVote(
  proposalId: number,
  voter: string,
  voteType: VoteType,
  weightEth: number,
): GovernanceVote | null {
  const proposal = proposalStore.get(proposalId);
  if (!proposal || proposal.status !== ProposalStatus.Active) return null;

  const existingVotes = voteStore.get(proposalId) ?? [];
  if (existingVotes.some(v => v.voter === voter)) return null;

  const vote: GovernanceVote = {
    proposalId,
    voter,
    voteType,
    weight: weightEth,
    timestamp: Date.now(),
  };

  existingVotes.push(vote);
  voteStore.set(proposalId, existingVotes);

  if (voteType === VoteType.For) {
    proposal.forVotes += weightEth;
  } else {
    proposal.againstVotes += weightEth;
  }
  proposal.voterCount++;
  proposal.quorumReached = (proposal.forVotes + proposal.againstVotes) >= 0.05;
  proposal.majorityReached = proposal.forVotes > proposal.againstVotes;

  return vote;
}
