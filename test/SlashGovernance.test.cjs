const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Slash Governance (Phase 4)", function () {
  let registry;
  let escrow;
  let slashing;
  let owner;
  let provider;
  let validator1;
  let validator2;
  let validator3;
  let validator4;
  let validator5;
  let treasury;
  let nonValidator;

  const LOW = 0;
  let skillCounter = 0;

  async function registerAndStakeSkill(signer, stakeEth) {
    skillCounter++;
    const tx = await registry
      .connect(signer)
      .registerSkill(
        LOW,
        ethers.id(`meta-${skillCounter}`),
        ethers.id(`clawhub:governance:${skillCounter}`),
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
    [owner, provider, validator1, validator2, validator3, validator4, validator5, treasury, nonValidator] =
      await ethers.getSigners();

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
      owner.address, // slashAuthority (direct path)
      treasury.address
    );
    await slashing.waitForDeployment();

    await escrow.connect(owner).setSlashingManager(await slashing.getAddress());

    // Add 5 validators
    await slashing.connect(owner).addValidator(validator1.address);
    await slashing.connect(owner).addValidator(validator2.address);
    await slashing.connect(owner).addValidator(validator3.address);
    await slashing.connect(owner).addValidator(validator4.address);
    await slashing.connect(owner).addValidator(validator5.address);

    // Quorum = 3
    await slashing.connect(owner).setSlashQuorum(3);
  });

  // ─── Proposal creation ───────────────────────────────────────────────

  it("validator can propose a slash", async function () {
    const skillId = await registerAndStakeSkill(provider, "10");
    const caseId = ethers.id("case-propose-1");

    const tx = await slashing
      .connect(validator1)
      .proposeSlash(skillId, 5000, ethers.id("MALWARE"), "ipfs://evidence/1", caseId);
    const receipt = await tx.wait();

    const proposed = receipt.logs
      .map((log) => {
        try { return slashing.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "SlashProposed");

    expect(proposed).to.not.be.null;
    expect(Number(proposed.args.skillId)).to.equal(skillId);
    expect(proposed.args.proposer).to.equal(validator1.address);

    // Proposal is pending with 1 approval (proposer auto-votes)
    const [, , , proposer, approvals, rejections, status] =
      await slashing.getProposal(caseId);
    expect(proposer).to.equal(validator1.address);
    expect(Number(approvals)).to.equal(1);
    expect(Number(rejections)).to.equal(0);
    expect(Number(status)).to.equal(0); // Pending
  });

  // ─── Non-validator cannot propose ────────────────────────────────────

  it("non-validator cannot propose a slash", async function () {
    const skillId = await registerAndStakeSkill(provider, "5");
    await expect(
      slashing
        .connect(nonValidator)
        .proposeSlash(skillId, 5000, ethers.id("MALWARE"), "ipfs://evidence/2", ethers.id("case-nv"))
    ).to.be.revertedWith("NOT_VALIDATOR");
  });

  // ─── Quorum triggers execution ──────────────────────────────────────

  it("slash auto-executes when quorum (3/5) is reached", async function () {
    const skillId = await registerAndStakeSkill(provider, "10");
    const caseId = ethers.id("case-quorum-1");

    // Validator 1 proposes (1 approval)
    await slashing
      .connect(validator1)
      .proposeSlash(skillId, 5000, ethers.id("EXFILTRATION"), "ipfs://evidence/q1", caseId);

    // Validator 2 approves (2 approvals)
    await slashing.connect(validator2).voteOnSlash(caseId, true);

    // Still pending
    let [, , , , approvals, , status] = await slashing.getProposal(caseId);
    expect(Number(approvals)).to.equal(2);
    expect(Number(status)).to.equal(0); // Pending

    // Validator 3 approves (3 approvals = quorum → auto-execute)
    const tx = await slashing.connect(validator3).voteOnSlash(caseId, true);
    const receipt = await tx.wait();

    const executed = receipt.logs
      .map((log) => {
        try { return slashing.interface.parseLog(log); } catch { return null; }
      })
      .find((x) => x && x.name === "ProposalExecuted");

    expect(executed).to.not.be.null;

    // Status is now Executed
    [, , , , , , status] = await slashing.getProposal(caseId);
    expect(Number(status)).to.equal(3); // Executed

    // Stake was slashed 50%
    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("5"));
  });

  // ─── Non-validator cannot vote ──────────────────────────────────────

  it("non-validator cannot vote", async function () {
    const skillId = await registerAndStakeSkill(provider, "5");
    const caseId = ethers.id("case-nv-vote");
    await slashing
      .connect(validator1)
      .proposeSlash(skillId, 3000, ethers.id("ABUSE"), "ipfs://evidence/nv", caseId);

    await expect(
      slashing.connect(nonValidator).voteOnSlash(caseId, true)
    ).to.be.revertedWith("NOT_VALIDATOR");
  });

  // ─── Double vote prevention ─────────────────────────────────────────

  it("validator cannot vote twice on the same proposal", async function () {
    const skillId = await registerAndStakeSkill(provider, "5");
    const caseId = ethers.id("case-double");
    await slashing
      .connect(validator1)
      .proposeSlash(skillId, 2000, ethers.id("SPAM"), "ipfs://evidence/dbl", caseId);

    // Proposer already voted — cannot vote again
    await expect(
      slashing.connect(validator1).voteOnSlash(caseId, true)
    ).to.be.revertedWith("ALREADY_VOTED");
  });

  // ─── Rejection when quorum impossible ──────────────────────────────

  it("auto-rejects when quorum becomes impossible", async function () {
    const skillId = await registerAndStakeSkill(provider, "5");
    const caseId = ethers.id("case-reject");
    await slashing
      .connect(validator1)
      .proposeSlash(skillId, 2000, ethers.id("MINOR"), "ipfs://evidence/rej", caseId);

    // 3 validators reject → quorum (3) impossible with 1 approve + 3 reject + 1 remaining
    await slashing.connect(validator2).voteOnSlash(caseId, false);
    await slashing.connect(validator3).voteOnSlash(caseId, false);
    await slashing.connect(validator4).voteOnSlash(caseId, false);

    const [, , , , approvals, rejections, status] = await slashing.getProposal(caseId);
    expect(Number(approvals)).to.equal(1);
    expect(Number(rejections)).to.equal(3);
    expect(Number(status)).to.equal(2); // Rejected

    // Stake untouched
    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("5"));
  });

  // ─── Duplicate caseId prevention (via governance path) ──────────────

  it("prevents duplicate caseId in proposals", async function () {
    const skillId = await registerAndStakeSkill(provider, "5");
    const caseId = ethers.id("case-dup-gov");
    await slashing
      .connect(validator1)
      .proposeSlash(skillId, 1000, ethers.id("DUP"), "ipfs://evidence/dup", caseId);

    await expect(
      slashing
        .connect(validator2)
        .proposeSlash(skillId, 1000, ethers.id("DUP2"), "ipfs://evidence/dup2", caseId)
    ).to.be.revertedWith("PROPOSAL_EXISTS");
  });

  // ─── Direct authority path still works ──────────────────────────────

  it("direct slashSkill still works for backward compatibility", async function () {
    const skillId = await registerAndStakeSkill(provider, "10");
    const caseId = ethers.id("case-direct");

    await slashing
      .connect(owner) // owner is the slashAuthority
      .slashSkill(skillId, 3000, ethers.id("DIRECT"), "ipfs://evidence/direct", caseId);

    expect(await escrow.getSkillStake(skillId)).to.equal(ethers.parseEther("7"));
  });

  // ─── Proposal count tracking ────────────────────────────────────────

  it("tracks proposal count correctly", async function () {
    const s1 = await registerAndStakeSkill(provider, "5");
    const s2 = await registerAndStakeSkill(provider, "5");

    expect(await slashing.getProposalCount()).to.equal(0);

    await slashing
      .connect(validator1)
      .proposeSlash(s1, 1000, ethers.id("A"), "ipfs://a", ethers.id("count-1"));
    expect(await slashing.getProposalCount()).to.equal(1);

    await slashing
      .connect(validator1)
      .proposeSlash(s2, 2000, ethers.id("B"), "ipfs://b", ethers.id("count-2"));
    expect(await slashing.getProposalCount()).to.equal(2);
  });
});
