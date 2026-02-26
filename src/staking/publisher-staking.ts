/**
 * Trusted ClawMon — Publisher Staking Orchestration (Phase 3)
 *
 * Off-chain client for publisher staking and community boost operations
 * on the StakeEscrow contract. Provides both publisher (provider-only)
 * and community boost (anyone) staking paths.
 *
 * Usage:
 *   import { stakeAsPublisher, boostSkill, getStakingOverview } from './publisher-staking.js';
 */

import { ethers } from 'ethers';
import { getProvider, getSigner } from '../monad/client.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STAKE_ESCROW_ADDRESS = process.env.STAKE_ESCROW_ADDRESS || '';

const ESCROW_ABI = [
  // Write
  'function stake(uint256 skillId) external payable',
  'function boostSkill(uint256 skillId) external payable',
  'function requestUnstake(uint256 skillId, uint256 amount) external',
  'function cancelUnstake(uint256 skillId) external',
  'function executeUnstake(uint256 skillId) external',
  // Read
  'function getSkillStake(uint256 skillId) view returns (uint256)',
  'function getSkillShares(uint256 skillId) view returns (uint256)',
  'function getBoostUnits(uint256 skillId) view returns (uint256)',
  'function getTrustLevel(uint256 skillId) view returns (uint8)',
  'function getProviderStake(uint256 skillId, address provider) view returns (uint256)',
  'function getProviderShares(uint256 skillId, address provider) view returns (uint256)',
  'function getAvailableProviderShares(uint256 skillId, address provider) view returns (uint256)',
  'function skillPublisher(uint256 skillId) view returns (address)',
  'function getPublisherStake(uint256 skillId) view returns (uint256)',
  'function getCommunityBoost(uint256 skillId) view returns (uint256)',
  'function unstakeCooldownSeconds() view returns (uint64)',
  'function pendingUnstake(uint256 skillId, address provider) view returns (uint256 shares, uint64 unlockTime)',
  // Events
  'event Staked(uint256 indexed skillId, address indexed provider, uint256 amount, uint256 mintedShares)',
  'event Boosted(uint256 indexed skillId, address indexed booster, uint256 amount, uint256 mintedShares)',
  'event TrustLevelChanged(uint256 indexed skillId, uint8 oldLevel, uint8 newLevel)',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StakeResult {
  skillId: number;
  staker: string;
  amountWei: string;
  amountMon: number;
  shares: string;
  type: 'publisher' | 'boost';
  newTrustLevel: number;
  txHash: string;
}

export interface StakingOverview {
  skillId: number;
  totalStakeWei: string;
  totalStakeMon: number;
  publisherStakeWei: string;
  publisherStakeMon: number;
  communityBoostWei: string;
  communityBoostMon: number;
  boostUnits: number;
  trustLevel: number;
  publisher: string;
  cooldownSeconds: number;
}

export interface UnstakeStatus {
  skillId: number;
  address: string;
  pendingShares: string;
  unlockTime: number;
  isReady: boolean;
  remainingSeconds: number;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _escrowRead: ethers.Contract | null = null;
let _escrowWrite: ethers.Contract | null = null;

function isConfigured(): boolean {
  return Boolean(STAKE_ESCROW_ADDRESS);
}

function getEscrowRead(): ethers.Contract {
  if (!_escrowRead) {
    if (!STAKE_ESCROW_ADDRESS) throw new Error('STAKE_ESCROW_ADDRESS not set');
    _escrowRead = new ethers.Contract(STAKE_ESCROW_ADDRESS, ESCROW_ABI, getProvider());
  }
  return _escrowRead;
}

function getEscrowWrite(): ethers.Contract {
  if (!_escrowWrite) {
    if (!STAKE_ESCROW_ADDRESS) throw new Error('STAKE_ESCROW_ADDRESS not set');
    _escrowWrite = new ethers.Contract(STAKE_ESCROW_ADDRESS, ESCROW_ABI, getSigner());
  }
  return _escrowWrite;
}

// ---------------------------------------------------------------------------
// Write: Publisher Stake (provider-only)
// ---------------------------------------------------------------------------

/**
 * Stake MON as the skill publisher (provider-only).
 * Sets the skillPublisher if not already set.
 */
export async function stakeAsPublisher(
  skillId: number,
  amountWei: string,
): Promise<StakeResult> {
  const contract = getEscrowWrite();
  const tx = await contract.stake(skillId, { value: amountWei });
  const receipt = await tx.wait();

  const staked = receipt.logs
    .map((log: ethers.Log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === 'Staked');

  const newLevel = await contract.getTrustLevel(skillId);

  return {
    skillId,
    staker: staked ? staked.args.provider : getSigner().address,
    amountWei,
    amountMon: parseFloat(ethers.formatEther(amountWei)),
    shares: staked ? staked.args.mintedShares.toString() : '0',
    type: 'publisher',
    newTrustLevel: Number(newLevel),
    txHash: receipt.hash,
  };
}

// ---------------------------------------------------------------------------
// Write: Community Boost (anyone)
// ---------------------------------------------------------------------------

/**
 * Boost a skill by staking MON (anyone can call).
 * Does NOT require being the skill provider.
 */
export async function boostSkill(
  skillId: number,
  amountWei: string,
): Promise<StakeResult> {
  const contract = getEscrowWrite();
  const tx = await contract.boostSkill(skillId, { value: amountWei });
  const receipt = await tx.wait();

  const boosted = receipt.logs
    .map((log: ethers.Log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === 'Boosted');

  const newLevel = await contract.getTrustLevel(skillId);

  return {
    skillId,
    staker: boosted ? boosted.args.booster : getSigner().address,
    amountWei,
    amountMon: parseFloat(ethers.formatEther(amountWei)),
    shares: boosted ? boosted.args.mintedShares.toString() : '0',
    type: 'boost',
    newTrustLevel: Number(newLevel),
    txHash: receipt.hash,
  };
}

// ---------------------------------------------------------------------------
// Write: Unstake
// ---------------------------------------------------------------------------

export async function requestUnstake(skillId: number, amountWei: string): Promise<string> {
  const tx = await getEscrowWrite().requestUnstake(skillId, amountWei);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function cancelUnstake(skillId: number): Promise<string> {
  const tx = await getEscrowWrite().cancelUnstake(skillId);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function executeUnstake(skillId: number): Promise<string> {
  const tx = await getEscrowWrite().executeUnstake(skillId);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ---------------------------------------------------------------------------
// Read: Overview
// ---------------------------------------------------------------------------

/**
 * Get full staking overview for a skill.
 */
export async function getStakingOverview(skillId: number): Promise<StakingOverview> {
  const escrow = getEscrowRead();
  const [
    totalStake,
    publisherStake,
    communityBoost,
    boostUnits,
    trustLevel,
    pub,
    cooldown,
  ] = await Promise.all([
    escrow.getSkillStake(skillId),
    escrow.getPublisherStake(skillId),
    escrow.getCommunityBoost(skillId),
    escrow.getBoostUnits(skillId),
    escrow.getTrustLevel(skillId),
    escrow.skillPublisher(skillId),
    escrow.unstakeCooldownSeconds(),
  ]);

  return {
    skillId,
    totalStakeWei: totalStake.toString(),
    totalStakeMon: parseFloat(ethers.formatEther(totalStake)),
    publisherStakeWei: publisherStake.toString(),
    publisherStakeMon: parseFloat(ethers.formatEther(publisherStake)),
    communityBoostWei: communityBoost.toString(),
    communityBoostMon: parseFloat(ethers.formatEther(communityBoost)),
    boostUnits: Number(boostUnits),
    trustLevel: Number(trustLevel),
    publisher: pub,
    cooldownSeconds: Number(cooldown),
  };
}

/**
 * Get unstake status for a specific address on a skill.
 */
export async function getUnstakeStatus(skillId: number, address: string): Promise<UnstakeStatus> {
  const [shares, unlockTime] = await getEscrowRead().pendingUnstake(skillId, address);
  const now = Math.floor(Date.now() / 1000);
  const unlock = Number(unlockTime);

  return {
    skillId,
    address,
    pendingShares: shares.toString(),
    unlockTime: unlock,
    isReady: unlock > 0 && now >= unlock,
    remainingSeconds: unlock > now ? unlock - now : 0,
  };
}

/**
 * Check if the staking contract is configured.
 */
export function isStakingConfigured(): boolean {
  return isConfigured();
}

export function resetClients(): void {
  _escrowRead = null;
  _escrowWrite = null;
}
