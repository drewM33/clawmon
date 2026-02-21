/**
 * Register a Clawhub skill on-chain.
 *
 * Usage:
 *   SLUG=gmail-integration RISK=LOW npx hardhat run scripts/boost/register-skill.cjs --network monad --config hardhat.config.cjs
 *
 * Env:
 *   SLUG — Clawhub slug (exact string, e.g. gmail-integration)
 *   RISK — LOW | MEDIUM | HIGH (default: LOW)
 *   METADATA — optional, hashed as metadata (default: v1)
 */

require('dotenv/config');
const hre = require('hardhat');
const { ethers } = require('ethers');

const REGISTRY_ABI = [
  'function registerSkill(uint8 risk, bytes32 metadataHash, bytes32 clawhubSkillId, bytes32 providerIdentityHash) returns (uint256 skillId)',
  'function nextSkillId() view returns (uint256)',
];

const RISK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

async function main() {
  const slug = process.env.SLUG || (() => { const i = process.argv.indexOf('--slug'); return i >= 0 ? process.argv[i + 1] : null; })();
  if (!slug) {
    console.error('Missing SLUG. Example: SLUG=gmail-integration npx hardhat run scripts/boost/register-skill.cjs --network monad');
    process.exit(1);
  }

  const riskStr = (process.env.RISK || 'LOW').toUpperCase();
  const risk = RISK[riskStr] ?? 0;
  const metadata = process.env.METADATA || 'v1';
  const providerId = process.env.PROVIDER_ID || `provider:${slug}`;

  const registryAddr = process.env.SKILL_REGISTRY_ADDRESS;
  if (!registryAddr) {
    console.error('Missing SKILL_REGISTRY_ADDRESS in .env');
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const registry = new hre.ethers.Contract(registryAddr, REGISTRY_ABI, signer);

  const metadataHash = ethers.id(metadata);
  const clawhubSkillId = ethers.id(slug);
  const providerIdentityHash = ethers.id(providerId);

  console.log('Registering skill:', { slug, risk: riskStr, provider: signer.address });
  console.log('  clawhubSkillId:', clawhubSkillId);
  console.log('  providerIdentityHash:', providerIdentityHash);

  const nextBefore = await registry.nextSkillId();
  const tx = await registry.registerSkill(risk, metadataHash, clawhubSkillId, providerIdentityHash);
  const rec = await tx.wait();
  const skillId = nextBefore; // new skill gets this id

  console.log('\nRegistered skillId:', Number(skillId));
  console.log('TX:', rec.hash);
  console.log('\nNext: Stake with:');
  console.log(`  SKILL_ID=${Number(skillId)} AMOUNT_MON=14 npx hardhat run scripts/boost/stake-skill.cjs --network monad --config hardhat.config.cjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
