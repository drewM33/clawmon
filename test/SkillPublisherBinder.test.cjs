const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SkillPublisherBinder", function () {
  let registry;
  let escrow;
  let binder;
  let owner;
  let publisher;
  let publisher2;
  let other;

  const LOW = 0;
  const MED = 1;
  const HIGH = 2;

  // Boost unit = 1 ETH for LOW risk → 2 boosts = L1, 7 = L2, 14 = L3
  const BOOST_UNIT = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, publisher, publisher2, other] = await ethers.getSigners();

    // Deploy SkillRegistry
    const SkillRegistry = await ethers.getContractFactory("SkillRegistry");
    registry = await SkillRegistry.connect(owner).deploy();
    await registry.waitForDeployment();

    // Deploy StakeEscrow
    const StakeEscrow = await ethers.getContractFactory("StakeEscrow");
    escrow = await StakeEscrow.connect(owner).deploy(
      await registry.getAddress(),
      BOOST_UNIT,               // LOW
      ethers.parseEther("2"),   // MEDIUM
      ethers.parseEther("5")    // HIGH
    );
    await escrow.waitForDeployment();

    // Deploy SkillPublisherBinder
    const Binder = await ethers.getContractFactory("SkillPublisherBinder");
    binder = await Binder.connect(owner).deploy(
      await registry.getAddress(),
      await escrow.getAddress()
    );
    await binder.waitForDeployment();

    // Authorize binder on both contracts
    await registry.connect(owner).setAuthorizedBinder(await binder.getAddress(), true);
    await escrow.connect(owner).setAuthorizedBinder(await binder.getAddress(), true);
  });

  // ─── publishAndStake: happy path ──────────────────────────────────────

  it("atomically registers and stakes a skill", async function () {
    const clawhubId = ethers.id("gmail-integration");
    const providerId = ethers.id("provider:alice");
    const metaHash = ethers.id("meta:gmail-v1");
    const stakeAmount = ethers.parseEther("3");

    const tx = await binder
      .connect(publisher)
      .publishAndStake(LOW, metaHash, clawhubId, providerId, 0, {
        value: stakeAmount,
      });
    const receipt = await tx.wait();

    // Parse SkillPublished event
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    expect(event).to.not.be.null;
    const skillId = Number(event.args.skillId);
    expect(skillId).to.equal(1);
    expect(event.args.publisher).to.equal(publisher.address);
    expect(event.args.stakedAmount).to.equal(stakeAmount);
    expect(Number(event.args.trustLevel)).to.equal(1); // 3 boosts >= L1

    // Verify skill registered on SkillRegistry
    const [prov, risk, active] = await registry.getSkillCore(skillId);
    expect(prov).to.equal(publisher.address);
    expect(risk).to.equal(LOW);
    expect(active).to.be.true;

    // Verify stake on StakeEscrow
    expect(await escrow.getSkillStake(skillId)).to.equal(stakeAmount);
    expect(await escrow.getTrustLevel(skillId)).to.equal(1);

    // Verify binder records
    expect(await binder.getPublishRecordCount()).to.equal(1);
    expect(await binder.getPublisherSkillCount(publisher.address)).to.equal(1);
    expect(await binder.getSkillIdByClawhubId(clawhubId)).to.equal(skillId);
  });

  // ─── publishAndStake: trust levels ────────────────────────────────────

  it("reaches L2 trust level with 7+ boost units", async function () {
    const tx = await binder
      .connect(publisher)
      .publishAndStake(
        LOW,
        ethers.id("meta"),
        ethers.id("skill-l2"),
        ethers.id("prov"),
        0,
        { value: ethers.parseEther("7") }
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    expect(Number(event.args.trustLevel)).to.equal(2);
  });

  it("reaches L3 trust level with 14+ boost units", async function () {
    const tx = await binder
      .connect(publisher)
      .publishAndStake(
        LOW,
        ethers.id("meta"),
        ethers.id("skill-l3"),
        ethers.id("prov"),
        0,
        { value: ethers.parseEther("14") }
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    expect(Number(event.args.trustLevel)).to.equal(3);
  });

  // ─── publishAndStake: with ERC-8004 agentId ──────────────────────────

  it("binds an ERC-8004 agentId when provided", async function () {
    const erc8004AgentId = 42;
    const tx = await binder
      .connect(publisher)
      .publishAndStake(
        LOW,
        ethers.id("meta"),
        ethers.id("skill-8004"),
        ethers.id("prov"),
        erc8004AgentId,
        { value: ethers.parseEther("2") }
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    expect(Number(event.args.erc8004AgentId)).to.equal(erc8004AgentId);
  });

  // ─── publishOnly: register without staking ───────────────────────────

  it("registers a skill without staking via publishOnly", async function () {
    const clawhubId = ethers.id("no-stake-skill");
    const tx = await binder
      .connect(publisher)
      .publishOnly(LOW, ethers.id("meta"), clawhubId, ethers.id("prov"), 0);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);
    expect(skillId).to.equal(1);
    expect(Number(event.args.stakedAmount)).to.equal(0);
    expect(Number(event.args.trustLevel)).to.equal(0);

    // Skill registered but no stake
    expect(await escrow.getSkillStake(skillId)).to.equal(0);

    // Publisher can stake directly later
    await escrow.connect(publisher).stake(skillId, { value: ethers.parseEther("2") });
    expect(await escrow.getTrustLevel(skillId)).to.equal(1);
  });

  // ─── Duplicate prevention ────────────────────────────────────────────

  it("reverts when same clawhubSkillId is registered twice", async function () {
    const clawhubId = ethers.id("unique-skill");

    await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("meta"), clawhubId, ethers.id("prov"), 0, {
        value: ethers.parseEther("1"),
      });

    await expect(
      binder
        .connect(publisher2)
        .publishAndStake(LOW, ethers.id("meta2"), clawhubId, ethers.id("prov2"), 0, {
          value: ethers.parseEther("1"),
        })
    ).to.be.revertedWith("CLAWHUB_ID_ALREADY_REGISTERED");
  });

  it("reverts duplicate via registerSkill() direct call too", async function () {
    const clawhubId = ethers.id("direct-dup");

    await registry
      .connect(publisher)
      .registerSkill(LOW, ethers.id("meta"), clawhubId, ethers.id("prov"));

    await expect(
      registry
        .connect(publisher2)
        .registerSkill(LOW, ethers.id("meta2"), clawhubId, ethers.id("prov2"))
    ).to.be.revertedWith("CLAWHUB_ID_ALREADY_REGISTERED");
  });

  // ─── Authorization checks ────────────────────────────────────────────

  it("reverts if binder not authorized on SkillRegistry", async function () {
    // Revoke binder authorization on registry
    await registry.connect(owner).setAuthorizedBinder(await binder.getAddress(), false);

    await expect(
      binder
        .connect(publisher)
        .publishAndStake(
          LOW,
          ethers.id("meta"),
          ethers.id("unauth-skill"),
          ethers.id("prov"),
          0,
          { value: ethers.parseEther("1") }
        )
    ).to.be.revertedWith("NOT_AUTHORIZED_BINDER");
  });

  it("reverts if binder not authorized on StakeEscrow", async function () {
    // Revoke binder authorization on escrow
    await escrow.connect(owner).setAuthorizedBinder(await binder.getAddress(), false);

    await expect(
      binder
        .connect(publisher)
        .publishAndStake(
          LOW,
          ethers.id("meta"),
          ethers.id("unauth-escrow-skill"),
          ethers.id("prov"),
          0,
          { value: ethers.parseEther("1") }
        )
    ).to.be.revertedWith("NOT_AUTHORIZED_BINDER");
  });

  // ─── Zero stake guard ────────────────────────────────────────────────

  it("reverts publishAndStake with zero value", async function () {
    await expect(
      binder
        .connect(publisher)
        .publishAndStake(
          LOW,
          ethers.id("meta"),
          ethers.id("zero-stake"),
          ethers.id("prov"),
          0,
          { value: 0 }
        )
    ).to.be.revertedWith("MUST_STAKE");
  });

  // ─── Multi-publisher enumeration ─────────────────────────────────────

  it("tracks multiple publishers and their skills", async function () {
    // Publisher 1 registers 2 skills
    await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("m1"), ethers.id("s1"), ethers.id("p1"), 0, {
        value: ethers.parseEther("1"),
      });
    await binder
      .connect(publisher)
      .publishAndStake(MED, ethers.id("m2"), ethers.id("s2"), ethers.id("p1"), 0, {
        value: ethers.parseEther("1"),
      });

    // Publisher 2 registers 1 skill
    await binder
      .connect(publisher2)
      .publishAndStake(HIGH, ethers.id("m3"), ethers.id("s3"), ethers.id("p2"), 0, {
        value: ethers.parseEther("1"),
      });

    expect(await binder.getPublisherSkillCount(publisher.address)).to.equal(2);
    expect(await binder.getPublisherSkillCount(publisher2.address)).to.equal(1);
    expect(await binder.getPublishRecordCount()).to.equal(3);

    const p1Skills = await binder.getPublisherSkillIds(publisher.address);
    expect(p1Skills.length).to.equal(2);
    expect(Number(p1Skills[0])).to.equal(1);
    expect(Number(p1Skills[1])).to.equal(2);
  });

  // ─── Wallet extraction integration (identity binding) ────────────────

  it("publisher wallet matches skill provider on-chain", async function () {
    const tx = await binder
      .connect(publisher)
      .publishAndStake(
        LOW,
        ethers.id("meta"),
        ethers.id("wallet-check"),
        ethers.id("prov"),
        0,
        { value: ethers.parseEther("1") }
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);
    const [onChainProvider] = await registry.getSkillCore(skillId);
    expect(onChainProvider).to.equal(publisher.address);
    expect(event.args.publisher).to.equal(publisher.address);
  });

  // ─── Reverse lookup ──────────────────────────────────────────────────

  it("supports reverse lookup from clawhubSkillId to skillId", async function () {
    const clawhubId = ethers.id("reverse-lookup-skill");
    await binder
      .connect(publisher)
      .publishAndStake(LOW, ethers.id("m"), clawhubId, ethers.id("p"), 0, {
        value: ethers.parseEther("1"),
      });

    const skillId = await binder.getSkillIdByClawhubId(clawhubId);
    expect(Number(skillId)).to.equal(1);
  });

  // ─── skillPublisher tracking on StakeEscrow ───────────────────────────

  it("tracks skillPublisher on StakeEscrow after publishAndStake", async function () {
    const tx = await binder
      .connect(publisher)
      .publishAndStake(
        LOW,
        ethers.id("meta"),
        ethers.id("publisher-track"),
        ethers.id("prov"),
        0,
        { value: ethers.parseEther("1") }
      );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return binder.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SkillPublished");

    const skillId = Number(event.args.skillId);
    expect(await escrow.skillPublisher(skillId)).to.equal(publisher.address);
  });
});
