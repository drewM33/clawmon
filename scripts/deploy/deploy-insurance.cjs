/**
 * Deploy InsurancePool to Monad testnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-insurance.cjs --network monad
 *   npx hardhat run scripts/deploy/deploy-insurance.cjs               # local hardhat
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying InsurancePool with account:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  const InsurancePool = await hre.ethers.getContractFactory("InsurancePool");
  const pool = await InsurancePool.deploy();
  await pool.waitForDeployment();

  const address = await pool.getAddress();
  console.log("\nInsurancePool deployed to:", address);
  console.log("\nAdd this to your .env:");
  console.log(`INSURANCE_CONTRACT_ADDRESS=${address}`);

  // Verify on block explorer (Monad) — non-blocking
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
