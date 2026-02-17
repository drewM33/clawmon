/**
 * Deploy Governance to Monad testnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-governance.cjs --network monad
 *   npx hardhat run scripts/deploy/deploy-governance.cjs               # local hardhat
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying Governance with account:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  const Governance = await hre.ethers.getContractFactory("Governance");
  const governance = await Governance.deploy();
  await governance.waitForDeployment();

  const address = await governance.getAddress();
  console.log("\nGovernance deployed to:", address);

  // Print initial parameters
  const paramCount = await governance.getParameterCount();
  console.log(`\nInitialized ${paramCount} governable parameters:`);

  const paramNames = [
    "SCORING_WEIGHT_NAIVE",
    "SCORING_WEIGHT_HARDENED",
    "SCORING_WEIGHT_STAKE",
    "MIN_STAKE_WEI",
    "SLASH_REPORTER_BPS",
    "SLASH_INSURANCE_BPS",
    "SLASH_TREASURY_BPS",
    "SLASH_BURN_BPS",
    "INSURANCE_MAX_PAYOUT_BPS",
    "INSURANCE_POOL_CAP",
    "REVIEW_BOND_WEI",
    "UNBONDING_PERIOD",
    "TEE_FRESHNESS_WINDOW",
    "FOREIGN_STAKE_DISCOUNT_BPS",
  ];

  for (const name of paramNames) {
    const key = hre.ethers.encodeBytes32String(name);
    const value = await governance.getParameter(key);
    console.log(`  ${name}: ${value.toString()}`);
  }

  // Print governance constants
  const votingPeriod = await governance.VOTING_PERIOD();
  const timelockDelay = await governance.TIMELOCK_DELAY();
  const quorum = await governance.QUORUM();
  const minVoteStake = await governance.MIN_VOTE_STAKE();
  console.log(`\nGovernance constants:`);
  console.log(`  VOTING_PERIOD:   ${votingPeriod / 86400n} days`);
  console.log(`  TIMELOCK_DELAY:  ${timelockDelay / 86400n} day(s)`);
  console.log(`  QUORUM:          ${hre.ethers.formatEther(quorum)} ETH`);
  console.log(`  MIN_VOTE_STAKE:  ${hre.ethers.formatEther(minVoteStake)} ETH`);

  console.log("\nAdd this to your .env:");
  console.log(`GOVERNANCE_CONTRACT_ADDRESS=${address}`);

  // Verify on block explorer (Monad)
  if (hre.network.name === "monad") {
    console.log("\nWaiting 30s for Etherscan indexing before verification...");
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [],
      });
      console.log("Contract verified on Etherscan!");
    } catch (e) {
      console.log("Verification failed (may already be verified):", e.message);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
