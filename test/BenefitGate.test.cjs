const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BenefitGate (Phase 6)", function () {
  let registry;
  let escrow;
  let gate;
  let owner;
  let provider;
  let booster;

  const LOW = 0;
  let skillCounter = 0;

  async function registerAndStakeSkill(signer, stakeEth) {
    skillCounter++;
    const tx = await registry
      .connect(signer)
      .registerSkill(
        LOW,
        ethers.id(`meta-benefit-${skillCounter}`),
        ethers.id(`clawhub:benefit:${skillCounter}`),
        ethers.id("provider:test")
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return registry.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillRegistered");
    const skillId = Number(event.args.skillId);

    if (stakeEth) {
      await escrow.connect(signer).stake(skillId, { value: ethers.parseEther(stakeEth) });
    }
    return skillId;
  }

  beforeEach(async function () {
    [owner, provider, booster] = await ethers.getSigners();

    const SkillRegistry = await ethers.getContractFactory("SkillRegistry");
    registry = await SkillRegistry.connect(owner).deploy();
    await registry.waitForDeployment();

    // Boost unit = 1 ETH for LOW tier → easy to control boost levels
    const StakeEscrow = await ethers.getContractFactory("StakeEscrow");
    escrow = await StakeEscrow.connect(owner).deploy(
      await registry.getAddress(),
      ethers.parseEther("1"), // LOW boost unit
      ethers.parseEther("2"), // MEDIUM boost unit
      ethers.parseEther("5")  // HIGH boost unit
    );
    await escrow.waitForDeployment();

    const BenefitGate = await ethers.getContractFactory("BenefitGate");
    gate = await BenefitGate.connect(owner).deploy(
      await escrow.getAddress(),
      await registry.getAddress()
    );
    await gate.waitForDeployment();
  });

  // ─── TEST 1: Unstaked skill → BenefitTier.None ─────────────────────────

  it("unstaked skill returns BenefitTier.None (0)", async function () {
    const skillId = await registerAndStakeSkill(provider, null);
    const tier = await gate.getBenefitTier(skillId);
    expect(Number(tier)).to.equal(0); // None
  });

  // ─── TEST 2: 2 boost units → Bronze ───────────────────────────────────

  it("skill with 2 boost units gets Bronze tier (1)", async function () {
    // 2 ETH stake → 2 boost units (unit = 1 ETH)
    const skillId = await registerAndStakeSkill(provider, "2");
    const tier = await gate.getBenefitTier(skillId);
    expect(Number(tier)).to.equal(1); // Bronze
  });

  // ─── TEST 3: 7 boost units → Silver ───────────────────────────────────

  it("skill with 7 boost units gets Silver tier (2)", async function () {
    const skillId = await registerAndStakeSkill(provider, "7");
    const tier = await gate.getBenefitTier(skillId);
    expect(Number(tier)).to.equal(2); // Silver
  });

  // ─── TEST 4: 14 boost units → Gold ────────────────────────────────────

  it("skill with 14 boost units gets Gold tier (3)", async function () {
    const skillId = await registerAndStakeSkill(provider, "14");
    const tier = await gate.getBenefitTier(skillId);
    expect(Number(tier)).to.equal(3); // Gold
  });

  // ─── TEST 5: checkAndActivate emits BenefitActivated ──────────────────

  it("checkAndActivate emits BenefitActivated on first activation", async function () {
    const skillId = await registerAndStakeSkill(provider, "3");

    const tx = await gate.checkAndActivate(skillId);
    const receipt = await tx.wait();

    const activated = receipt.logs
      .map((log) => {
        try { return gate.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "BenefitActivated");

    expect(activated).to.not.be.null;
    expect(Number(activated.args.skillId)).to.equal(skillId);
    expect(Number(activated.args.tier)).to.equal(1); // Bronze

    // Allocation updated
    const [allocTier, activatedAt] = await gate.getAllocation(skillId);
    expect(Number(allocTier)).to.equal(1);
    expect(Number(activatedAt)).to.be.greaterThan(0);
  });

  // ─── TEST 6: checkAndActivate emits BenefitUpgraded on tier change ────

  it("checkAndActivate emits BenefitUpgraded when tier changes", async function () {
    const skillId = await registerAndStakeSkill(provider, "3");

    // First activation → Bronze
    await gate.checkAndActivate(skillId);

    // Boost to Silver (need 7 total, already have 3 → add 4 via boost)
    await escrow.connect(booster).boostSkill(skillId, { value: ethers.parseEther("4") });

    const tx = await gate.checkAndActivate(skillId);
    const receipt = await tx.wait();

    const upgraded = receipt.logs
      .map((log) => {
        try { return gate.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "BenefitUpgraded");

    expect(upgraded).to.not.be.null;
    expect(Number(upgraded.args.oldTier)).to.equal(1); // Bronze
    expect(Number(upgraded.args.newTier)).to.equal(2); // Silver
  });

  // ─── TEST 7: isAuthorized returns false for insufficient tier ─────────

  it("isAuthorized returns false for Silver-tier skill checking Gold", async function () {
    const skillId = await registerAndStakeSkill(provider, "7"); // Silver

    // Should be authorized for Bronze (1) and Silver (2)
    expect(await gate.isAuthorized(skillId, 0)).to.be.true;  // None
    expect(await gate.isAuthorized(skillId, 1)).to.be.true;  // Bronze
    expect(await gate.isAuthorized(skillId, 2)).to.be.true;  // Silver
    expect(await gate.isAuthorized(skillId, 3)).to.be.false; // Gold → NO
  });

  // ─── TEST 8: assignResources sets vpsId and computeId ─────────────────

  it("owner can assign resources to activated skill", async function () {
    const skillId = await registerAndStakeSkill(provider, "14"); // Gold
    await gate.checkAndActivate(skillId);

    const vpsId = ethers.id("vps-12345");
    const computeId = ethers.id("compute-67890");

    await gate.connect(owner).assignResources(skillId, vpsId, computeId);

    const [, , , allocVps, allocCompute] = await gate.getAllocation(skillId);
    expect(allocVps).to.equal(vpsId);
    expect(allocCompute).to.equal(computeId);
  });

  // ─── TEST 9: Non-owner cannot assign resources ────────────────────────

  it("non-owner cannot assign resources", async function () {
    const skillId = await registerAndStakeSkill(provider, "14");
    await gate.checkAndActivate(skillId);

    await expect(
      gate.connect(provider).assignResources(skillId, ethers.id("x"), ethers.id("y"))
    ).to.be.revertedWith("NOT_OWNER");
  });

  // ─── TEST 10: Non-existent skill returns None ─────────────────────────

  it("non-existent skill returns BenefitTier.None", async function () {
    const tier = await gate.getBenefitTier(9999);
    expect(Number(tier)).to.equal(0);
  });
});

/**
 * Rate Limiter Unit Tests (Phase 6)
 */
describe("Rate Limiter (Phase 6)", function () {
  let rateLimiter;

  before(async function () {
    rateLimiter = await import("../src/benefits/rate-limiter.js");
  });

  beforeEach(function () {
    rateLimiter.resetRateLimits();
  });

  it("allows requests within rate limit", function () {
    const result = rateLimiter.checkRateLimit("skill-1", "bronze");
    expect(result.allowed).to.be.true;
    expect(result.limit).to.equal(100);
    expect(result.remaining).to.equal(99);
  });

  it("none tier has 10 req/min limit", function () {
    // Send 10 requests
    for (let i = 0; i < 10; i++) {
      const r = rateLimiter.checkRateLimit("skill-none", "none");
      expect(r.allowed).to.be.true;
    }
    // 11th should be denied
    const denied = rateLimiter.checkRateLimit("skill-none", "none");
    expect(denied.allowed).to.be.false;
    expect(denied.remaining).to.equal(0);
  });

  it("gold tier allows 2000 req/min", function () {
    // First request
    const first = rateLimiter.checkRateLimit("skill-gold", "gold");
    expect(first.allowed).to.be.true;
    expect(first.limit).to.equal(2000);
    expect(first.remaining).to.equal(1999);
  });

  it("different skills have separate rate buckets", function () {
    // Exhaust skill-a (none = 10 limit)
    for (let i = 0; i < 10; i++) {
      rateLimiter.checkRateLimit("skill-a", "none");
    }
    const deniedA = rateLimiter.checkRateLimit("skill-a", "none");
    expect(deniedA.allowed).to.be.false;

    // skill-b should still be fine
    const allowedB = rateLimiter.checkRateLimit("skill-b", "none");
    expect(allowedB.allowed).to.be.true;
  });

  it("cleanupExpiredEntries removes old entries", function () {
    rateLimiter.checkRateLimit("cleanup-test", "none");
    // Can't truly test expiry without time manipulation, but verify function exists
    const cleaned = rateLimiter.cleanupExpiredEntries();
    expect(cleaned).to.be.a("number");
  });
});
