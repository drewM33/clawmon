/**
 * Deploy Clawhub Stake + Slashing contracts (Monad / local Hardhat).
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-stake-slash.cjs --network monad --config hardhat.config.cjs
 *   npx hardhat run scripts/deploy/deploy-stake-slash.cjs --config hardhat.config.cjs
 *
 * Optional env:
 *   SLASH_AUTHORITY=0x...
 *   TREASURY_ADDRESS=0x...
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const slashAuthority = process.env.SLASH_AUTHORITY || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  console.log("Deploying stake/slash contracts with account:", deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "MON");
  console.log("Slash authority:", slashAuthority);
  console.log("Treasury:", treasury);

  // Risk-tier boost unit prices (MON)
  const lowUnit = hre.ethers.parseEther("1");
  const medUnit = hre.ethers.parseEther("2");
  const highUnit = hre.ethers.parseEther("5");

  const SkillRegistry = await hre.ethers.getContractFactory("SkillRegistry");
  const registry = await SkillRegistry.deploy();
  await registry.waitForDeployment();

  const StakeEscrow = await hre.ethers.getContractFactory("StakeEscrow");
  const escrow = await StakeEscrow.deploy(await registry.getAddress(), lowUnit, medUnit, highUnit);
  await escrow.waitForDeployment();

  const SlashingManager = await hre.ethers.getContractFactory("SlashingManager");
  const slashing = await SlashingManager.deploy(
    await escrow.getAddress(),
    await registry.getAddress(),
    slashAuthority,
    treasury
  );
  await slashing.waitForDeployment();

  const setSlasherTx = await escrow.setSlashingManager(await slashing.getAddress());
  await setSlasherTx.wait();

  const registryAddress = await registry.getAddress();
  const escrowAddress = await escrow.getAddress();
  const slashingAddress = await slashing.getAddress();

  console.log("\nDeployed:");
  console.log("  SkillRegistry:", registryAddress);
  console.log("  StakeEscrow:", escrowAddress);
  console.log("  SlashingManager:", slashingAddress);

  console.log("\nAdd to .env:");
  console.log(`SKILL_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`STAKE_ESCROW_ADDRESS=${escrowAddress}`);
  console.log(`SLASHING_MANAGER_ADDRESS=${slashingAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
