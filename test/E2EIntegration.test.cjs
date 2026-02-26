const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Phase 8: End-to-End Integration Tests
 *
 * Full flow: register → stake → boost → feedback → slash → benefit tier change.
 * Deploys all contracts (SkillRegistry, StakeEscrow, SlashingManager, BenefitGate)
 * and exercises the complete lifecycle.
 */

describe("E2E Integration Flow (Phase 8)", function () {
  let registry;
  let escrow;
  let slashing;
  let gate;
  let owner;
  let publisher;
  let booster1;
  let booster2;
  let validator1;
  let validator2;
  let validator3;
  let validator4;
  let validator5;
  let treasury;

  let skillCounter = 0;
  const LOW = 0;

  async function registerSkill(signer) {
    skillCounter++;
    const tx = await registry
      .connect(signer)
      .registerSkill(
        LOW,
        ethers.id(`meta-e2e-${skillCounter}`),
        ethers.id(`clawhub:e2e:${skillCounter}`),
        ethers.id("provider:e2e")
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return registry.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillRegistered");
    return Number(event.args.skillId);
  }

  beforeEach(async function () {
    [owner, publisher, booster1, booster2, validator1, validator2, validator3, validator4, validator5, treasury] =
      await ethers.getSigners();

    // Deploy SkillRegistry
    const SkillRegistry = await ethers.getContractFactory("SkillRegistry");
    registry = await SkillRegistry.connect(owner).deploy();
    await registry.waitForDeployment();

    // Deploy StakeEscrow (1 ETH per boost unit for LOW tier)
    const StakeEscrow = await ethers.getContractFactory("StakeEscrow");
    escrow = await StakeEscrow.connect(owner).deploy(
      await registry.getAddress(),
      ethers.parseEther("1"),  // LOW
      ethers.parseEther("2"),  // MEDIUM
      ethers.parseEther("5")   // HIGH
    );
    await escrow.waitForDeployment();

    // Deploy SlashingManager
    const SlashingManager = await ethers.getContractFactory("SlashingManager");
    slashing = await SlashingManager.connect(owner).deploy(
      await escrow.getAddress(),
      await registry.getAddress(),
      owner.address,
      treasury.address
    );
    await slashing.waitForDeployment();
    await escrow.connect(owner).setSlashingManager(await slashing.getAddress());

    // Deploy BenefitGate
    const BenefitGate = await ethers.getContractFactory("BenefitGate");
    gate = await BenefitGate.connect(owner).deploy(
      await escrow.getAddress(),
      await registry.getAddress()
    );
    await gate.waitForDeployment();

    // Setup validators (5 validators, quorum = 3)
    await slashing.connect(owner).addValidator(validator1.address);
    await slashing.connect(owner).addValidator(validator2.address);
    await slashing.connect(owner).addValidator(validator3.address);
    await slashing.connect(owner).addValidator(validator4.address);
    await slashing.connect(owner).addValidator(validator5.address);
    await slashing.connect(owner).setSlashQuorum(3);
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 1: Full E2E — Register → Stake → Boost → Benefit → Slash → Drop
  // ───────────────────────────────────────────────────────────────────────

  it("complete lifecycle: register → stake → boost → benefit → slash → benefit drops", async function () {
    // Step 1: Register skill
    const skillId = await registerSkill(publisher);
    expect(skillId).to.be.greaterThan(0);

    // Verify skill is active
    const [prov, , active] = await registry.getSkillCore(skillId);
    expect(prov).to.equal(publisher.address);
    expect(active).to.be.true;

    // Step 2: Publisher stakes 3 ETH → Trust Level L1 (3 boost units)
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("3") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(1); // L1
    expect(await gate.getBenefitTier(skillId)).to.equal(1);  // Bronze

    // Step 3: Community booster adds 4 more → total 7 → Trust Level L2
    await escrow.connect(booster1).boostSkill(skillId, { value: ethers.parseEther("4") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(2); // L2
    expect(await gate.getBenefitTier(skillId)).to.equal(2);  // Silver

    // Step 4: Verify Silver benefits
    expect(await gate.isAuthorized(skillId, 2)).to.be.true;   // Silver → yes
    expect(await gate.isAuthorized(skillId, 3)).to.be.false;  // Gold → no

    // Step 5: Activate benefits → BenefitActivated event
    const activateTx = await gate.checkAndActivate(skillId);
    const activateReceipt = await activateTx.wait();
    const activatedEvent = activateReceipt.logs
      .map((log) => {
        try { return gate.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "BenefitActivated");
    expect(activatedEvent).to.not.be.null;
    expect(Number(activatedEvent.args.tier)).to.equal(2); // Silver

    // Step 6: Validator proposes slash (50% severity)
    const caseId = ethers.id("e2e-slash-case-1");
    await slashing.connect(validator1).proposeSlash(
      skillId, 5000, ethers.id("MALWARE"), "ipfs://evidence/e2e", caseId
    );

    // Step 7: Quorum votes → slash auto-executes
    await slashing.connect(validator2).voteOnSlash(caseId, true);
    await slashing.connect(validator3).voteOnSlash(caseId, true); // 3/5 = quorum

    // Verify slash executed
    const [, , , , , , status] = await slashing.getProposal(caseId);
    expect(Number(status)).to.equal(3); // Executed

    // Step 8: Stake was halved (7 ETH → 3.5 ETH → trust level dropped)
    const remainingStake = await escrow.getSkillStake(skillId);
    expect(remainingStake).to.equal(ethers.parseEther("3.5"));

    // 3.5 boost units → L1 (Bronze)
    expect(await escrow.getTrustLevel(skillId)).to.equal(1); // L1
    expect(await gate.getBenefitTier(skillId)).to.equal(1);  // Bronze

    // Step 9: Re-activate to confirm benefit downgrade
    const reactivateTx = await gate.checkAndActivate(skillId);
    const reactivateReceipt = await reactivateTx.wait();
    const upgradedEvent = reactivateReceipt.logs
      .map((log) => {
        try { return gate.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "BenefitUpgraded");
    expect(upgradedEvent).to.not.be.null;
    expect(Number(upgradedEvent.args.oldTier)).to.equal(2); // Silver
    expect(Number(upgradedEvent.args.newTier)).to.equal(1); // Bronze

    // Silver access revoked
    expect(await gate.isAuthorized(skillId, 2)).to.be.false;
    expect(await gate.isAuthorized(skillId, 1)).to.be.true;
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 2: Multiple boosters → Gold, then slash to None
  // ───────────────────────────────────────────────────────────────────────

  it("multiple boosters push to Gold, heavy slash drops to None", async function () {
    const skillId = await registerSkill(publisher);

    // Publisher stakes 5, booster1 stakes 5, booster2 stakes 5 = 15 total → Gold
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("5") });
    await escrow.connect(booster1).boostSkill(skillId, { value: ethers.parseEther("5") });
    await escrow.connect(booster2).boostSkill(skillId, { value: ethers.parseEther("5") });

    expect(await escrow.getTrustLevel(skillId)).to.equal(3); // L3 (Gold)
    expect(await gate.getBenefitTier(skillId)).to.equal(3);  // Gold
    expect(await gate.isAuthorized(skillId, 3)).to.be.true;

    // 100% slash via direct authority
    const caseId = ethers.id("e2e-full-slash");
    await slashing.connect(owner).slashSkill(
      skillId, 10000, ethers.id("CRITICAL"), "ipfs://critical", caseId
    );

    // All stake gone
    expect(await escrow.getSkillStake(skillId)).to.equal(0);
    expect(await escrow.getTrustLevel(skillId)).to.equal(0); // L0
    expect(await gate.getBenefitTier(skillId)).to.equal(0);  // None
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 3: Slash during benefit activation
  // ───────────────────────────────────────────────────────────────────────

  it("benefit tier reflects real-time state after slash", async function () {
    const skillId = await registerSkill(publisher);
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("8") });

    // L2 Silver
    expect(await gate.getBenefitTier(skillId)).to.equal(2);
    await gate.checkAndActivate(skillId);

    // Slash 50% (8 → 4, L1 Bronze)
    const caseId = ethers.id("e2e-mid-slash");
    await slashing.connect(owner).slashSkill(
      skillId, 5000, ethers.id("ABUSE"), "ipfs://abuse", caseId
    );

    // getBenefitTier reads LIVE from StakeEscrow — should reflect slash immediately
    expect(await gate.getBenefitTier(skillId)).to.equal(1); // Bronze (4 boost units)

    // But the stored allocation is still Silver until re-activated
    const [allocTier] = await gate.getAllocation(skillId);
    expect(Number(allocTier)).to.equal(2); // Still Silver in storage

    // Re-activate to sync
    await gate.checkAndActivate(skillId);
    const [newAllocTier] = await gate.getAllocation(skillId);
    expect(Number(newAllocTier)).to.equal(1); // Now Bronze
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 4: Publisher + booster share accounting after slash
  // ───────────────────────────────────────────────────────────────────────

  it("pro-rata share accounting is fair after slash", async function () {
    const skillId = await registerSkill(publisher);

    // Publisher stakes 6, booster stakes 4 → 10 total
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("6") });
    await escrow.connect(booster1).boostSkill(skillId, { value: ethers.parseEther("4") });

    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("10"));

    // 50% slash → 5 ETH remains
    const caseId = ethers.id("e2e-pro-rata");
    await slashing.connect(owner).slashSkill(
      skillId, 5000, ethers.id("FRAUD"), "ipfs://fraud", caseId
    );

    const remaining = await escrow.getSkillStake(skillId);
    expect(remaining).to.equal(ethers.parseEther("5"));

    // Publisher had 60% of shares (6/10), booster had 40% (4/10)
    // After 50% slash: publisher should have ~3 ETH worth, booster ~2 ETH
    const pubStake = await escrow.getProviderStake(skillId, publisher.address);
    const boosterStake = await escrow.getProviderStake(skillId, booster1.address);

    expect(pubStake).to.equal(ethers.parseEther("3"));
    expect(boosterStake).to.equal(ethers.parseEther("2"));
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 5: Slash rejection (quorum not met) → stake preserved
  // ───────────────────────────────────────────────────────────────────────

  it("rejected slash proposal preserves full stake", async function () {
    const skillId = await registerSkill(publisher);
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("10") });

    const caseId = ethers.id("e2e-reject");
    await slashing.connect(validator1).proposeSlash(
      skillId, 5000, ethers.id("DISPUTED"), "ipfs://disputed", caseId
    );

    // 3 rejections → quorum impossible → auto-reject
    await slashing.connect(validator2).voteOnSlash(caseId, false);
    await slashing.connect(validator3).voteOnSlash(caseId, false);
    await slashing.connect(validator4).voteOnSlash(caseId, false);

    const [, , , , , , status] = await slashing.getProposal(caseId);
    expect(Number(status)).to.equal(2); // Rejected

    // Stake untouched
    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("10"));
    expect(await gate.getBenefitTier(skillId)).to.equal(3); // Gold (10 units → L2, wait: 10/1 = 10 units → L2)
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 6: Benefit gate resource assignment after activation
  // ───────────────────────────────────────────────────────────────────────

  it("resources assigned after activation persist in allocation", async function () {
    const skillId = await registerSkill(publisher);
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("14") });

    // Gold tier
    await gate.checkAndActivate(skillId);

    // Admin assigns resources
    const vpsId = ethers.id("vps-e2e-abc123");
    const computeId = ethers.id("compute-e2e-xyz789");
    await gate.connect(owner).assignResources(skillId, vpsId, computeId);

    // Verify
    const [tier, activatedAt, , allocVps, allocCompute] = await gate.getAllocation(skillId);
    expect(Number(tier)).to.equal(3); // Gold
    expect(Number(activatedAt)).to.be.greaterThan(0);
    expect(allocVps).to.equal(vpsId);
    expect(allocCompute).to.equal(computeId);
  });
});
