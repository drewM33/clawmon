/**
 * Register all ClawHub-synced skills on the SkillPaywall contract.
 *
 * The SkillPaywall.registerSkill() call is onlyOwner, so this script
 * must be run with the DEPLOYER_PRIVATE_KEY that deployed the contract.
 *
 * Usage:
 *   npx tsx scripts/register-skills-on-paywall.ts
 *
 * The script:
 *   1. Fetches the skill list from the running ClawMon API (or syncs from ClawHub)
 *   2. For each skill, checks if it is already registered on-chain
 *   3. If not, calls registerSkill(agentIdHash, publisher, pricePerCall, trustTier)
 */

import 'dotenv/config';
import { ethers } from 'ethers';

const RPC_URL = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.MONAD_PRIVATE_KEY;
const PAYWALL_ADDRESS = process.env.PAYWALL_CONTRACT_ADDRESS;
const API_BASE = `http://localhost:${process.env.PORT || 3001}/api`;

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_PRIVATE_KEY or MONAD_PRIVATE_KEY not set in .env');
  process.exit(1);
}
if (!PAYWALL_ADDRESS) {
  console.error('ERROR: PAYWALL_CONTRACT_ADDRESS not set in .env');
  process.exit(1);
}

const ABI = [
  'function owner() view returns (address)',
  'function registerSkill(bytes32 agentId, address publisher, uint256 pricePerCall, uint8 trustTier)',
  'function getSkillPricing(bytes32 agentId) view returns (uint256 pricePerCall, uint8 trustTier, bool active, address publisher, uint256 effectivePrice)',
  'function getRegisteredSkillCount() view returns (uint256)',
];

const TIER_MAP: Record<string, number> = {
  C: 0, CC: 1, CCC: 2,
  B: 3, BB: 4, BBB: 5,
  A: 6, AA: 7, AAA: 8,
};

const BASE_PRICE = ethers.parseEther('0.001'); // 0.001 MON

/** Batch size — send this many txs before waiting for confirmations */
const BATCH_SIZE = 10;

interface AgentEntry {
  agentId: string;
  name: string;
  publisher: string;
  hardenedTier: string;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  Register Skills on SkillPaywall');
  console.log('═'.repeat(70));
  console.log(`  Contract : ${PAYWALL_ADDRESS}`);
  console.log(`  RPC      : ${RPC_URL}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY!, provider);
  const contract = new ethers.Contract(PAYWALL_ADDRESS!, ABI, wallet);

  console.log(`  Wallet   : ${wallet.address}`);

  const owner = await contract.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`\nERROR: Wallet is not the contract owner (owner=${owner})`);
    process.exit(1);
  }
  console.log('  Owner check: PASS');
  console.log(`  Fallback publisher: ${wallet.address} (used when skill has no ETH address)\n`);

  // Fetch skills from the API
  let agents: AgentEntry[];
  try {
    const res = await fetch(`${API_BASE}/leaderboard`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    agents = await res.json() as AgentEntry[];
    console.log(`  Fetched ${agents.length} skills from API\n`);
  } catch (err) {
    console.error('ERROR: Could not fetch skills from API. Is the server running?');
    console.error('  Start it with: npm run dev:server');
    console.error('  Detail:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const registeredBefore = Number(await contract.getRegisteredSkillCount());
  console.log(`  Already registered on-chain: ${registeredBefore}\n`);

  let registered = 0;
  let skipped = 0;
  let failed = 0;

  // Build registration list (skip on-chain check — just attempt registration
  // and handle "Already registered" errors)
  const toRegister: Array<{ name: string; publisher: string; tierNum: number; tier: string; agentIdHash: string }> = [];

  for (const agent of agents) {
    const name = agent.agentId || agent.name;
    const rawPublisher = agent.publisher;
    const tier = agent.hardenedTier || 'BBB';
    const agentIdHash = ethers.id(name);
    const tierNum = TIER_MAP[tier] ?? 5;

    const isEthAddress = rawPublisher && /^0x[0-9a-fA-F]{40}$/.test(rawPublisher);
    const publisher = isEthAddress ? rawPublisher : wallet.address;

    toRegister.push({ name, publisher, tierNum, tier, agentIdHash });
  }

  console.log(`  Skills to register: ${toRegister.length}\n`);

  // Register sequentially — one tx at a time to avoid nonce issues
  for (let i = 0; i < toRegister.length; i++) {
    const skill = toRegister[i];
    try {
      const tx = await contract.registerSkill(skill.agentIdHash, skill.publisher, BASE_PRICE, skill.tierNum);
      const receipt = await tx.wait();
      registered++;
      if (registered % 50 === 0 || registered <= 5) {
        console.log(`  [${i + 1}/${toRegister.length}] ✓ ${skill.name} block=${receipt!.blockNumber}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Already registered')) {
        skipped++;
      } else {
        failed++;
        if (failed <= 5) {
          console.error(`  [${i + 1}/${toRegister.length}] ✗ ${skill.name}: ${msg.slice(0, 100)}`);
        }
      }
    }
  }

  const registeredAfter = Number(await contract.getRegisteredSkillCount());

  console.log('\n' + '═'.repeat(70));
  console.log(`  Done: ${registered} registered, ${skipped} skipped, ${failed} failed`);
  console.log(`  On-chain skill count: ${registeredBefore} → ${registeredAfter}`);
  console.log('═'.repeat(70));

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
