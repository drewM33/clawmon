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

  let skillCounter = 0;

  async function registerLowRiskSkill(signer) {
    skillCounter++;
    const tx = await registry
      .connect(signer)
      .registerSkill(
        LOW,
        ethers.id("meta-v1"),
        ethers.id(`clawhub:skill:test-${skillCounter}`),
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

  // ─── Phase 3: Publisher vs Booster Staking ──────────────────────────

  it("boostSkill allows anyone to boost (not just provider)", async function () {
    const skillId = await registerLowRiskSkill(provider);

    // Provider stakes first
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("1") });

    // Non-provider boosts
    await escrow.connect(other).boostSkill(skillId, { value: ethers.parseEther("1") });

    // Total should be 2 ETH = 2 boost units = L1
    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("2"));
    expect(await escrow.getTrustLevel(skillId)).to.equal(1);
  });

  it("boostSkill emits Boosted event (not Staked)", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("1") });

    const tx = await escrow.connect(other).boostSkill(skillId, { value: ethers.parseEther("1") });
    const receipt = await tx.wait();

    const boosted = receipt.logs
      .map((log) => {
        try { return escrow.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "Boosted");

    expect(boosted).to.not.be.null;
    expect(boosted.args.booster).to.equal(other.address);
    expect(boosted.args.amount).to.equal(ethers.parseEther("1"));
  });

  it("tracks skillPublisher separately from boosters", async function () {
    const skillId = await registerLowRiskSkill(provider);

    // Publisher stakes
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("3") });
    expect(await escrow.skillPublisher(skillId)).to.equal(provider.address);

    // Booster boosts
    await escrow.connect(other).boostSkill(skillId, { value: ethers.parseEther("4") });

    // Publisher stake vs community boost are tracked separately
    const pubStake = await escrow.getPublisherStake(skillId);
    const communityBoost = await escrow.getCommunityBoost(skillId);

    expect(pubStake).to.equal(ethers.parseEther("3"));
    expect(communityBoost).to.equal(ethers.parseEther("4"));

    // Total is sum
    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("7"));
    expect(await escrow.getTrustLevel(skillId)).to.equal(2); // 7 boosts = L2
  });

  it("community boost can push trust level beyond publisher's stake alone", async function () {
    const skillId = await registerLowRiskSkill(provider);

    // Publisher stakes 2 ETH → L1
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("2") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(1);

    // Community boosts 5 ETH → total 7 → L2
    await escrow.connect(other).boostSkill(skillId, { value: ethers.parseEther("5") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(2);
  });

  it("booster can unstake their boost shares", async function () {
    const skillId = await registerLowRiskSkill(provider);
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("1") });
    await escrow.connect(other).boostSkill(skillId, { value: ethers.parseEther("3") });

    // Booster requests unstake
    await escrow.connect(other).requestUnstake(skillId, ethers.parseEther("2"));
    await time.increase(7 * 24 * 60 * 60 + 1);

    const before = await ethers.provider.getBalance(other.address);
    const tx = await escrow.connect(other).executeUnstake(skillId);
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(other.address);

    // Got MON back
    expect(after - before + gasCost).to.be.greaterThan(0);

    // Total decreased
    expect(await escrow.getSkillStake(skillId)).to.be.lessThan(ethers.parseEther("4"));
  });

  it("slash affects both publisher and booster pro-rata", async function () {
    const skillId = await registerLowRiskSkill(provider);

    // Publisher stakes 7 ETH, booster stakes 7 ETH → total 14 → L3
    await escrow.connect(provider).stake(skillId, { value: ethers.parseEther("7") });
    await escrow.connect(other).boostSkill(skillId, { value: ethers.parseEther("7") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(3);

    // Slash 50% → total 7 → L2
    await slashing
      .connect(authority)
      .slashSkill(
        skillId,
        5000,
        ethers.id("MALICIOUS"),
        "ipfs://evidence/slash-boost",
        ethers.id("case-boost-1")
      );

    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("7"));
    expect(await escrow.getTrustLevel(skillId)).to.equal(2);

    // Both publisher and booster lost proportionally
    const pubStake = await escrow.getPublisherStake(skillId);
    const boostStake = await escrow.getCommunityBoost(skillId);
    // Each had 50% of pool, so each should have ~3.5 ETH
    expect(pubStake).to.be.closeTo(ethers.parseEther("3.5"), ethers.parseEther("0.01"));
    expect(boostStake).to.be.closeTo(ethers.parseEther("3.5"), ethers.parseEther("0.01"));
  });
});
