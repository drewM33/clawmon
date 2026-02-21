/**
 * Slash a skill (slash authority only).
 *
 * Usage:
 *   SKILL_ID=1 SEVERITY_BPS=5000 REASON="DATA_EXFILTRATION" npx hardhat run scripts/boost/slash-skill.cjs --network monad --config hardhat.config.cjs
 *
 * Optional: EVIDENCE_URI=ipfs://... CASE_ID=0x... (auto-generated if omitted)
 */

require('dotenv/config');
const hre = require('hardhat');
const { ethers } = require('ethers');

const SLASHING_ABI = [
  'function slashSkill(uint256 skillId, uint16 severityBps, bytes32 reasonHash, string calldata evidenceURI, bytes32 caseId)',
];

const ESCROW_ABI = [
  'function getSkillStake(uint256 skillId) view returns (uint256)',
  'function getBoostUnits(uint256 skillId) view returns (uint256)',
  'function getTrustLevel(uint256 skillId) view returns (uint8)',
];

async function main() {
  const skillId = parseInt(process.env.SKILL_ID || '0', 10);
  const severityBps = parseInt(process.env.SEVERITY_BPS || '5000', 10); // 50%
  const reason = process.env.REASON || 'MALICIOUS_BEHAVIOR';
  const evidenceUri = process.env.EVIDENCE_URI || 'ipfs://demo/evidence-slash';
  const caseId = process.env.CASE_ID ? ethers.hexlify(ethers.getBytes(process.env.CASE_ID)) : ethers.id(`${skillId}-${Date.now()}-${reason}`);

  if (!skillId) {
    console.error('Missing SKILL_ID. Example: SKILL_ID=1 SEVERITY_BPS=5000 REASON=DATA_EXFIL npx hardhat run scripts/boost/slash-skill.cjs --network monad');
    process.exit(1);
  }

  const slashingAddr = process.env.SLASHING_MANAGER_ADDRESS;
  const escrowAddr = process.env.STAKE_ESCROW_ADDRESS;
  if (!slashingAddr || !escrowAddr) {
    console.error('Missing SLASHING_MANAGER_ADDRESS or STAKE_ESCROW_ADDRESS in .env');
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const slashing = new hre.ethers.Contract(slashingAddr, SLASHING_ABI, signer);
  const escrow = new hre.ethers.Contract(escrowAddr, ESCROW_ABI, signer);

  const reasonHash = ethers.id(reason);
  const stakedBefore = await escrow.getSkillStake(skillId);
  const levelBefore = await escrow.getTrustLevel(skillId);
  const amountSlashed = (stakedBefore * BigInt(severityBps)) / 10000n;

  console.log('Slashing skill', skillId);
  console.log('  Reason:', reason, '| severity:', severityBps / 100, '%');
  console.log('  Staked before:', hre.ethers.formatEther(stakedBefore), 'MON');
  console.log('  Amount to slash:', hre.ethers.formatEther(amountSlashed), 'MON');
  console.log('  Level before:', levelBefore);
  console.log('  caseId:', caseId);

  const tx = await slashing.slashSkill(skillId, severityBps, reasonHash, evidenceUri, caseId);
  const rec = await tx.wait();

  const levelAfter = await escrow.getTrustLevel(skillId);
  const stakeAfter = await escrow.getSkillStake(skillId);

  console.log('\nSlash executed. TX:', rec.hash);
  console.log('  Level after:', levelAfter);
  console.log('  Staked after:', hre.ethers.formatEther(stakeAfter), 'MON');
}

main().catch((e) => { console.error(e); process.exit(1); });
