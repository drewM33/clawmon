/**
 * Trusted ClawMon — Deploy AttestationRegistry to Monad (Phase 5)
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-attestation.cjs --network monad --config hardhat.config.cjs
 *   npx hardhat run scripts/deploy/deploy-attestation.cjs --config hardhat.config.cjs  (local hardhat)
 *
 * Requires:
 *   DEPLOYER_PRIVATE_KEY in .env (also used as attester for v1)
 *   SEPOLIA_RPC_URL in .env
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AttestationRegistry with account:", deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");

  // For v1, the deployer is also the attester (bridge service)
  const attesterAddress = deployer.address;
  console.log("Attester address (bridge service):", attesterAddress);

  const AttestationRegistry = await hre.ethers.getContractFactory("AttestationRegistry");
  const registry = await AttestationRegistry.deploy(attesterAddress);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("\nAttestationRegistry deployed to:", address);
  console.log("\nAdd to .env:");
  console.log(`ATTESTATION_CONTRACT_ADDRESS=${address}`);

  // Verify deployment
  const owner = await registry.owner();
  const attester = await registry.attester();
  const freshness = await registry.FRESHNESS_WINDOW();

  console.log("\nDeployment verified:");
  console.log("  Owner:", owner);
  console.log("  Attester:", attester);
  console.log("  Freshness window:", Number(freshness), "seconds (", Number(freshness) / 3600, "hours)");
  console.log("  Total attestations:", Number(await registry.totalAttestations()));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
