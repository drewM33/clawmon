const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Clawhub Stake + Slashing", function () {
  let registry;
  let escrow;
  let slashing;
  let owner;
  let provider;
  let authority;
  let treasury;
  let other;

  const LOW = 0;
  const MED = 1;
  const HIGH = 2;

  async function registerLowRiskSkill(signer) {
    const tx = await registry
      .connect(signer)
      .registerSkill(
        LOW,
        ethers.id("meta-v1"),
        ethers.id("clawhub:skill:gmail-integration"),
        ethers.id("provider:acme")
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return registry.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((x) => x && x.name === "SkillRegistered");
    return Number(event.args.skillId);
  }

  beforeEach(async function () {
    [owner, provider, authority, treasury, other] = await ethers.getSigners();

    const SkillRegistry = await ethers.getContractFactory("SkillRegistry");
    registry = await SkillRegistry.connect(owner).deploy();
    await registry.waitForDeployment();

    const StakeEscrow = await ethers.getContractFactory("StakeEscrow");
    escrow = await StakeEscrow.connect(owner).deploy(
      await registry.getAddress(),
      ethers.parseEther("1"),
      ethers.parseEther("2"),
      ethers.parseEther("5")
    );
    await escrow.waitForDeployment();

    const SlashingManager = await ethers.getContractFactory("SlashingManager");
    slashing = await SlashingManager.connect(owner).deploy(
      await escrow.getAddress(),
      await registry.getAddress(),
      authority.address,
      treasury.address
    );
    await slashing.waitForDeployment();

    await escrow.connect(owner).setSlashingManager(await slashing.getAddress());
  });

  it("registers skill with Clawhub binding", async function () {
    const skillId = await registerLowRiskSkill(provider);
    const [clawhubSkillId, providerIdentityHash, metadataHash] = await registry.getSkillBinding(skillId);
    expect(clawhubSkillId).to.equal(ethers.id("clawhub:skill:gmail-integration"));
    expect(providerIdentityHash).to.equal(ethers.id("provider:acme"));
    expect(metadataHash).to.equal(ethers.id("meta-v1"));
  });

  it("computes boost trust levels at 2/7/14 unit thresholds", async function () {
    const skillId = await registerLowRiskSkill(provider);
    expect(await escrow.getTrustLevel(skillId)).to.equal(0);

    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("2") });
    expect(await escrow.getBoostUnits(skillId)).to.equal(2);
    expect(await escrow.getTrustLevel(skillId)).to.equal(1);

    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("5") });
    expect(await escrow.getBoostUnits(skillId)).to.equal(7);
    expect(await escrow.getTrustLevel(skillId)).to.equal(2);

    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("7") });
    expect(await escrow.getBoostUnits(skillId)).to.equal(14);
    expect(await escrow.getTrustLevel(skillId)).to.equal(3);
  });

  it("enforces provider-only staking for a skill", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await expect(
      escrow.connect(other).stake(skillId, { value: ethers.parseEther("1") })
    ).to.be.revertedWith("NOT_SKILL_PROVIDER");
  });

  it("handles unstake cooldown and returns assets after unlock", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("3") });

    await escrow.connect(provider).requestUnstake(skillId, ethers.parseEther("1"));
    await expect(escrow.connect(provider).executeUnstake(skillId)).to.be.revertedWith("LOCKED");

    await time.increase(7 * 24 * 60 * 60 + 1);
    const before = await ethers.provider.getBalance(provider.address);
    const tx = await escrow.connect(provider).executeUnstake(skillId);
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(provider.address);

    expect(after - before + gasCost).to.be.greaterThan(0);
  });

  it("slashes proportionally and can reduce trust level", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("14") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(3);

    const stakedBefore = await escrow.getSkillStake(skillId);
    expect(stakedBefore).to.equal(ethers.parseEther("14"));

    // Slash 50% => level should drop from 3 to 2 (14 -> 7 boosts)
    await slashing
      .connect(authority)
      .slashSkill(
        skillId,
        5000,
        ethers.id("DATA_EXFILTRATION"),
        "ipfs://evidence/slash-1",
        ethers.id("case-1")
      );

    const stakedAfter = await escrow.getSkillStake(skillId);
    expect(stakedAfter).to.equal(ethers.parseEther("7"));
    expect(await escrow.getTrustLevel(skillId)).to.equal(2);
  });

  it("prevents duplicate slash case IDs", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("2") });

    const caseId = ethers.id("same-case");
    await slashing
      .connect(authority)
      .slashSkill(skillId, 1000, ethers.id("MALWARE_BEHAVIOR"), "ipfs://evidence/dup", caseId);

    await expect(
      slashing
        .connect(authority)
        .slashSkill(skillId, 1000, ethers.id("MALWARE_BEHAVIOR"), "ipfs://evidence/dup-2", caseId)
    ).to.be.revertedWith("CASE_ALREADY_USED");
  });

  it("restricts slash to authority", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("2") });

    await expect(
      slashing
        .connect(other)
        .slashSkill(skillId, 1000, ethers.id("POLICY_VIOLATION"), "ipfs://evidence/forbidden", ethers.id("case-2"))
    ).to.be.revertedWith("NOT_AUTHORITY");
  });
});
