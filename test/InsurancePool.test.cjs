/**
 * InsurancePool — Comprehensive test suite (Phase 6)
 *
 * Covers:
 *   1. Deposits (receive ETH, direct deposit)
 *   2. Claim submission (slashed agent requirement, min claim)
 *   3. Voting / approval mechanics
 *   4. Payout execution (50% pool cap, ETH transfer)
 *   5. Rejection flow
 *   6. Edge cases (insufficient balance, double vote, non-slashed agent)
 *   7. Pool balance management (multiple claims, depletion protection)
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePool", function () {
  let pool;
  let owner, claimant1, claimant2, other;

  const AGENT_ID = ethers.id("what-would-elon-do");
  const AGENT_ID_2 = ethers.id("moltyverse-email");
  const AGENT_CLEAN = ethers.id("gmail-integration");
  const EVIDENCE = ethers.id("evidence-ipfs-hash");
  const DEPOSIT_AMOUNT = ethers.parseEther("1.0");
  const CLAIM_AMOUNT = ethers.parseEther("0.1");
  const SMALL_CLAIM = ethers.parseEther("0.005");

  beforeEach(async function () {
    [owner, claimant1, claimant2, other] = await ethers.getSigners();

    const InsurancePool = await ethers.getContractFactory("InsurancePool");
    pool = await InsurancePool.deploy();
    await pool.waitForDeployment();

    // Fund the pool
    await owner.sendTransaction({
      to: await pool.getAddress(),
      value: DEPOSIT_AMOUNT,
    });

    // Mark test agents as slashed
    await pool.markAgentSlashed(AGENT_ID);
    await pool.markAgentSlashed(AGENT_ID_2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. DEPOSITS
  // ──────────────────────────────────────────────────────────────────────

  describe("Deposits", function () {
    it("should accept ETH via receive() and update pool balance", async function () {
      const balance = await pool.poolBalance();
      expect(balance).to.equal(DEPOSIT_AMOUNT);
    });

    it("should accept ETH via deposit() and update pool balance", async function () {
      const additionalDeposit = ethers.parseEther("0.5");
      await pool.deposit({ value: additionalDeposit });

      const balance = await pool.poolBalance();
      expect(balance).to.equal(DEPOSIT_AMOUNT + additionalDeposit);
    });

    it("should track total deposited across multiple deposits", async function () {
      await pool.deposit({ value: ethers.parseEther("0.3") });
      await pool.deposit({ value: ethers.parseEther("0.2") });

      const totalDeposited = await pool.totalDeposited();
      expect(totalDeposited).to.equal(DEPOSIT_AMOUNT + ethers.parseEther("0.5"));
    });

    it("should reject zero deposit", async function () {
      await expect(pool.deposit({ value: 0 }))
        .to.be.revertedWith("Zero deposit");
    });

    it("should emit Deposited event", async function () {
      const depositAmount = ethers.parseEther("0.1");
      await expect(pool.deposit({ value: depositAmount }))
        .to.emit(pool, "Deposited")
        .withArgs(owner.address, depositAmount, DEPOSIT_AMOUNT + depositAmount);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. CLAIM SUBMISSION
  // ──────────────────────────────────────────────────────────────────────

  describe("Claim Submission", function () {
    it("should allow a claim against a slashed agent", async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);

      const claim = await pool.getClaim(0);
      expect(claim.claimant).to.equal(claimant1.address);
      expect(claim.agentId).to.equal(AGENT_ID);
      expect(claim.amount).to.equal(CLAIM_AMOUNT);
      expect(claim.status).to.equal(0); // Pending
    });

    it("should reject claim against non-slashed agent", async function () {
      await expect(
        pool.connect(claimant1).submitClaim(AGENT_CLEAN, CLAIM_AMOUNT, EVIDENCE)
      ).to.be.revertedWith("Agent not slashed");
    });

    it("should reject claim below minimum amount", async function () {
      const tinyAmount = ethers.parseEther("0.0001");
      await expect(
        pool.connect(claimant1).submitClaim(AGENT_ID, tinyAmount, EVIDENCE)
      ).to.be.revertedWith("Below minimum claim");
    });

    it("should increment claim IDs sequentially", async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
      await pool.connect(claimant2).submitClaim(AGENT_ID_2, SMALL_CLAIM, EVIDENCE);

      const count = await pool.getClaimCount();
      expect(count).to.equal(2);

      const claim0 = await pool.getClaim(0);
      const claim1 = await pool.getClaim(1);
      expect(claim0.id).to.equal(0);
      expect(claim1.id).to.equal(1);
    });

    it("should emit ClaimSubmitted event", async function () {
      await expect(
        pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE)
      )
        .to.emit(pool, "ClaimSubmitted")
        .withArgs(0, claimant1.address, AGENT_ID, CLAIM_AMOUNT);
    });

    it("should reject claim when pool is empty", async function () {
      // Deploy a fresh pool with no deposits
      const InsurancePool = await ethers.getContractFactory("InsurancePool");
      const emptyPool = await InsurancePool.deploy();
      await emptyPool.waitForDeployment();
      await emptyPool.markAgentSlashed(AGENT_ID);

      await expect(
        emptyPool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE)
      ).to.be.revertedWith("Pool empty");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. VOTING / APPROVAL MECHANICS
  // ──────────────────────────────────────────────────────────────────────

  describe("Voting", function () {
    beforeEach(async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
    });

    it("should record an approve vote", async function () {
      await pool.voteClaim(0, true);

      const claim = await pool.getClaim(0);
      expect(claim.approveVotes).to.equal(1);
    });

    it("should record a reject vote", async function () {
      await pool.voteClaim(0, false);

      const claim = await pool.getClaim(0);
      expect(claim.rejectVotes).to.equal(1);
    });

    it("should prevent double voting", async function () {
      await pool.voteClaim(0, true);

      await expect(pool.voteClaim(0, true))
        .to.be.revertedWith("Already voted");
    });

    it("should emit ClaimVoted event", async function () {
      await expect(pool.voteClaim(0, true))
        .to.emit(pool, "ClaimVoted")
        .withArgs(0, owner.address, true);
    });

    it("should only allow owner to vote (v1)", async function () {
      await expect(
        pool.connect(claimant1).voteClaim(0, true)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. PAYOUT EXECUTION
  // ──────────────────────────────────────────────────────────────────────

  describe("Payouts", function () {
    beforeEach(async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
    });

    it("should pay out when owner directly approves", async function () {
      const balanceBefore = await ethers.provider.getBalance(claimant1.address);

      await pool.approveClaim(0);

      const balanceAfter = await ethers.provider.getBalance(claimant1.address);
      expect(balanceAfter - balanceBefore).to.equal(CLAIM_AMOUNT);

      const claim = await pool.getClaim(0);
      expect(claim.status).to.equal(3); // Paid
      expect(claim.payoutAmount).to.equal(CLAIM_AMOUNT);
    });

    it("should cap payout at 50% of pool balance", async function () {
      // Submit a large claim that exceeds 50% of pool
      const largeClaim = ethers.parseEther("0.8");
      await pool.connect(claimant2).submitClaim(AGENT_ID_2, largeClaim, EVIDENCE);

      const poolBefore = await pool.poolBalance();
      const maxPayout = poolBefore * 5000n / 10000n; // 50%

      await pool.approveClaim(1);

      const claim = await pool.getClaim(1);
      expect(claim.payoutAmount).to.equal(maxPayout);
      expect(claim.status).to.equal(3); // Paid
    });

    it("should update pool balance and totalPaidOut after payout", async function () {
      const poolBefore = await pool.poolBalance();

      await pool.approveClaim(0);

      const poolAfter = await pool.poolBalance();
      const totalPaid = await pool.totalPaidOut();

      expect(poolAfter).to.equal(poolBefore - CLAIM_AMOUNT);
      expect(totalPaid).to.equal(CLAIM_AMOUNT);
    });

    it("should emit ClaimApproved and ClaimPaid events", async function () {
      await expect(pool.approveClaim(0))
        .to.emit(pool, "ClaimApproved")
        .withArgs(0, CLAIM_AMOUNT)
        .and.to.emit(pool, "ClaimPaid")
        .withArgs(0, claimant1.address, CLAIM_AMOUNT);
    });

    it("should only allow owner to directly approve", async function () {
      await expect(
        pool.connect(claimant1).approveClaim(0)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. REJECTION
  // ──────────────────────────────────────────────────────────────────────

  describe("Rejection", function () {
    beforeEach(async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
    });

    it("should reject a claim and set status to Rejected", async function () {
      await pool.rejectClaim(0);

      const claim = await pool.getClaim(0);
      expect(claim.status).to.equal(2); // Rejected
    });

    it("should not affect pool balance on rejection", async function () {
      const poolBefore = await pool.poolBalance();

      await pool.rejectClaim(0);

      const poolAfter = await pool.poolBalance();
      expect(poolAfter).to.equal(poolBefore);
    });

    it("should emit ClaimRejected event", async function () {
      await expect(pool.rejectClaim(0))
        .to.emit(pool, "ClaimRejected")
        .withArgs(0);
    });

    it("should not allow rejecting already-paid claim", async function () {
      await pool.approveClaim(0);

      await expect(pool.rejectClaim(0))
        .to.be.revertedWith("Not pending");
    });

    it("should not allow approving already-rejected claim", async function () {
      await pool.rejectClaim(0);

      await expect(pool.approveClaim(0))
        .to.be.revertedWith("Not pending");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. EDGE CASES
  // ──────────────────────────────────────────────────────────────────────

  describe("Edge Cases", function () {
    it("should handle multiple claims from same claimant", async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, SMALL_CLAIM, EVIDENCE);
      await pool.connect(claimant1).submitClaim(AGENT_ID, SMALL_CLAIM, EVIDENCE);

      const count = await pool.getClaimCount();
      expect(count).to.equal(2);
    });

    it("should mark and check slashed agents correctly", async function () {
      expect(await pool.isAgentSlashed(AGENT_ID)).to.be.true;
      expect(await pool.isAgentSlashed(AGENT_CLEAN)).to.be.false;
    });

    it("should return correct pool stats", async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
      await pool.connect(claimant2).submitClaim(AGENT_ID_2, SMALL_CLAIM, EVIDENCE);

      await pool.approveClaim(0);  // Paid
      await pool.rejectClaim(1);   // Rejected

      const stats = await pool.getPoolStats();
      expect(stats._totalClaims).to.equal(2);
      expect(stats._paidClaims).to.equal(1);
      expect(stats._rejectedClaims).to.equal(1);
      expect(stats._pendingClaims).to.equal(0);
    });

    it("should only allow owner to mark agents as slashed", async function () {
      await expect(
        pool.connect(claimant1).markAgentSlashed(AGENT_CLEAN)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. POOL BALANCE MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────

  describe("Pool Balance Management", function () {
    it("should handle sequential payouts reducing pool balance", async function () {
      // Submit 3 claims at 0.1 ETH each against 1.0 ETH pool
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
      await pool.connect(claimant2).submitClaim(AGENT_ID_2, CLAIM_AMOUNT, EVIDENCE);

      // Approve both
      await pool.approveClaim(0);
      await pool.approveClaim(1);

      const poolBalance = await pool.poolBalance();
      expect(poolBalance).to.equal(DEPOSIT_AMOUNT - CLAIM_AMOUNT * 2n);
    });

    it("should enforce 50% cap on large claims preventing pool depletion", async function () {
      // Submit a claim for 100% of pool
      const fullPoolClaim = ethers.parseEther("1.0");
      await pool.connect(claimant1).submitClaim(AGENT_ID, fullPoolClaim, EVIDENCE);

      await pool.approveClaim(0);

      // Pool should still have 50% remaining
      const poolBalance = await pool.poolBalance();
      expect(poolBalance).to.equal(DEPOSIT_AMOUNT / 2n);
    });

    it("should allow new deposits to replenish pool after payouts", async function () {
      // Drain some of the pool
      await pool.connect(claimant1).submitClaim(AGENT_ID, ethers.parseEther("0.4"), EVIDENCE);
      await pool.approveClaim(0);

      const afterPayout = await pool.poolBalance();

      // Replenish
      const replenish = ethers.parseEther("0.5");
      await pool.deposit({ value: replenish });

      const afterReplenish = await pool.poolBalance();
      expect(afterReplenish).to.equal(afterPayout + replenish);
    });

    it("should track total deposited and paid out independently", async function () {
      await pool.connect(claimant1).submitClaim(AGENT_ID, CLAIM_AMOUNT, EVIDENCE);
      await pool.approveClaim(0);

      await pool.deposit({ value: ethers.parseEther("0.5") });

      const totalDeposited = await pool.totalDeposited();
      const totalPaid = await pool.totalPaidOut();
      const poolBalance = await pool.poolBalance();

      // totalDeposited = 1.0 (initial) + 0.5 (replenish) = 1.5
      expect(totalDeposited).to.equal(ethers.parseEther("1.5"));
      // totalPaid = 0.1
      expect(totalPaid).to.equal(CLAIM_AMOUNT);
      // poolBalance = 1.5 - 0.1 = 1.4
      expect(poolBalance).to.equal(ethers.parseEther("1.4"));
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. YIELD DISTRIBUTION
  // ──────────────────────────────────────────────────────────────────────

  describe("Yield Distribution", function () {
    let staking;
    let publisher, curator;
    const stakeAmount = ethers.parseEther("0.10");
    const delegateAmount = ethers.parseEther("0.05");

    beforeEach(async function () {
      [owner, claimant1, claimant2, other, publisher, curator] = await ethers.getSigners();

      // Deploy TrustStaking
      const TrustStaking = await ethers.getContractFactory("TrustStaking");
      staking = await TrustStaking.deploy(await pool.getAddress(), owner.address);
      await staking.waitForDeployment();

      // Wire up
      await pool.setTrustStaking(await staking.getAddress());

      // Stake and delegate
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: stakeAmount });
      await staking.connect(curator).delegate(AGENT_ID, { value: delegateAmount });
    });

    it("should set surplus threshold via admin", async function () {
      const newThreshold = ethers.parseEther("2.0");
      await pool.setSurplusThreshold(newThreshold);

      const threshold = await pool.surplusThreshold();
      expect(threshold).to.equal(newThreshold);
    });

    it("should reject yield when no surplus exists", async function () {
      // Set threshold above pool balance
      await pool.setSurplusThreshold(ethers.parseEther("10.0"));

      await expect(
        pool.connect(publisher).claimYield(AGENT_ID)
      ).to.be.revertedWith("No surplus");
    });

    it("should reject yield when staker has no stake", async function () {
      // Pool has 1 ETH, default threshold is 1 ETH — set lower to create surplus
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      await expect(
        pool.connect(other).claimYield(AGENT_ID)
      ).to.be.revertedWith("No stake in this agent");
    });

    it("should allow publisher to claim yield from surplus", async function () {
      // Set low threshold so surplus exists
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      const balBefore = await ethers.provider.getBalance(publisher.address);
      const tx = await pool.connect(publisher).claimYield(AGENT_ID);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(publisher.address);

      // Should have received some yield
      expect(balAfter - balBefore + gasCost).to.be.greaterThan(0);
    });

    it("should allow delegator to claim yield", async function () {
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      const balBefore = await ethers.provider.getBalance(curator.address);
      const tx = await pool.connect(curator).claimYield(AGENT_ID);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(curator.address);

      expect(balAfter - balBefore + gasCost).to.be.greaterThan(0);
    });

    it("should distribute yield pro-rata by stake", async function () {
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      // Publisher: 0.10 ETH, Curator: 0.05 ETH → 2:1 ratio
      const publisherYield = await pool.getAvailableYield(AGENT_ID, publisher.address);
      const curatorYield = await pool.getAvailableYield(AGENT_ID, curator.address);

      // Publisher should get 2x curator's share
      expect(publisherYield).to.be.closeTo(curatorYield * 2n, 100n);
    });

    it("should cap yield at YIELD_CAP_BPS per epoch", async function () {
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      const surplus = ethers.parseEther("0.5"); // pool(1.0) - threshold(0.5)
      const expectedCap = surplus * 1000n / 10000n; // 10% of surplus

      const publisherYield = await pool.getAvailableYield(AGENT_ID, publisher.address);
      const curatorYield = await pool.getAvailableYield(AGENT_ID, curator.address);

      // Total available yield should not exceed epoch cap
      expect(publisherYield + curatorYield).to.be.lessThanOrEqual(expectedCap);
    });

    it("should reduce pool balance after yield claim", async function () {
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      const poolBefore = await pool.poolBalance();
      await pool.connect(publisher).claimYield(AGENT_ID);
      const poolAfter = await pool.poolBalance();

      expect(poolAfter).to.be.lessThan(poolBefore);
    });

    it("should track yield claimed per staker", async function () {
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      await pool.connect(publisher).claimYield(AGENT_ID);

      const claimed = await pool.yieldClaimed(publisher.address);
      expect(claimed).to.be.greaterThan(0);
    });

    it("should emit YieldClaimed event", async function () {
      await pool.setSurplusThreshold(ethers.parseEther("0.5"));

      await expect(pool.connect(publisher).claimYield(AGENT_ID))
        .to.emit(pool, "YieldClaimed");
    });

    it("should only allow owner to set TrustStaking", async function () {
      await expect(
        pool.connect(claimant1).setTrustStaking(claimant1.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should only allow owner to set surplus threshold", async function () {
      await expect(
        pool.connect(claimant1).setSurplusThreshold(0)
      ).to.be.revertedWith("Not owner");
    });
  });
});
