/**
 * Quick integration test against deployed TrustStaking on Sepolia.
 *
 * Steps:
 *   1. stakeAgent(agentId) with 0.01 ETH
 *   2. Read stake back via getAgentStake — verify fields
 *   3. slash(agentId, 5000, ...) — 50 % slash
 *   4. Read stake back — verify reduced amount & slash record
 *
 * Usage:
 *   npx hardhat run scripts/test-integration-staking.cjs --network sepolia --config hardhat.config.cjs
 */
const hre = require("hardhat");

const CONTRACT_ADDR = "0xDf54a2EeDc398dD939501E780e5F818F7C445b06";

const TIER_NAMES = ["None", "Tier2Low", "Tier2Mid", "Tier2High"];

function assert(condition, msg) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ ${msg}`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  TrustStaking Integration Test — Sepolia");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Signer:   ${deployer.address}`);
  const bal = hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address));
  console.log(`  Balance:  ${bal} ETH`);
  console.log(`  Contract: ${CONTRACT_ADDR}`);
  console.log("");

  const TrustStaking = await hre.ethers.getContractFactory("TrustStaking");
  const staking = TrustStaking.attach(CONTRACT_ADDR);

  // Unique agent ID so this test is idempotent
  const testLabel = `integration-test-${Date.now()}`;
  const agentId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(testLabel));
  console.log(`  Agent label: ${testLabel}`);
  console.log(`  Agent ID:    ${agentId}`);
  console.log("");

  // ─── Step 1: Stake 0.01 ETH ──────────────────────────────────────────
  console.log("── Step 1: stakeAgent(0.01 ETH) ──────────────────────────────");
  const stakeValue = hre.ethers.parseEther("0.01");
  const tx1 = await staking.stakeAgent(agentId, { value: stakeValue });
  const receipt1 = await tx1.wait();
  console.log(`  Tx hash:  ${receipt1.hash}`);
  console.log(`  Gas used: ${receipt1.gasUsed.toString()}`);
  console.log("");

  // ─── Step 2: Read stake back ─────────────────────────────────────────
  console.log("── Step 2: getAgentStake — verify on-chain state ─────────────");
  const s1 = await staking.getAgentStake(agentId);

  assert(s1.publisher === deployer.address, `publisher == deployer (${deployer.address})`);
  assert(s1.stakeAmount === stakeValue, `stakeAmount == 0.01 ETH (${hre.ethers.formatEther(s1.stakeAmount)})`);
  assert(s1.delegatedStake === 0n, `delegatedStake == 0`);
  assert(s1.totalStake === stakeValue, `totalStake == 0.01 ETH`);
  assert(s1.active === true, `active == true`);
  assert(Number(s1.tier) === 1, `tier == Tier2Low (${TIER_NAMES[Number(s1.tier)]})`);

  const isActive = await staking.isAgentActive(agentId);
  assert(isActive === true, `isAgentActive() == true`);
  console.log("");

  // ─── Step 3: Slash 50 % ──────────────────────────────────────────────
  console.log("── Step 3: slash(50 %, 'integration-test') ───────────────────");
  const slashHistBefore = await staking.getSlashHistoryLength();
  console.log(`  Slash history length before: ${slashHistBefore}`);

  const tx2 = await staking.slash(
    agentId,
    5000,                   // 50 %
    "integration-test",
    deployer.address        // reporter = deployer for test
  );
  const receipt2 = await tx2.wait();
  console.log(`  Tx hash:  ${receipt2.hash}`);
  console.log(`  Gas used: ${receipt2.gasUsed.toString()}`);
  console.log("");

  // ─── Step 4: Verify post-slash state ─────────────────────────────────
  console.log("── Step 4: Verify post-slash on-chain state ──────────────────");
  const s2 = await staking.getAgentStake(agentId);
  const expectedRemaining = stakeValue / 2n; // 0.005 ETH

  assert(s2.stakeAmount === expectedRemaining,
    `stakeAmount == 0.005 ETH (${hre.ethers.formatEther(s2.stakeAmount)})`);
  assert(s2.totalStake === expectedRemaining,
    `totalStake == 0.005 ETH (${hre.ethers.formatEther(s2.totalStake)})`);
  assert(s2.lastSlashTime > 0n, `lastSlashTime is set (${s2.lastSlashTime})`);
  assert(s2.active === false,
    `active == false (below MIN_STAKE after 50% slash)`);
  assert(Number(s2.tier) === 0, `tier == None (${TIER_NAMES[Number(s2.tier)]})`);

  // Verify slash record
  const slashHistAfter = await staking.getSlashHistoryLength();
  assert(slashHistAfter === slashHistBefore + 1n,
    `slashHistory length incremented (${slashHistBefore} -> ${slashHistAfter})`);

  const record = await staking.getSlashRecord(slashHistAfter - 1n);
  assert(record.agentId === agentId, `slash record agentId matches`);
  assert(record.amount === stakeValue / 2n,
    `slash record amount == 0.005 ETH (${hre.ethers.formatEther(record.amount)})`);
  assert(record.reason === "integration-test", `slash record reason == 'integration-test'`);
  assert(record.reporter === deployer.address, `slash record reporter == deployer`);
  console.log("");

  // ─── Summary ─────────────────────────────────────────────────────────
  const balAfter = hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address));
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ALL ASSERTIONS PASSED");
  console.log(`  Balance after: ${balAfter} ETH`);
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
