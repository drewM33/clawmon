/**
 * Stake MON on a registered skill (provider only).
 *
 * Usage:
 *   SKILL_ID=1 AMOUNT_MON=14 npx hardhat run scripts/boost/stake-skill.cjs --network monad --config hardhat.config.cjs
 *
 * Boost levels (LOW risk, 1 MON/unit): L1=2, L2=7, L3=14 MON
 */

require('dotenv/config');
const hre = require('hardhat');

const ESCROW_ABI = [
  'function stake(uint256 skillId) payable',
  'function getSkillStake(uint256 skillId) view returns (uint256)',
  'function getBoostUnits(uint256 skillId) view returns (uint256)',
  'function getTrustLevel(uint256 skillId) view returns (uint8)',
];

async function main() {
  const skillId = parseInt(process.env.SKILL_ID || '0', 10);
  const amountMon = parseFloat(process.env.AMOUNT_MON || '0');
  if (!skillId || amountMon <= 0) {
    console.error('Missing SKILL_ID and AMOUNT_MON. Example: SKILL_ID=1 AMOUNT_MON=14 npx hardhat run scripts/boost/stake-skill.cjs --network monad');
    process.exit(1);
  }

  const escrowAddr = process.env.STAKE_ESCROW_ADDRESS;
  if (!escrowAddr) {
    console.error('Missing STAKE_ESCROW_ADDRESS in .env');
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const escrow = new hre.ethers.Contract(escrowAddr, ESCROW_ABI, signer);
  const valueWei = hre.ethers.parseEther(amountMon.toString());

  const before = await escrow.getTrustLevel(skillId);
  const beforeUnits = await escrow.getBoostUnits(skillId);

  console.log('Staking', amountMon, 'MON on skill', skillId, '(provider:', signer.address, ')');
  console.log('  Before: Level', before, ',', beforeUnits.toString(), 'boost units');

  const tx = await escrow.stake(skillId, { value: valueWei });
  const rec = await tx.wait();

  const after = await escrow.getTrustLevel(skillId);
  const afterUnits = await escrow.getBoostUnits(skillId);
  const stake = await escrow.getSkillStake(skillId);

  console.log('\nStaked. TX:', rec.hash);
  console.log('  After: Level', after, ',', afterUnits.toString(), 'boost units');
  console.log('  Total staked:', hre.ethers.formatEther(stake), 'MON');
}

main().catch((e) => { console.error(e); process.exit(1); });
