/**
 * Trusted ClawMon — Deploy SkillPaywall to Monad (Phase 9)
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-paywall.cjs --network monad --config hardhat.config.cjs
 *   npx hardhat run scripts/deploy/deploy-paywall.cjs --config hardhat.config.cjs  (local hardhat)
 *
 * Requires:
 *   DEPLOYER_PRIVATE_KEY in .env
 *   SEPOLIA_RPC_URL in .env
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SkillPaywall with account:", deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // For the hackathon demo the deployer doubles as treasury and insurance pool.
  // In production these would be separate multi-sig addresses.
  const protocolTreasury = deployer.address;
  const insurancePool = deployer.address;

  console.log("Protocol treasury:", protocolTreasury);
  console.log("Insurance pool:", insurancePool);

  const SkillPaywall = await hre.ethers.getContractFactory("SkillPaywall");
  const paywall = await SkillPaywall.deploy(protocolTreasury, insurancePool);
  await paywall.waitForDeployment();

  const address = await paywall.getAddress();
  console.log("\nSkillPaywall deployed to:", address);
  console.log("\nAdd to .env:");
  console.log(`PAYWALL_CONTRACT_ADDRESS=${address}`);

  // Verify deployment
  const owner = await paywall.owner();
  const treasury = await paywall.protocolTreasury();
  const pool = await paywall.insurancePool();
  const minPayment = await paywall.MIN_PAYMENT();
  const publisherBps = await paywall.PUBLISHER_BPS();
  const protocolBps = await paywall.PROTOCOL_BPS();
  const insuranceBps = await paywall.INSURANCE_BPS();

  console.log("\nDeployment verified:");
  console.log("  Owner:", owner);
  console.log("  Protocol treasury:", treasury);
  console.log("  Insurance pool:", pool);
  console.log("  Min payment:", hre.ethers.formatEther(minPayment), "ETH");
  console.log("  Fee split: publisher", Number(publisherBps) / 100 + "%, protocol", Number(protocolBps) / 100 + "%, insurance", Number(insuranceBps) / 100 + "%");
  console.log("  Registered skills:", Number(await paywall.getRegisteredSkillCount()));
  console.log("  Total payments:", Number(await paywall.totalPaymentsProcessed()));

  // Verify on block explorer (Monad) — non-blocking
  if (hre.network.name === "monad") {
    console.log("\nWaiting 30s for Etherscan indexing before verification...");
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [protocolTreasury, insurancePool],
      });
      console.log("Contract verified on Etherscan!");
    } catch (e) {
      console.log("Verification failed (may already be verified):", e.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
