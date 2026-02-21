/**
 * Trusted ClawMon — Clawhub Boost/Slashing Contract Reads
 *
 * Reads the new SkillRegistry + StakeEscrow contracts and maps Clawhub
 * slug (agentId) to on-chain skillId via clawhubSkillId hash binding.
 */

import { ethers } from 'ethers';
import { getProvider as getMonadProvider } from '../monad/client.js';

const SKILL_REGISTRY_ADDRESS = process.env.SKILL_REGISTRY_ADDRESS || '';
const STAKE_ESCROW_ADDRESS = process.env.STAKE_ESCROW_ADDRESS || '';
const SLASHING_MANAGER_ADDRESS = process.env.SLASHING_MANAGER_ADDRESS || '';

const SKILL_REGISTRY_ABI = [
  'function nextSkillId() view returns (uint256)',
  'function getSkillCore(uint256 skillId) view returns (address provider, uint8 risk, bool active)',
  'function getSkillBinding(uint256 skillId) view returns (bytes32 clawhubSkillId, bytes32 providerIdentityHash, bytes32 metadataHash)',
];

const STAKE_ESCROW_ABI = [
  'function getSkillStake(uint256 skillId) view returns (uint256)',
  'function getBoostUnits(uint256 skillId) view returns (uint256)',
  'function getTrustLevel(uint256 skillId) view returns (uint8)',
];


let _registry: ethers.Contract | null = null;
let _escrow: ethers.Contract | null = null;

type SkillLookupCacheEntry = {
  skillId: number | null;
  expiresAt: number;
};

const skillLookupCache = new Map<string, SkillLookupCacheEntry>();
const LOOKUP_TTL_MS = 60_000;

export interface LastSlashInfo {
  skillId: number;
  amountMon: number;
  severityBps: number;
  reasonHash: string;
  evidenceURI: string;
  caseId: string;
  blockNumber: number;
  txHash: string;
}

export interface ClawhubBoostStatus {
  configured: boolean;
  agentId: string;
  exists: boolean;
  skillId: number | null;
  active: boolean;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  trustLevel: number;
  boostUnits: number;
  totalStakeMon: number;
  provider: string | null;
  clawhubSkillIdHash: string | null;
  providerIdentityHash: string | null;
  metadataHash: string | null;
  slashingManager: string | null;
  lastSlash: LastSlashInfo | null;
}

async function fetchLastSlash(skillId: number): Promise<LastSlashInfo | null> {
  if (!SLASHING_MANAGER_ADDRESS) return null;
  const provider = getMonadProvider();
  const iface = new ethers.Interface([
    'event SlashExecuted(uint256 indexed skillId, uint256 amount, uint16 severityBps, bytes32 indexed reasonHash, string evidenceURI, bytes32 indexed caseId)',
  ]);
  const topic0 = iface.getEvent('SlashExecuted')!.topicHash;
  const topic1 = ethers.toBeHex(skillId, 32);
  try {
    const logs = await provider.getLogs({
      address: SLASHING_MANAGER_ADDRESS as `0x${string}`,
      topics: [topic0 as `0x${string}`, topic1 as `0x${string}`],
      fromBlock: 0,
      toBlock: 'latest',
    });
    if (logs.length === 0) return null;
    const last = logs[logs.length - 1]!;
    const parsed = iface.parseLog({ topics: last.topics as string[], data: last.data });
    if (!parsed || parsed.name !== 'SlashExecuted') return null;
    return {
      skillId,
      amountMon: parseFloat(ethers.formatEther(parsed.args.amount)),
      severityBps: Number(parsed.args.severityBps),
      reasonHash: parsed.args.reasonHash,
      evidenceURI: parsed.args.evidenceURI,
      caseId: parsed.args.caseId,
      blockNumber: last.blockNumber,
      txHash: last.transactionHash ?? '',
    };
  } catch {
    return null;
  }
}

function isConfigured(): boolean {
  return Boolean(SKILL_REGISTRY_ADDRESS && STAKE_ESCROW_ADDRESS);
}

function getRegistry(): ethers.Contract | null {
  if (!isConfigured()) return null;
  if (!_registry) {
    _registry = new ethers.Contract(SKILL_REGISTRY_ADDRESS, SKILL_REGISTRY_ABI, getMonadProvider());
  }
  return _registry;
}

function getEscrow(): ethers.Contract | null {
  if (!isConfigured()) return null;
  if (!_escrow) {
    _escrow = new ethers.Contract(STAKE_ESCROW_ADDRESS, STAKE_ESCROW_ABI, getMonadProvider());
  }
  return _escrow;
}

function riskLabel(risk: number): 'LOW' | 'MEDIUM' | 'HIGH' | null {
  if (risk === 0) return 'LOW';
  if (risk === 1) return 'MEDIUM';
  if (risk === 2) return 'HIGH';
  return null;
}

async function resolveSkillIdByAgentId(agentId: string): Promise<number | null> {
  const now = Date.now();
  const cached = skillLookupCache.get(agentId);
  if (cached && cached.expiresAt > now) return cached.skillId;

  const registry = getRegistry();
  if (!registry) return null;

  const targetHash = ethers.id(agentId);
  let found: number | null = null;
  try {
    const nextSkillId = Number(await registry.nextSkillId());
    for (let i = 1; i < nextSkillId; i++) {
      const binding = await registry.getSkillBinding(i);
      if (String(binding.clawhubSkillId).toLowerCase() === targetHash.toLowerCase()) {
        found = i;
        break;
      }
    }
  } catch {
    found = null;
  }

  skillLookupCache.set(agentId, {
    skillId: found,
    expiresAt: now + LOOKUP_TTL_MS,
  });

  return found;
}

export async function getClawhubBoostStatus(agentId: string): Promise<ClawhubBoostStatus> {
  const registry = getRegistry();
  const escrow = getEscrow();
  if (!registry || !escrow) {
    return {
      configured: false,
      agentId,
      exists: false,
      skillId: null,
      active: false,
      riskTier: null,
      trustLevel: 0,
      boostUnits: 0,
      totalStakeMon: 0,
      provider: null,
      clawhubSkillIdHash: null,
      providerIdentityHash: null,
      metadataHash: null,
      slashingManager: SLASHING_MANAGER_ADDRESS || null,
      lastSlash: null,
    };
  }

  const skillId = await resolveSkillIdByAgentId(agentId);
  if (!skillId) {
    return {
      configured: true,
      agentId,
      exists: false,
      skillId: null,
      active: false,
      riskTier: null,
      trustLevel: 0,
      boostUnits: 0,
      totalStakeMon: 0,
      provider: null,
      clawhubSkillIdHash: ethers.id(agentId),
      providerIdentityHash: null,
      metadataHash: null,
      slashingManager: SLASHING_MANAGER_ADDRESS || null,
      lastSlash: null,
    };
  }

  try {
    const [core, binding, rawStake, rawBoostUnits, rawTrustLevel, lastSlash] = await Promise.all([
      registry.getSkillCore(skillId),
      registry.getSkillBinding(skillId),
      escrow.getSkillStake(skillId),
      escrow.getBoostUnits(skillId),
      escrow.getTrustLevel(skillId),
      fetchLastSlash(skillId),
    ]);

    return {
      configured: true,
      agentId,
      exists: true,
      skillId,
      active: Boolean(core.active),
      riskTier: riskLabel(Number(core.risk)),
      trustLevel: Number(rawTrustLevel),
      boostUnits: Number(rawBoostUnits),
      totalStakeMon: parseFloat(ethers.formatEther(rawStake)),
      provider: core.provider,
      clawhubSkillIdHash: binding.clawhubSkillId,
      providerIdentityHash: binding.providerIdentityHash,
      metadataHash: binding.metadataHash,
      slashingManager: SLASHING_MANAGER_ADDRESS || null,
      lastSlash,
    };
  } catch {
    return {
      configured: true,
      agentId,
      exists: false,
      skillId,
      active: false,
      riskTier: null,
      trustLevel: 0,
      boostUnits: 0,
      totalStakeMon: 0,
      provider: null,
      clawhubSkillIdHash: ethers.id(agentId),
      providerIdentityHash: null,
      metadataHash: null,
      slashingManager: SLASHING_MANAGER_ADDRESS || null,
      lastSlash: null,
    };
  }
}

export async function getClawhubBoostOverview(agentIds: string[]): Promise<ClawhubBoostStatus[]> {
  const results = await Promise.all(agentIds.map((id) => getClawhubBoostStatus(id)));
  return results;
}

export function getBoostConfig() {
  return {
    configured: isConfigured(),
    registryAddress: SKILL_REGISTRY_ADDRESS || null,
    escrowAddress: STAKE_ESCROW_ADDRESS || null,
    slashingManagerAddress: SLASHING_MANAGER_ADDRESS || null,
  };
}
