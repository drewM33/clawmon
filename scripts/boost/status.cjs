/**
 * Get boost status for a Clawhub slug (reads from chain).
 *
 * Usage:
 *   SLUG=gmail-integration npx hardhat run scripts/boost/status.cjs --network monad --config hardhat.config.cjs
 *
 * Or use API when server running: curl http://localhost:3001/api/boost/gmail-integration
 */

require('dotenv/config');
const hre = require('hardhat');
const { ethers } = require('ethers');

const REGISTRY_ABI = [
  'function nextSkillId() view returns (uint256)',
  'function getSkillCore(uint256 skillId) view returns (address provider, uint8 risk, bool active)',
  'function getSkillBinding(uint256 skillId) view returns (bytes32 clawhubSkillId, bytes32 providerIdentityHash, bytes32 metadataHash)',
];

const ESCROW_ABI = [
  'function getSkillStake(uint256 skillId) view returns (uint256)',
  'function getBoostUnits(uint256 skillId) view returns (uint256)',
  'function getTrustLevel(uint256 skillId) view returns (uint8)',
];

const RISK = ['LOW', 'MEDIUM', 'HIGH'];

async function main() {
  const slug = process.env.SLUG || (() => { const i = process.argv.indexOf('--slug'); return i >= 0 ? process.argv[i + 1] : ''; })();
  if (!slug) {
    console.error('Missing SLUG. Example: SLUG=gmail-integration npx hardhat run scripts/boost/status.cjs --network monad');
    process.exit(1);
  }

  const registryAddr = process.env.SKILL_REGISTRY_ADDRESS;
  const escrowAddr = process.env.STAKE_ESCROW_ADDRESS;
  if (!registryAddr || !escrowAddr) {
    console.error('Missing SKILL_REGISTRY_ADDRESS or STAKE_ESCROW_ADDRESS in .env');
    process.exit(1);
  }

  const provider = hre.ethers.provider;
  const registry = new hre.ethers.Contract(registryAddr, REGISTRY_ABI, provider);
  const escrow = new hre.ethers.Contract(escrowAddr, ESCROW_ABI, provider);

  const targetHash = ethers.id(slug);
  const nextId = Number(await registry.nextSkillId());
  let skillId = null;

  for (let i = 1; i < nextId; i++) {
    const [clawhubSkillId] = await registry.getSkillBinding(i);
    if (clawhubSkillId.toLowerCase() === targetHash.toLowerCase()) {
      skillId = i;
      break;
    }
  }

  if (!skillId) {
    console.log('Skill not found:', slug);
    console.log('  clawhubSkillId hash:', targetHash);
    process.exit(0);
  }

  const [core, stake, units, level] = await Promise.all([
    registry.getSkillCore(skillId),
    escrow.getSkillStake(skillId),
    escrow.getBoostUnits(skillId),
    escrow.getTrustLevel(skillId),
  ]);

  console.log(JSON.stringify({
    slug,
    skillId,
    provider: core.provider,
    risk: RISK[Number(core.risk)] || 'UNKNOWN',
    active: core.active,
    trustLevel: Number(level),
    boostUnits: Number(units),
    totalStakeMon: parseFloat(ethers.formatEther(stake)),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
