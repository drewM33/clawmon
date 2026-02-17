/**
 * Deploy TrustStaking to Monad testnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-staking.cjs --network monad
 *   npx hardhat run scripts/deploy/deploy-staking.cjs               # local hardhat
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying TrustStaking with account:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  // For the hackathon demo we use the deployer as both insurance pool and treasury.
  // In production these would be separate multi-sig addresses.
  const insurancePool = deployer.address;
  const treasury = deployer.address;

  const TrustStaking = await hre.ethers.getContractFactory("TrustStaking");
  const staking = await TrustStaking.deploy(insurancePool, treasury);
  await staking.waitForDeployment();

  const address = await staking.getAddress();
  console.log("\nTrustStaking deployed to:", address);
  console.log("\nAdd this to your .env:");
  console.log(`STAKING_CONTRACT_ADDRESS=${address}`);

  // Verify on block explorer (Monad) — non-blocking
  if (hre.network.name === "monad") {
    console.log("\nWaiting 30s for Etherscan indexing before verification...");
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [insurancePool, treasury],
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
