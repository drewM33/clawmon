/**
 * Trusted ClawMon — Staking Contract Integration (Phase 4)
 *
 * Reads staking state from the deployed TrustStaking contract on Monad.
 * Falls back to simulated data when no contract is deployed (local dev).
 *
 * The integration layer provides:
 *   1. Agent stake info reads
 *   2. Slash history reads
 *   3. A simulated local mode for offline dashboard development
 */

import { ethers } from 'ethers';
import type {
  AgentStakeInfo,
  SlashRecord,
  StakingStats,
  AgentStakingResponse,
  UnbondingInfo,
} from './types.js';
import { StakeTier, STAKING_CONSTANTS } from './types.js';

// ---------------------------------------------------------------------------
// ABI (minimal — only the views we need)
// ---------------------------------------------------------------------------

const TRUST_STAKING_ABI = [
  'function getAgentStake(bytes32 agentId) view returns (address publisher, uint256 stakeAmount, uint256 delegatedStake, uint256 totalStake, uint256 stakedAt, uint256 lastSlashTime, bool active, uint8 tier)',
  'function getSlashHistoryLength() view returns (uint256)',
  'function getSlashRecord(uint256 index) view returns (bytes32 agentId, uint256 amount, string reason, address reporter, uint256 timestamp)',
  'function getAgentSlashHistory(bytes32 agentId) view returns (tuple(bytes32 agentId, uint256 amount, string reason, address reporter, uint256 timestamp)[])',
  'function getAgentCount() view returns (uint256)',
  'function agentIds(uint256 index) view returns (bytes32)',
  'function isAgentActive(bytes32 agentId) view returns (bool)',
  'function getDelegation(address curator, bytes32 agentId) view returns (uint256)',
  'function getUnbonding(address user, bytes32 agentId) view returns (uint256 amount, uint256 availableAt)',
];

// ---------------------------------------------------------------------------
// Provider & Contract Instance
// ---------------------------------------------------------------------------

const CONTRACT_ADDRESS = process.env.STAKING_CONTRACT_ADDRESS || '';

import { getProvider as getMonadProvider } from '../monad/client.js';

let _contract: ethers.Contract | null = null;

function getContract(): ethers.Contract | null {
  if (!CONTRACT_ADDRESS) return null;
  if (!_contract) {
    _contract = new ethers.Contract(CONTRACT_ADDRESS, TRUST_STAKING_ABI, getMonadProvider());
  }
  return _contract;
}

/** Convert agentId string to bytes32 keccak hash (matches contract) */
export function agentIdToHash(agentId: string): string {
  return ethers.id(agentId);
}

// ---------------------------------------------------------------------------
// On-Chain Reads
// ---------------------------------------------------------------------------

/**
 * Read staking info for an agent from the deployed contract.
 * Returns null if agent is not staked or contract unavailable.
 */
export async function readAgentStake(agentId: string): Promise<AgentStakeInfo | null> {
  const contract = getContract();
  if (!contract) return null;

  const hash = agentIdToHash(agentId);
  try {
    const result = await contract.getAgentStake(hash);
    if (result.publisher === ethers.ZeroAddress) return null;

    return {
      agentId,
      agentIdHash: hash,
      publisher: result.publisher,
      stakeAmount: result.stakeAmount.toString(),
      delegatedStake: result.delegatedStake.toString(),
      totalStake: result.totalStake.toString(),
      stakedAt: Number(result.stakedAt),
      lastSlashTime: Number(result.lastSlashTime),
      active: result.active,
      tier: Number(result.tier) as StakeTier,
      stakeAmountEth: parseFloat(ethers.formatEther(result.stakeAmount)),
      delegatedStakeEth: parseFloat(ethers.formatEther(result.delegatedStake)),
      totalStakeEth: parseFloat(ethers.formatEther(result.totalStake)),
    };
  } catch {
    return null;
  }
}

/**
 * Read slash history for an agent from the contract.
 */
export async function readAgentSlashHistory(agentId: string): Promise<SlashRecord[]> {
  const contract = getContract();
  if (!contract) return [];

  const hash = agentIdToHash(agentId);
  try {
    const records = await contract.getAgentSlashHistory(hash);
    return records.map((r: {
      agentId: string;
      amount: bigint;
      reason: string;
      reporter: string;
      timestamp: bigint;
    }) => ({
      agentId,
      agentIdHash: r.agentId,
      amount: r.amount.toString(),
      amountEth: parseFloat(ethers.formatEther(r.amount)),
      reason: r.reason,
      reporter: r.reporter,
      timestamp: Number(r.timestamp),
    }));
  } catch {
    return [];
  }
}

/**
 * Read full staking state for all staked agents.
 */
export async function readAllStakes(): Promise<Map<string, AgentStakeInfo>> {
  const contract = getContract();
  const stakes = new Map<string, AgentStakeInfo>();
  if (!contract) return stakes;

  try {
    const count = Number(await contract.getAgentCount());
    for (let i = 0; i < count; i++) {
      const hash = await contract.agentIds(i);
      const result = await contract.getAgentStake(hash);
      if (result.publisher !== ethers.ZeroAddress) {
        stakes.set(hash, {
          agentId: hash, // we don't have reverse mapping on-chain
          agentIdHash: hash,
          publisher: result.publisher,
          stakeAmount: result.stakeAmount.toString(),
          delegatedStake: result.delegatedStake.toString(),
          totalStake: result.totalStake.toString(),
          stakedAt: Number(result.stakedAt),
          lastSlashTime: Number(result.lastSlashTime),
          active: result.active,
          tier: Number(result.tier) as StakeTier,
          stakeAmountEth: parseFloat(ethers.formatEther(result.stakeAmount)),
          delegatedStakeEth: parseFloat(ethers.formatEther(result.delegatedStake)),
          totalStakeEth: parseFloat(ethers.formatEther(result.totalStake)),
        });
      }
    }
  } catch {
    // contract not available
  }

  return stakes;
}

// ---------------------------------------------------------------------------
// On-Chain Bulk Load (populates cache from deployed contract)
// ---------------------------------------------------------------------------

/**
 * Load all staking data from the deployed TrustStaking contract into the
 * in-memory cache. Called once at startup in LIVE_MODE so that all existing
 * getter functions return real on-chain data without code changes.
 */
export async function loadStakesFromChain(agentNames: string[]): Promise<void> {
  simulatedStakes.clear();
  simulatedSlashHistory.length = 0;

  const contract = getContract();
  if (!contract) {
    console.log('  [staking] No contract configured — staking data will be empty');
    return;
  }

  let loaded = 0;
  let slashCount = 0;

  // Read each agent's stake by name (computes keccak hash internally)
  for (const name of agentNames) {
    try {
      const stake = await readAgentStake(name);
      if (stake && stake.active) {
        simulatedStakes.set(name, stake);
        loaded++;
      }

      const slashes = await readAgentSlashHistory(name);
      if (slashes.length > 0) {
        simulatedSlashHistory.push(...slashes);
        slashCount += slashes.length;
      }
    } catch {
      // Skip agents that fail to read
    }
  }

  console.log(`  [staking] Loaded ${loaded} active stakes, ${slashCount} slash records from chain`);
}

// ---------------------------------------------------------------------------
// Simulated Data (for local dev / demo without deployed contract)
// ---------------------------------------------------------------------------

const simulatedStakes = new Map<string, AgentStakeInfo>();
const simulatedSlashHistory: SlashRecord[] = [];

/**
 * Generate simulated staking data for agents.
 * Used when STAKING_CONTRACT_ADDRESS is not set.
 */
export function seedSimulatedStakes(agentNames: string[]): void {
  simulatedStakes.clear();
  simulatedSlashHistory.length = 0;

  const now = Math.floor(Date.now() / 1000);

  // Staking profiles based on agent type
  const stakeProfiles: Record<string, { stake: number; delegated: number }> = {
    'gmail-integration': { stake: 0.15, delegated: 0.10 },
    'github-token': { stake: 0.12, delegated: 0.08 },
    'deep-research-agent': { stake: 0.30, delegated: 0.20 },
    'postgres-connector': { stake: 0.08, delegated: 0.02 },
    'slack-bridge': { stake: 0.10, delegated: 0.05 },
    'aws-toolkit': { stake: 0.25, delegated: 0.15 },
    'stripe-payments': { stake: 0.20, delegated: 0.12 },
    'openai-assistant': { stake: 0.18, delegated: 0.07 },
    'anthropic-claude': { stake: 0.22, delegated: 0.09 },
  };

  // Malicious agents — either no stake or previously slashed
  const malicious = new Set([
    'what-would-elon-do',
    'moltyverse-email',
    'youtube-data',
    'buy-anything',
    'prediction-markets-roarin',
    'prompt-log',
    'free-gpt-unlimited',
    'crypto-wallet-helper',
    'discord-nitro-gen',
    'ai-code-reviewer',
  ]);

  for (const name of agentNames) {
    const hash = ethers.id(name);

    if (malicious.has(name)) {
      // Some malicious agents were staked then slashed
      if (Math.random() > 0.5) {
        const originalStake = 0.05 + Math.random() * 0.10;
        const slashPercent = 0.5 + Math.random() * 0.5;
        const slashAmount = originalStake * slashPercent;
        const remaining = originalStake - slashAmount;

        simulatedStakes.set(name, {
          agentId: name,
          agentIdHash: hash,
          publisher: `0x${name.slice(0, 8).padEnd(40, '0')}`,
          stakeAmount: ethers.parseEther(remaining.toFixed(6)).toString(),
          delegatedStake: '0',
          totalStake: ethers.parseEther(remaining.toFixed(6)).toString(),
          stakedAt: now - 86400 * 14,
          lastSlashTime: now - 86400 * randomInt(1, 5),
          active: remaining >= 0.01,
          tier: remaining >= 0.25 ? StakeTier.Tier2High
              : remaining >= 0.05 ? StakeTier.Tier2Mid
              : remaining >= 0.01 ? StakeTier.Tier2Low
              : StakeTier.None,
          stakeAmountEth: remaining,
          delegatedStakeEth: 0,
          totalStakeEth: remaining,
        });

        const reasons = [
          'Confirmed credential leaking (Snyk)',
          'Malware distribution (Cisco)',
          'Session exfiltration detected',
          'Private key theft attempt',
          'Sybil ring participation',
        ];

        simulatedSlashHistory.push({
          agentId: name,
          agentIdHash: hash,
          amount: ethers.parseEther(slashAmount.toFixed(6)).toString(),
          amountEth: parseFloat(slashAmount.toFixed(6)),
          reason: reasons[randomInt(0, reasons.length - 1)],
          reporter: '0xReporter' + '0'.repeat(32),
          timestamp: now - 86400 * randomInt(1, 5),
        });
      }
      continue;
    }

    if (name.startsWith('sybil-')) continue;

    // Legitimate agents — assign stake
    const profile = stakeProfiles[name];
    const stakeEth = profile?.stake ?? (0.01 + Math.random() * 0.08);
    const delegatedEth = profile?.delegated ?? Math.random() * 0.03;
    const totalEth = stakeEth + delegatedEth;

    simulatedStakes.set(name, {
      agentId: name,
      agentIdHash: hash,
      publisher: `0x${name.slice(0, 8).padEnd(40, '0')}`,
      stakeAmount: ethers.parseEther(stakeEth.toFixed(6)).toString(),
      delegatedStake: ethers.parseEther(delegatedEth.toFixed(6)).toString(),
      totalStake: ethers.parseEther(totalEth.toFixed(6)).toString(),
      stakedAt: now - 86400 * randomInt(3, 14),
      lastSlashTime: 0,
      active: true,
      tier: totalEth >= 0.25 ? StakeTier.Tier2High
          : totalEth >= 0.05 ? StakeTier.Tier2Mid
          : StakeTier.Tier2Low,
      stakeAmountEth: parseFloat(stakeEth.toFixed(6)),
      delegatedStakeEth: parseFloat(delegatedEth.toFixed(6)),
      totalStakeEth: parseFloat(totalEth.toFixed(6)),
    });
  }
}

/** Get simulated stake for an agent */
export function getSimulatedStake(agentId: string): AgentStakeInfo | null {
  return simulatedStakes.get(agentId) ?? null;
}

/** Get simulated slash history for an agent */
export function getSimulatedSlashHistory(agentId: string): SlashRecord[] {
  return simulatedSlashHistory.filter(r => r.agentId === agentId);
}

/** Get all simulated slash records */
export function getAllSimulatedSlashHistory(): SlashRecord[] {
  return [...simulatedSlashHistory];
}

/** Get all simulated stakes */
export function getAllSimulatedStakes(): Map<string, AgentStakeInfo> {
  return new Map(simulatedStakes);
}

// ---------------------------------------------------------------------------
// Unified Access (prefers on-chain, falls back to simulated)
// ---------------------------------------------------------------------------

/**
 * Get staking info for an agent. Reads from on-chain if contract is deployed,
 * otherwise uses simulated data.
 */
export async function getAgentStaking(agentId: string): Promise<AgentStakingResponse> {
  if (CONTRACT_ADDRESS) {
    const [stake, slashHistory] = await Promise.all([
      readAgentStake(agentId),
      readAgentSlashHistory(agentId),
    ]);
    return {
      stake,
      slashHistory,
      isStaked: stake?.active ?? false,
    };
  }

  // Simulated fallback
  const stake = getSimulatedStake(agentId);
  const slashHistory = getSimulatedSlashHistory(agentId);
  return {
    stake,
    slashHistory,
    isStaked: stake?.active ?? false,
  };
}

/**
 * Get aggregate staking statistics.
 */
export async function getStakingStats(agentNames: string[]): Promise<StakingStats> {
  const stakes = CONTRACT_ADDRESS
    ? await readAllStakes()
    : getAllSimulatedStakes();

  let totalStakedWei = 0n;
  let totalSlashedWei = 0n;
  const tierDist: Record<string, number> = {
    None: 0, Tier2Low: 0, Tier2Mid: 0, Tier2High: 0,
  };

  for (const [, stake] of stakes) {
    totalStakedWei += BigInt(stake.totalStake);
    const tierName = StakeTier[stake.tier];
    tierDist[tierName] = (tierDist[tierName] || 0) + 1;
  }

  const allSlashes = CONTRACT_ADDRESS
    ? [] // Would need to read from contract
    : getAllSimulatedSlashHistory();

  for (const slash of allSlashes) {
    totalSlashedWei += BigInt(slash.amount);
  }

  return {
    totalAgentsStaked: stakes.size,
    totalStakedWei: totalStakedWei.toString(),
    totalStakedEth: parseFloat(ethers.formatEther(totalStakedWei)),
    totalSlashEvents: allSlashes.length,
    totalSlashedWei: totalSlashedWei.toString(),
    totalSlashedEth: parseFloat(ethers.formatEther(totalSlashedWei)),
    tierDistribution: tierDist,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
