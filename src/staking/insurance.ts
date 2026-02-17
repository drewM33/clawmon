/**
 * Trusted ClawMon — Insurance Pool Integration (Phase 6)
 *
 * Manages the community insurance pool funded by slash proceeds (30 %)
 * and protocol treasury revenue (5 %). Handles claim submission,
 * arbiter approval, and payout tracking.
 *
 * Provides:
 *   1. Simulated pool state for local dev / demo
 *   2. Claim lifecycle management
 *   3. Stats aggregation for the dashboard API
 */

import { ethers } from 'ethers';
import type {
  InsuranceClaim,
  InsurancePoolState,
  InsuranceStats,
  AgentInsuranceResponse,
  InsuranceYieldState,
  SlashRecord,
} from './types.js';
import { ClaimStatus, INSURANCE_CONSTANTS } from './types.js';
import { getProvider as getMonadProvider } from '../monad/client.js';

// ---------------------------------------------------------------------------
// On-Chain Contract (InsurancePool.sol)
// ---------------------------------------------------------------------------

const INSURANCE_ABI = [
  'function getPoolStats() view returns (uint256 poolBalance, uint256 totalDeposited, uint256 totalPaidOut, uint256 totalClaims, uint256 pendingClaims, uint256 approvedClaims, uint256 rejectedClaims, uint256 paidClaims)',
  'function getClaim(uint256 claimId) view returns (uint256 id, address claimant, bytes32 agentId, uint256 amount, bytes32 evidenceHash, uint256 submittedAt, uint8 status, uint256 payoutAmount, uint256 paidAt, uint256 approveVotes, uint256 rejectVotes)',
  'function getClaimCount() view returns (uint256)',
  'function isAgentSlashed(bytes32 agentId) view returns (bool)',
  'function poolBalance() view returns (uint256)',
  'function totalDeposited() view returns (uint256)',
  'function totalPaidOut() view returns (uint256)',
  'function claimIds(uint256 index) view returns (uint256)',
];

const INSURANCE_ADDRESS = process.env.INSURANCE_CONTRACT_ADDRESS || '';

let _insuranceContract: ethers.Contract | null = null;
function getInsuranceContract(): ethers.Contract | null {
  if (!INSURANCE_ADDRESS) return null;
  if (!_insuranceContract) {
    _insuranceContract = new ethers.Contract(INSURANCE_ADDRESS, INSURANCE_ABI, getMonadProvider());
  }
  return _insuranceContract;
}

/**
 * Load insurance pool data from the deployed InsurancePool contract.
 * Populates the in-memory cache so existing getter functions work.
 */
export async function loadInsuranceFromChain(agentNames: string[]): Promise<void> {
  simulatedPoolBalance = 0;
  simulatedTotalDeposited = 0;
  simulatedTotalPaidOut = 0;
  simulatedClaims.length = 0;
  slashedAgentIds.clear();
  nextClaimId = 0;

  const contract = getInsuranceContract();
  if (!contract) {
    console.log('  [insurance] No contract configured — insurance data will be empty');
    return;
  }

  try {
    // Read pool stats
    const stats = await contract.getPoolStats();
    simulatedPoolBalance = parseFloat(ethers.formatEther(stats.poolBalance));
    simulatedTotalDeposited = parseFloat(ethers.formatEther(stats.totalDeposited));
    simulatedTotalPaidOut = parseFloat(ethers.formatEther(stats.totalPaidOut));

    // Read claims
    const claimCount = Number(stats.totalClaims);
    for (let i = 0; i < claimCount; i++) {
      try {
        const claimId = Number(await contract.claimIds(i));
        const c = await contract.getClaim(claimId);
        const hash = c.agentId;

        simulatedClaims.push({
          id: Number(c.id),
          claimant: c.claimant,
          agentId: hash,
          agentIdHash: hash,
          amount: c.amount.toString(),
          amountEth: parseFloat(ethers.formatEther(c.amount)),
          evidenceHash: c.evidenceHash,
          submittedAt: Number(c.submittedAt),
          status: Number(c.status) as ClaimStatus,
          payoutAmount: c.payoutAmount.toString(),
          payoutAmountEth: parseFloat(ethers.formatEther(c.payoutAmount)),
          paidAt: Number(c.paidAt),
          approveVotes: Number(c.approveVotes),
          rejectVotes: Number(c.rejectVotes),
        });
        nextClaimId = Math.max(nextClaimId, Number(c.id) + 1);
      } catch {
        // Skip claims that fail to read
      }
    }

    // Check which agents are slashed
    for (const name of agentNames) {
      try {
        const hash = ethers.id(name);
        const isSlashed = await contract.isAgentSlashed(hash);
        if (isSlashed) slashedAgentIds.add(name);
      } catch {
        // Skip
      }
    }

    console.log(`  [insurance] Loaded pool: ${simulatedPoolBalance.toFixed(4)} ETH balance, ${simulatedClaims.length} claims from chain`);
  } catch (err) {
    console.log('  [insurance] Failed to read from chain:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Simulated State
// ---------------------------------------------------------------------------

let simulatedPoolBalance = 0;    // ETH
let simulatedTotalDeposited = 0; // ETH
let simulatedTotalPaidOut = 0;   // ETH
const simulatedClaims: InsuranceClaim[] = [];
const slashedAgentIds = new Set<string>();
let nextClaimId = 0;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Seed simulated insurance pool data from slash history.
 * Called after staking data is seeded so slash records exist.
 */
export function seedSimulatedInsurance(
  slashHistory: SlashRecord[],
  agentNames: string[],
): void {
  // Reset state
  simulatedPoolBalance = 0;
  simulatedTotalDeposited = 0;
  simulatedTotalPaidOut = 0;
  simulatedClaims.length = 0;
  slashedAgentIds.clear();
  nextClaimId = 0;

  const now = Math.floor(Date.now() / 1000);

  // Fund pool from slash proceeds: 30% of each slash goes to insurance
  for (const slash of slashHistory) {
    const insuranceShare = slash.amountEth * 0.30;
    simulatedPoolBalance += insuranceShare;
    simulatedTotalDeposited += insuranceShare;
    slashedAgentIds.add(slash.agentId);
  }

  // Add simulated protocol treasury contribution (5% of a hypothetical 2 ETH revenue)
  const treasuryContribution = 2.0 * 0.05;
  simulatedPoolBalance += treasuryContribution;
  simulatedTotalDeposited += treasuryContribution;

  // Add some direct community deposits
  const communityDeposit = 0.05 + Math.random() * 0.1;
  simulatedPoolBalance += communityDeposit;
  simulatedTotalDeposited += communityDeposit;

  // Generate simulated claims for slashed agents
  for (const slash of slashHistory) {
    const numClaims = randomInt(1, 3);

    for (let i = 0; i < numClaims; i++) {
      const lossAmount = 0.005 + Math.random() * 0.03;
      const submittedAt = slash.timestamp + randomInt(3600, 86400 * 3);

      // Decide claim outcome based on probability
      const roll = Math.random();
      let status: ClaimStatus;
      let payoutAmount = 0;
      let paidAt = 0;
      let approveVotes = 0;
      let rejectVotes = 0;

      if (roll < 0.45) {
        // Paid claim
        status = ClaimStatus.Paid;
        const maxPayout = simulatedPoolBalance * (INSURANCE_CONSTANTS.MAX_PAYOUT_BPS / 10000);
        payoutAmount = Math.min(lossAmount, maxPayout);
        paidAt = submittedAt + randomInt(3600, 86400 * 2);
        approveVotes = 3;
        rejectVotes = randomInt(0, 1);
        simulatedPoolBalance -= payoutAmount;
        simulatedTotalPaidOut += payoutAmount;
      } else if (roll < 0.70) {
        // Pending claim
        status = ClaimStatus.Pending;
        approveVotes = randomInt(0, 2);
        rejectVotes = randomInt(0, 1);
      } else if (roll < 0.85) {
        // Approved (queued for payout)
        status = ClaimStatus.Approved;
        const maxPayout = simulatedPoolBalance * (INSURANCE_CONSTANTS.MAX_PAYOUT_BPS / 10000);
        payoutAmount = Math.min(lossAmount, maxPayout);
        approveVotes = 3;
        rejectVotes = randomInt(0, 2);
      } else {
        // Rejected
        status = ClaimStatus.Rejected;
        approveVotes = randomInt(0, 2);
        rejectVotes = 3;
      }

      const claimId = nextClaimId++;
      const claimantIndex = randomInt(0, 50);
      const hash = ethers.id(slash.agentId);

      simulatedClaims.push({
        id: claimId,
        claimant: `0xClaimant${String(claimantIndex).padStart(4, '0')}${'0'.repeat(30)}`,
        agentId: slash.agentId,
        agentIdHash: hash,
        amount: ethers.parseEther(lossAmount.toFixed(6)).toString(),
        amountEth: parseFloat(lossAmount.toFixed(6)),
        evidenceHash: ethers.id(`evidence-${slash.agentId}-${claimId}`),
        submittedAt,
        status,
        payoutAmount: ethers.parseEther(payoutAmount.toFixed(6)).toString(),
        payoutAmountEth: parseFloat(payoutAmount.toFixed(6)),
        paidAt,
        approveVotes,
        rejectVotes,
      });
    }
  }

  // Ensure pool balance stays non-negative
  if (simulatedPoolBalance < 0) simulatedPoolBalance = 0;
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/** Get all simulated claims */
export function getAllSimulatedClaims(): InsuranceClaim[] {
  return [...simulatedClaims];
}

/** Get simulated claims for a specific agent */
export function getSimulatedClaimsForAgent(agentId: string): InsuranceClaim[] {
  return simulatedClaims.filter(c => c.agentId === agentId);
}

/** Check if an agent has been slashed (eligible for claims) */
export function isAgentSlashed(agentId: string): boolean {
  return slashedAgentIds.has(agentId);
}

/** Get the current pool state */
export function getSimulatedPoolState(): InsurancePoolState {
  const pending = simulatedClaims.filter(c => c.status === ClaimStatus.Pending).length;
  const approved = simulatedClaims.filter(c => c.status === ClaimStatus.Approved).length;
  const rejected = simulatedClaims.filter(c => c.status === ClaimStatus.Rejected).length;
  const paid = simulatedClaims.filter(c => c.status === ClaimStatus.Paid).length;

  return {
    poolBalance: ethers.parseEther(simulatedPoolBalance.toFixed(6)).toString(),
    poolBalanceEth: parseFloat(simulatedPoolBalance.toFixed(6)),
    totalDeposited: ethers.parseEther(simulatedTotalDeposited.toFixed(6)).toString(),
    totalDepositedEth: parseFloat(simulatedTotalDeposited.toFixed(6)),
    totalPaidOut: ethers.parseEther(simulatedTotalPaidOut.toFixed(6)).toString(),
    totalPaidOutEth: parseFloat(simulatedTotalPaidOut.toFixed(6)),
    totalClaims: simulatedClaims.length,
    pendingClaims: pending,
    approvedClaims: approved,
    rejectedClaims: rejected,
    paidClaims: paid,
  };
}

// ---------------------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------------------

/**
 * Get insurance pool aggregate stats for the dashboard API.
 */
export function getInsuranceStats(totalStakedEth: number): InsuranceStats {
  const state = getSimulatedPoolState();

  const paidClaims = simulatedClaims.filter(c => c.status === ClaimStatus.Paid);
  const avgPayout = paidClaims.length > 0
    ? paidClaims.reduce((sum, c) => sum + c.payoutAmountEth, 0) / paidClaims.length
    : 0;

  const coverageRatio = totalStakedEth > 0
    ? state.poolBalanceEth / totalStakedEth
    : 0;

  return {
    poolBalanceEth: state.poolBalanceEth,
    totalDepositedEth: state.totalDepositedEth,
    totalPaidOutEth: state.totalPaidOutEth,
    totalClaims: state.totalClaims,
    pendingClaims: state.pendingClaims,
    approvedClaims: state.approvedClaims,
    rejectedClaims: state.rejectedClaims,
    paidClaims: state.paidClaims,
    avgPayoutEth: parseFloat(avgPayout.toFixed(6)),
    coverageRatio: parseFloat(coverageRatio.toFixed(4)),
  };
}

/**
 * Get insurance data for a specific agent.
 */
export function getAgentInsurance(agentId: string): AgentInsuranceResponse {
  const agentClaims = getSimulatedClaimsForAgent(agentId);

  const totalClaimed = agentClaims.reduce((sum, c) => sum + c.amountEth, 0);
  const totalPaid = agentClaims
    .filter(c => c.status === ClaimStatus.Paid)
    .reduce((sum, c) => sum + c.payoutAmountEth, 0);

  return {
    agentId,
    isSlashed: slashedAgentIds.has(agentId),
    claims: agentClaims,
    totalClaimedEth: parseFloat(totalClaimed.toFixed(6)),
    totalPaidEth: parseFloat(totalPaid.toFixed(6)),
  };
}

// ---------------------------------------------------------------------------
// Yield Simulation
// ---------------------------------------------------------------------------

/**
 * Get simulated insurance pool yield state.
 * Yield is available when poolBalance exceeds the surplus threshold.
 */
export function getSimulatedYieldState(): InsuranceYieldState {
  const surplusThreshold = INSURANCE_CONSTANTS.SURPLUS_THRESHOLD_ETH;
  const surplus = Math.max(0, simulatedPoolBalance - surplusThreshold);
  const epochCap = surplus * (INSURANCE_CONSTANTS.YIELD_CAP_BPS / 10000);
  const now = Math.floor(Date.now() / 1000);
  const lastEpoch = now - (now % INSURANCE_CONSTANTS.YIELD_EPOCH_SECONDS);
  const epochDistributed = 0; // Fresh simulation has no distributions
  const epochRemaining = Math.max(0, epochCap - epochDistributed);

  return {
    surplusThresholdWei: ethers.parseEther(surplusThreshold.toFixed(6)).toString(),
    surplusThresholdEth: surplusThreshold,
    currentSurplusWei: ethers.parseEther(surplus.toFixed(6)).toString(),
    currentSurplusEth: parseFloat(surplus.toFixed(6)),
    epochCapWei: ethers.parseEther(epochCap.toFixed(6)).toString(),
    epochCapEth: parseFloat(epochCap.toFixed(6)),
    epochDistributedWei: ethers.parseEther(epochDistributed.toFixed(6)).toString(),
    epochDistributedEth: epochDistributed,
    epochRemainingWei: ethers.parseEther(epochRemaining.toFixed(6)).toString(),
    epochRemainingEth: parseFloat(epochRemaining.toFixed(6)),
    lastYieldEpoch: lastEpoch,
    nextEpochAt: lastEpoch + INSURANCE_CONSTANTS.YIELD_EPOCH_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
