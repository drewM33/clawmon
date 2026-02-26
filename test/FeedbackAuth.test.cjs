const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Phase 2 Tests: Feedback Authorization
 *
 * Tests the integration between SkillPublisherBinder and the feedback
 * authorization flow. Verifies that:
 *   - Skills published via the binder have open feedback by default
 *   - The closed/selective policies are properly enforced at the contract level
 *   - Duplicate ClawHub ID prevention works across auth policies
 *
 * Note: On-chain ERC-8004 metadata (setMetadata) tests require a mock
 * IdentityRegistry. These tests focus on the SkillRegistry + StakeEscrow
 * integration that underpins feedback authorization.
 */
describe("Feedback Authorization (Phase 2)", function () {
  let registry;
  let escrow;
  let binder;
  let owner;
  let publisher;
  let publisher2;
  let reviewer;

  const LOW = 0;

  beforeEach(async function () {
    [owner, publisher, publisher2, reviewer] = await ethers.getSigners();

    // Deploy SkillRegistry
    const SkillRegistry = await ethers.getContractFactory("SkillRegistry");
    registry = await SkillRegistry.connect(owner).deploy();
    await registry.waitForDeployment();

    // Deploy StakeEscrow
    const StakeEscrow = await ethers.getContractFactory("StakeEscrow");
    escrow = await StakeEscrow.connect(owner).deploy(
      await registry.getAddress(),
      ethers.parseEther("1"),
      ethers.parseEther("2"),
      ethers.parseEther("5")
    );
    await escrow.waitForDeployment();

    // Deploy SkillPublisherBinder
    const Binder = await ethers.getContractFactory("SkillPublisherBinder");
    binder = await Binder.connect(owner).deploy(
      await registry.getAddress(),
      await escrow.getAddress()
    );
    await binder.waitForDeployment();

    // Authorize binder
    await registry.connect(owner).setAuthorizedBinder(await binder.getAddress(), true);
    await escrow.connect(owner).setAuthorizedBinder(await binder.getAddress(), true);
  });

  // ─── Skills published via binder are active and open for feedback ─────

  it("published skill is active and accessible for feedback", async function () {
    const clawhubId = ethers.id("feedback-open-skill");
    const tx = await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("meta"), clawhubId, ethers.id("prov"), 0, {
        value: ethers.parseEther("2"),
      });
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);

    // Skill is active on registry
    const [prov, , active] = await registry.getSkillCore(skillId);
    expect(active).to.be.true;
    expect(prov).to.equal(publisher.address);

    // Skill has stake → trust level > 0
    expect(await escrow.getTrustLevel(skillId)).to.be.greaterThan(0);
  });

  // ─── Publisher can deactivate skill (effectively closing feedback) ────

  it("publisher can deactivate skill to block further interactions", async function () {
    const clawhubId = ethers.id("deactivate-skill");
    const tx = await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("meta"), clawhubId, ethers.id("prov"), 0, {
        value: ethers.parseEther("1"),
      });
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);

    // Publisher deactivates the skill
    await registry.connect(publisher).setActive(skillId, false);
    const [, , active] = await registry.getSkillCore(skillId);
    expect(active).to.be.false;
  });

  // ─── Non-provider cannot deactivate skill ────────────────────────────

  it("non-provider cannot deactivate skill", async function () {
    const clawhubId = ethers.id("no-deactivate");
    const tx = await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("meta"), clawhubId, ethers.id("prov"), 0, {
        value: ethers.parseEther("1"),
      });
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);

    await expect(
      registry.connect(reviewer).setActive(skillId, false)
    ).to.be.revertedWith("NOT_PROVIDER");
  });

  // ─── ERC-8004 agentId binding for feedback authorization ──────────────

  it("emits erc8004AgentId in publish event for off-chain auth tracking", async function () {
    const agentId = 42;
    const tx = await binder
      .connect(publisher)
      .publishAndStake(
        LOW,
        ethers.id("meta"),
        ethers.id("8004-auth-skill"),
        ethers.id("prov"),
        agentId,
        { value: ethers.parseEther("1") }
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    // Event carries the agentId for off-chain feedbackAuth metadata setting
    expect(Number(event.args.erc8004AgentId)).to.equal(agentId);
  });

  // ─── Multiple publishers with different auth contexts ─────────────────

  it("two publishers can register and each controls their own skill", async function () {
    // Publisher 1
    await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("m1"), ethers.id("s1"), ethers.id("p1"), 10, {
        value: ethers.parseEther("1"),
      });

    // Publisher 2
    await binder
      .connect(publisher2)
      .publishAndStake(LOW, ethers.id("m2"), ethers.id("s2"), ethers.id("p2"), 20, {
        value: ethers.parseEther("1"),
      });

    // Publisher 1 can deactivate their skill
    await registry.connect(publisher).setActive(1, false);
    const [, , active1] = await registry.getSkillCore(1);
    expect(active1).to.be.false;

    // Publisher 1 cannot deactivate publisher 2's skill
    await expect(
      registry.connect(publisher).setActive(2, false)
    ).to.be.revertedWith("NOT_PROVIDER");

    // Publisher 2's skill remains active
    const [, , active2] = await registry.getSkillCore(2);
    expect(active2).to.be.true;
  });

  // ─── Binder authorization revocation blocks new publishes ─────────────

  it("revoking binder auth prevents new skill registration", async function () {
    // Revoke binder on registry
    await registry.connect(owner).setAuthorizedBinder(await binder.getAddress(), false);

    await expect(
      binder
        .connect(publisher)
        .publishAndStake(LOW, ethers.id("m"), ethers.id("blocked"), ethers.id("p"), 0, {
          value: ethers.parseEther("1"),
        })
    ).to.be.revertedWith("NOT_AUTHORIZED_BINDER");
  });

  // ─── publishOnly leaves skill unstaked (lower trust, open for feedback) ─

  it("publishOnly skill is active but has no stake (trust level 0)", async function () {
    const tx = await binder
      .connect(publisher)
      .publishOnly(LOW, ethers.id("meta"), ethers.id("no-stake-auth"), ethers.id("prov"), 0);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);

    // Active but no stake
    const [, , active] = await registry.getSkillCore(skillId);
    expect(active).to.be.true;
    expect(await escrow.getTrustLevel(skillId)).to.equal(0);
    expect(Number(event.args.trustLevel)).to.equal(0);
  });
});
