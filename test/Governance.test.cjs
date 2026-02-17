/**
 * Governance — Comprehensive test suite (Phase 10)
 *
 * Covers:
 *   1. Parameter initialization (constructor defaults, custom init)
 *   2. Proposal creation (owner-only, valid params, events)
 *   3. Voting mechanics (stake-weighted, duplicate prevention, min stake)
 *   4. Queue + timelock (quorum, majority, delay enforcement)
 *   5. Execution (parameter update, state change)
 *   6. Cancellation + defeat flows
 *   7. Vote stake withdrawal
 *   8. View functions and stats
 *   9. Edge cases (voting after deadline, executing before timelock)
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Governance", function () {
  let governance;
  let owner, voter1, voter2, voter3, other;

  // Helper: merge both view functions into a single object
  async function getProposal(id) {
    const core = await governance.getProposalCore(id);
    const voting = await governance.getProposalVoting(id);
    return {
      id: core.id,
      proposer: core.proposer,
      paramKey: core.paramKey,
      oldValue: core.oldValue,
      newValue: core.newValue,
      description: core.description,
      status: core.status,
      createdAt: voting.createdAt,
      votingDeadline: voting.votingDeadline,
      executionTime: voting.executionTime,
      forVotes: voting.forVotes,
      againstVotes: voting.againstVotes,
      voterCount: voting.voterCount,
    };
  }

  // Parameter keys — Solidity stores string literals as left-aligned ASCII bytes32
  const PARAM_MIN_STAKE = ethers.encodeBytes32String("MIN_STAKE_WEI");
  const PARAM_SLASH_REPORTER = ethers.encodeBytes32String("SLASH_REPORTER_BPS");
  const PARAM_INSURANCE_CAP = ethers.encodeBytes32String("INSURANCE_POOL_CAP");
  const PARAM_SCORING_NAIVE = ethers.encodeBytes32String("SCORING_WEIGHT_NAIVE");

  const VOTE_STAKE = ethers.parseEther("0.02");
  const LARGE_VOTE_STAKE = ethers.parseEther("0.05");
  const MIN_VOTE_STAKE = ethers.parseEther("0.001");

  const THREE_DAYS = 3 * 24 * 60 * 60;
  const ONE_DAY = 24 * 60 * 60;

  beforeEach(async function () {
    [owner, voter1, voter2, voter3, other] = await ethers.getSigners();

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy();
    await governance.waitForDeployment();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. PARAMETER INITIALIZATION
  // ──────────────────────────────────────────────────────────────────────

  describe("Parameter Initialization", function () {
    it("should initialize default parameters in constructor", async function () {
      const minStake = await governance.getParameter(PARAM_MIN_STAKE);
      expect(minStake).to.equal(ethers.parseEther("0.01"));

      const reporterBps = await governance.getParameter(PARAM_SLASH_REPORTER);
      expect(reporterBps).to.equal(4000);
    });

    it("should track parameter count correctly", async function () {
      const count = await governance.getParameterCount();
      expect(count).to.equal(14); // 14 default parameters
    });

    it("should allow owner to initialize a new parameter", async function () {
      const newKey = ethers.id("NEW_PARAM");
      await governance.initParameter(newKey, 42);

      const value = await governance.getParameter(newKey);
      expect(value).to.equal(42);
    });

    it("should reject double initialization of a parameter", async function () {
      const newKey = ethers.id("NEW_PARAM_2");
      await governance.initParameter(newKey, 100);

      await expect(governance.initParameter(newKey, 200))
        .to.be.revertedWith("Already initialized");
    });

    it("should reject parameter init from non-owner", async function () {
      const newKey = ethers.id("UNAUTHORIZED_PARAM");
      await expect(
        governance.connect(voter1).initParameter(newKey, 50)
      ).to.be.revertedWith("Not owner");
    });

    it("should emit ParameterInitialized event", async function () {
      const newKey = ethers.id("EVENT_PARAM");
      await expect(governance.initParameter(newKey, 999))
        .to.emit(governance, "ParameterInitialized")
        .withArgs(newKey, 999);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. PROPOSAL CREATION
  // ──────────────────────────────────────────────────────────────────────

  describe("Proposal Creation", function () {
    it("should create a proposal with correct fields", async function () {
      const tx = await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Double minimum stake for sybil resistance"
      );
      const receipt = await tx.wait();

      const proposal = await getProposal(0);
      expect(proposal.proposer).to.equal(owner.address);
      expect(proposal.paramKey).to.equal(PARAM_MIN_STAKE);
      expect(proposal.oldValue).to.equal(ethers.parseEther("0.01"));
      expect(proposal.newValue).to.equal(ethers.parseEther("0.02"));
      expect(proposal.status).to.equal(0); // Active
      expect(proposal.forVotes).to.equal(0);
      expect(proposal.againstVotes).to.equal(0);
    });

    it("should reject proposal from non-owner", async function () {
      await expect(
        governance.connect(voter1).createProposal(
          PARAM_MIN_STAKE,
          ethers.parseEther("0.02"),
          "Unauthorized proposal"
        )
      ).to.be.revertedWith("Not owner");
    });

    it("should reject proposal for unknown parameter", async function () {
      const fakeKey = ethers.id("NONEXISTENT_PARAM");
      await expect(
        governance.createProposal(fakeKey, 100, "Bad proposal")
      ).to.be.revertedWith("Unknown parameter");
    });

    it("should reject proposal with no value change", async function () {
      const currentMinStake = await governance.getParameter(PARAM_MIN_STAKE);
      await expect(
        governance.createProposal(PARAM_MIN_STAKE, currentMinStake, "No change")
      ).to.be.revertedWith("No change");
    });

    it("should increment proposal IDs sequentially", async function () {
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Proposal 1"
      );
      await governance.createProposal(
        PARAM_SLASH_REPORTER,
        4500,
        "Proposal 2"
      );

      const count = await governance.getProposalCount();
      expect(count).to.equal(2);

      const p0 = await getProposal(0);
      const p1 = await getProposal(1);
      expect(p0.id).to.equal(0);
      expect(p1.id).to.equal(1);
    });

    it("should emit ProposalCreated event", async function () {
      await expect(
        governance.createProposal(
          PARAM_MIN_STAKE,
          ethers.parseEther("0.05"),
          "Raise min stake"
        )
      ).to.emit(governance, "ProposalCreated");
    });

    it("should set voting deadline to 3 days from now", async function () {
      const tx = await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Test deadline"
      );
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const proposal = await getProposal(0);
      expect(proposal.votingDeadline).to.equal(block.timestamp + THREE_DAYS);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. VOTING MECHANICS
  // ──────────────────────────────────────────────────────────────────────

  describe("Voting", function () {
    beforeEach(async function () {
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Double minimum stake"
      );
    });

    it("should accept a FOR vote with stake weight", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE }); // 1 = For

      const proposal = await getProposal(0);
      expect(proposal.forVotes).to.equal(VOTE_STAKE);
      expect(proposal.voterCount).to.equal(1);
    });

    it("should accept an AGAINST vote", async function () {
      await governance.connect(voter1).castVote(0, 0, { value: VOTE_STAKE }); // 0 = Against

      const proposal = await getProposal(0);
      expect(proposal.againstVotes).to.equal(VOTE_STAKE);
    });

    it("should accumulate multiple voter weights", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE });
      await governance.connect(voter2).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await governance.connect(voter3).castVote(0, 0, { value: VOTE_STAKE });

      const proposal = await getProposal(0);
      expect(proposal.forVotes).to.equal(VOTE_STAKE + LARGE_VOTE_STAKE);
      expect(proposal.againstVotes).to.equal(VOTE_STAKE);
      expect(proposal.voterCount).to.equal(3);
    });

    it("should prevent double voting", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE });

      await expect(
        governance.connect(voter1).castVote(0, 0, { value: VOTE_STAKE })
      ).to.be.revertedWith("Already voted");
    });

    it("should reject votes below minimum stake", async function () {
      const tinyStake = ethers.parseEther("0.0001");
      await expect(
        governance.connect(voter1).castVote(0, 1, { value: tinyStake })
      ).to.be.revertedWith("Below min vote stake");
    });

    it("should reject votes on non-active proposals", async function () {
      // Cancel the proposal
      await governance.cancelProposal(0);

      await expect(
        governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE })
      ).to.be.revertedWith("Not active");
    });

    it("should reject votes after voting deadline", async function () {
      await time.increase(THREE_DAYS + 1);

      await expect(
        governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE })
      ).to.be.revertedWith("Voting ended");
    });

    it("should emit VoteCast event", async function () {
      await expect(
        governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE })
      )
        .to.emit(governance, "VoteCast")
        .withArgs(0, voter1.address, 1, VOTE_STAKE);
    });

    it("should record voter info correctly", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE });

      const info = await governance.getVoterInfo(0, voter1.address);
      expect(info.voted).to.be.true;
      expect(info.weight).to.equal(VOTE_STAKE);
      expect(info.direction).to.equal(1); // For
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. QUEUE + TIMELOCK
  // ──────────────────────────────────────────────────────────────────────

  describe("Queue + Timelock", function () {
    beforeEach(async function () {
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Double minimum stake"
      );
    });

    it("should queue a passed proposal after voting ends", async function () {
      // Meet quorum with majority FOR
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });

      await time.increase(THREE_DAYS + 1);

      const tx = await governance.queueProposal(0);
      const block = await ethers.provider.getBlock(tx.blockNumber);

      const proposal = await getProposal(0);
      expect(proposal.status).to.equal(1); // Queued
      expect(proposal.executionTime).to.equal(block.timestamp + ONE_DAY);
    });

    it("should reject queue before voting ends", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });

      await expect(governance.queueProposal(0))
        .to.be.revertedWith("Voting not ended");
    });

    it("should reject queue without quorum", async function () {
      // Vote below quorum (0.05 ETH)
      await governance.connect(voter1).castVote(0, 1, { value: MIN_VOTE_STAKE });

      await time.increase(THREE_DAYS + 1);

      await expect(governance.queueProposal(0))
        .to.be.revertedWith("Quorum not met");
    });

    it("should reject queue without majority", async function () {
      // More AGAINST than FOR
      await governance.connect(voter1).castVote(0, 0, { value: LARGE_VOTE_STAKE }); // Against
      await governance.connect(voter2).castVote(0, 1, { value: MIN_VOTE_STAKE }); // For (tiny)

      await time.increase(THREE_DAYS + 1);

      await expect(governance.queueProposal(0))
        .to.be.revertedWith("Majority not reached");
    });

    it("should reject queue for tied votes", async function () {
      const equalStake = ethers.parseEther("0.03");
      await governance.connect(voter1).castVote(0, 1, { value: equalStake });
      await governance.connect(voter2).castVote(0, 0, { value: equalStake });

      await time.increase(THREE_DAYS + 1);

      await expect(governance.queueProposal(0))
        .to.be.revertedWith("Majority not reached");
    });

    it("should emit ProposalQueued event", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);

      await expect(governance.queueProposal(0))
        .to.emit(governance, "ProposalQueued");
    });

    it("should only allow owner to queue", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);

      await expect(
        governance.connect(voter1).queueProposal(0)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. EXECUTION
  // ──────────────────────────────────────────────────────────────────────

  describe("Execution", function () {
    beforeEach(async function () {
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Double minimum stake"
      );

      // Vote and queue
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(0);
    });

    it("should execute after timelock and update parameter", async function () {
      await time.increase(ONE_DAY + 1);

      await governance.executeProposal(0);

      const proposal = await getProposal(0);
      expect(proposal.status).to.equal(2); // Executed

      const newValue = await governance.getParameter(PARAM_MIN_STAKE);
      expect(newValue).to.equal(ethers.parseEther("0.02"));
    });

    it("should reject execution before timelock", async function () {
      await expect(governance.executeProposal(0))
        .to.be.revertedWith("Timelock not elapsed");
    });

    it("should reject execution of non-queued proposal", async function () {
      // Create another proposal but don't queue it
      await governance.createProposal(
        PARAM_SLASH_REPORTER,
        4500,
        "Raise reporter share"
      );

      await expect(governance.executeProposal(1))
        .to.be.revertedWith("Not queued");
    });

    it("should emit ProposalExecuted and ParameterUpdated events", async function () {
      await time.increase(ONE_DAY + 1);

      await expect(governance.executeProposal(0))
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, PARAM_MIN_STAKE, ethers.parseEther("0.02"))
        .and.to.emit(governance, "ParameterUpdated");
    });

    it("should only allow owner to execute", async function () {
      await time.increase(ONE_DAY + 1);

      await expect(
        governance.connect(voter1).executeProposal(0)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. CANCELLATION + DEFEAT
  // ──────────────────────────────────────────────────────────────────────

  describe("Cancellation + Defeat", function () {
    beforeEach(async function () {
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Double minimum stake"
      );
    });

    it("should cancel an active proposal", async function () {
      await governance.cancelProposal(0);

      const proposal = await getProposal(0);
      expect(proposal.status).to.equal(3); // Cancelled
    });

    it("should cancel a queued proposal", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(0);

      await governance.cancelProposal(0);

      const proposal = await getProposal(0);
      expect(proposal.status).to.equal(3); // Cancelled
    });

    it("should not cancel an executed proposal", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(0);
      await time.increase(ONE_DAY + 1);
      await governance.executeProposal(0);

      await expect(governance.cancelProposal(0))
        .to.be.revertedWith("Cannot cancel");
    });

    it("should defeat a proposal that didn't reach quorum", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: MIN_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);

      await governance.defeatProposal(0);

      const proposal = await getProposal(0);
      expect(proposal.status).to.equal(4); // Defeated
    });

    it("should defeat a proposal that lost majority", async function () {
      await governance.connect(voter1).castVote(0, 0, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);

      await governance.defeatProposal(0);

      const proposal = await getProposal(0);
      expect(proposal.status).to.equal(4); // Defeated
    });

    it("should not defeat a passing proposal", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);

      await expect(governance.defeatProposal(0))
        .to.be.revertedWith("Proposal passed - queue instead");
    });

    it("should not defeat before voting ends", async function () {
      await expect(governance.defeatProposal(0))
        .to.be.revertedWith("Voting not ended");
    });

    it("should emit ProposalCancelled event", async function () {
      await expect(governance.cancelProposal(0))
        .to.emit(governance, "ProposalCancelled")
        .withArgs(0);
    });

    it("should only allow owner to cancel", async function () {
      await expect(
        governance.connect(voter1).cancelProposal(0)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. VOTE STAKE WITHDRAWAL
  // ──────────────────────────────────────────────────────────────────────

  describe("Vote Stake Withdrawal", function () {
    beforeEach(async function () {
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "Double minimum stake"
      );
    });

    it("should allow withdrawal after proposal is executed", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(0);
      await time.increase(ONE_DAY + 1);
      await governance.executeProposal(0);

      const balanceBefore = await ethers.provider.getBalance(voter1.address);
      const tx = await governance.connect(voter1).withdrawVoteStake(0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(voter1.address);

      expect(balanceAfter + gasUsed - balanceBefore).to.equal(LARGE_VOTE_STAKE);
    });

    it("should allow withdrawal after proposal is cancelled", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE });
      await governance.cancelProposal(0);

      const balanceBefore = await ethers.provider.getBalance(voter1.address);
      const tx = await governance.connect(voter1).withdrawVoteStake(0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(voter1.address);

      expect(balanceAfter + gasUsed - balanceBefore).to.equal(VOTE_STAKE);
    });

    it("should allow withdrawal after proposal is defeated", async function () {
      await governance.connect(voter1).castVote(0, 0, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.defeatProposal(0);

      const balanceBefore = await ethers.provider.getBalance(voter1.address);
      const tx = await governance.connect(voter1).withdrawVoteStake(0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(voter1.address);

      expect(balanceAfter + gasUsed - balanceBefore).to.equal(LARGE_VOTE_STAKE);
    });

    it("should prevent withdrawal while proposal is still active", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE });

      await expect(
        governance.connect(voter1).withdrawVoteStake(0)
      ).to.be.revertedWith("Proposal still active");
    });

    it("should prevent double withdrawal", async function () {
      await governance.connect(voter1).castVote(0, 1, { value: VOTE_STAKE });
      await governance.cancelProposal(0);

      await governance.connect(voter1).withdrawVoteStake(0);

      await expect(
        governance.connect(voter1).withdrawVoteStake(0)
      ).to.be.revertedWith("Already withdrawn");
    });

    it("should prevent withdrawal from non-voter", async function () {
      await governance.cancelProposal(0);

      await expect(
        governance.connect(voter1).withdrawVoteStake(0)
      ).to.be.revertedWith("Did not vote");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. VIEW FUNCTIONS + STATS
  // ──────────────────────────────────────────────────────────────────────

  describe("Views + Stats", function () {
    it("should return correct governance stats", async function () {
      // Create proposals in different states
      await governance.createProposal(PARAM_MIN_STAKE, ethers.parseEther("0.02"), "P1");
      await governance.createProposal(PARAM_SLASH_REPORTER, 4500, "P2");
      await governance.createProposal(PARAM_INSURANCE_CAP, ethers.parseEther("200"), "P3");

      // Cancel P2
      await governance.cancelProposal(1);

      // Vote on P1 and execute it
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(0);
      await time.increase(ONE_DAY + 1);
      await governance.executeProposal(0);

      const stats = await governance.getGovernanceStats();
      expect(stats.totalProposals).to.equal(3);
      expect(stats.activeProposals).to.equal(1);  // P3
      expect(stats.executedProposals).to.equal(1); // P1
      expect(stats.cancelledProposals).to.equal(1); // P2
      expect(stats.totalParameters).to.equal(14);
    });

    it("should return correct parameter key at index", async function () {
      const key0 = await governance.getParameterKeyAt(0);

      // First parameter is SCORING_WEIGHT_NAIVE (ASCII bytes32)
      const expectedKey0 = ethers.encodeBytes32String("SCORING_WEIGHT_NAIVE");
      expect(key0).to.equal(expectedKey0);
    });

    it("should revert on unknown parameter lookup", async function () {
      const fakeKey = ethers.id("FAKE_PARAM");
      await expect(governance.getParameter(fakeKey))
        .to.be.revertedWith("Unknown parameter");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 9. FULL LIFECYCLE
  // ──────────────────────────────────────────────────────────────────────

  describe("Full Lifecycle", function () {
    it("should complete create → vote → queue → execute → verify", async function () {
      // Step 1: Verify current value
      const oldValue = await governance.getParameter(PARAM_MIN_STAKE);
      expect(oldValue).to.equal(ethers.parseEther("0.01"));

      // Step 2: Create proposal
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.05"),
        "Raise minimum stake 5x for sybil resistance"
      );

      // Step 3: Community votes
      await governance.connect(voter1).castVote(0, 1, { value: ethers.parseEther("0.03") });
      await governance.connect(voter2).castVote(0, 1, { value: ethers.parseEther("0.02") });
      await governance.connect(voter3).castVote(0, 0, { value: ethers.parseEther("0.01") });

      // Verify vote state
      const afterVotes = await getProposal(0);
      expect(afterVotes.forVotes).to.equal(ethers.parseEther("0.05"));
      expect(afterVotes.againstVotes).to.equal(ethers.parseEther("0.01"));
      expect(afterVotes.voterCount).to.equal(3);

      // Step 4: Wait for voting period to end
      await time.increase(THREE_DAYS + 1);

      // Step 5: Queue
      await governance.queueProposal(0);

      const queued = await getProposal(0);
      expect(queued.status).to.equal(1); // Queued

      // Step 6: Wait for timelock
      await time.increase(ONE_DAY + 1);

      // Step 7: Execute
      await governance.executeProposal(0);

      const executed = await getProposal(0);
      expect(executed.status).to.equal(2); // Executed

      // Step 8: Verify parameter changed
      const newValue = await governance.getParameter(PARAM_MIN_STAKE);
      expect(newValue).to.equal(ethers.parseEther("0.05"));

      // Step 9: Voters withdraw their stake
      await governance.connect(voter1).withdrawVoteStake(0);
      await governance.connect(voter2).withdrawVoteStake(0);
      await governance.connect(voter3).withdrawVoteStake(0);
    });

    it("should handle multiple proposals for the same parameter", async function () {
      // First proposal changes MIN_STAKE to 0.02
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.02"),
        "First change"
      );
      await governance.connect(voter1).castVote(0, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(0);
      await time.increase(ONE_DAY + 1);
      await governance.executeProposal(0);

      let currentValue = await governance.getParameter(PARAM_MIN_STAKE);
      expect(currentValue).to.equal(ethers.parseEther("0.02"));

      // Second proposal changes MIN_STAKE to 0.05
      await governance.createProposal(
        PARAM_MIN_STAKE,
        ethers.parseEther("0.05"),
        "Second change"
      );
      await governance.connect(voter2).castVote(1, 1, { value: LARGE_VOTE_STAKE });
      await time.increase(THREE_DAYS + 1);
      await governance.queueProposal(1);
      await time.increase(ONE_DAY + 1);
      await governance.executeProposal(1);

      currentValue = await governance.getParameter(PARAM_MIN_STAKE);
      expect(currentValue).to.equal(ethers.parseEther("0.05"));
    });
  });
});
