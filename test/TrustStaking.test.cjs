/**
 * TrustStaking — Comprehensive test suite
 *
 * Covers:
 *   1. Staking lifecycle (stake, increase, tier computation)
 *   2. Delegation (add delegation, shared risk)
 *   3. Slashing (proportional, distribution, deactivation)
 *   4. Unbonding & withdrawal (cooldown enforcement)
 *   5. Edge cases & access control
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TrustStaking", function () {
  let staking;
  let owner, publisher, curator, reporter, other;
  let insurancePool, treasury;

  const AGENT_ID = ethers.id("gmail-integration");
  const AGENT_ID_2 = ethers.id("deep-research-agent");
  const MIN_STAKE = ethers.parseEther("0.01");
  const MID_STAKE = ethers.parseEther("0.05");
  const HIGH_STAKE = ethers.parseEther("0.25");
  const UNBONDING_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds

  beforeEach(async function () {
    [owner, publisher, curator, reporter, other] = await ethers.getSigners();

    // Use separate addresses for insurance and treasury to verify distributions
    insurancePool = other; // reuse 'other' signer as insurance receiver
    treasury = owner;      // reuse owner as treasury receiver

    const TrustStaking = await ethers.getContractFactory("TrustStaking");
    staking = await TrustStaking.deploy(insurancePool.address, treasury.address);
    await staking.waitForDeployment();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. STAKING
  // ──────────────────────────────────────────────────────────────────────

  describe("Staking", function () {
    it("should allow a publisher to stake for an agent", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.publisher).to.equal(publisher.address);
      expect(info.stakeAmount).to.equal(MIN_STAKE);
      expect(info.totalStake).to.equal(MIN_STAKE);
      expect(info.active).to.be.true;
      expect(info.tier).to.equal(1); // Tier2Low
    });

    it("should reject stake below minimum", async function () {
      const tooLow = ethers.parseEther("0.005");
      await expect(
        staking.connect(publisher).stakeAgent(AGENT_ID, { value: tooLow })
      ).to.be.revertedWith("Below minimum stake");
    });

    it("should reject double-staking the same agent", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });
      await expect(
        staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE })
      ).to.be.revertedWith("Already staked");
    });

    it("should compute Tier2Mid for mid-range stake", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MID_STAKE });
      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.tier).to.equal(2); // Tier2Mid
    });

    it("should compute Tier2High for high stake", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: HIGH_STAKE });
      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.tier).to.equal(3); // Tier2High
    });

    it("should allow publisher to increase stake", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });
      await staking.connect(publisher).increaseStake(AGENT_ID, { value: MIN_STAKE });

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.stakeAmount).to.equal(MIN_STAKE * 2n);
      expect(info.totalStake).to.equal(MIN_STAKE * 2n);
    });

    it("should emit AgentStaked event", async function () {
      await expect(staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE }))
        .to.emit(staking, "AgentStaked")
        .withArgs(AGENT_ID, publisher.address, MIN_STAKE, 1);
    });

    it("should track agent count correctly", async function () {
      expect(await staking.getAgentCount()).to.equal(0);
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });
      expect(await staking.getAgentCount()).to.equal(1);
      await staking.connect(publisher).stakeAgent(AGENT_ID_2, { value: MIN_STAKE });
      expect(await staking.getAgentCount()).to.equal(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. DELEGATION
  // ──────────────────────────────────────────────────────────────────────

  describe("Delegation", function () {
    beforeEach(async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });
    });

    it("should allow curator to delegate ETH", async function () {
      const delegateAmount = ethers.parseEther("0.02");
      await staking.connect(curator).delegate(AGENT_ID, { value: delegateAmount });

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.delegatedStake).to.equal(delegateAmount);
      expect(info.totalStake).to.equal(MIN_STAKE + delegateAmount);
    });

    it("should upgrade tier when delegation pushes total above threshold", async function () {
      const info1 = await staking.getAgentStake(AGENT_ID);
      expect(info1.tier).to.equal(1); // Tier2Low with 0.01 ETH

      // Add enough delegation to reach Tier2Mid (0.05)
      await staking.connect(curator).delegate(AGENT_ID, { value: ethers.parseEther("0.04") });
      const info2 = await staking.getAgentStake(AGENT_ID);
      expect(info2.tier).to.equal(2); // Tier2Mid
    });

    it("should reject delegation to inactive agent", async function () {
      const fakeAgent = ethers.id("nonexistent");
      await expect(
        staking.connect(curator).delegate(fakeAgent, { value: MIN_STAKE })
      ).to.be.revertedWith("Agent not active");
    });

    it("should track delegation per curator", async function () {
      const amount = ethers.parseEther("0.03");
      await staking.connect(curator).delegate(AGENT_ID, { value: amount });
      expect(await staking.getDelegation(curator.address, AGENT_ID)).to.equal(amount);
    });

    it("should emit DelegationAdded event", async function () {
      const amount = ethers.parseEther("0.02");
      await expect(staking.connect(curator).delegate(AGENT_ID, { value: amount }))
        .to.emit(staking, "DelegationAdded")
        .withArgs(AGENT_ID, curator.address, amount);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. SLASHING
  // ──────────────────────────────────────────────────────────────────────

  describe("Slashing", function () {
    const stakeAmount = ethers.parseEther("0.10");
    const delegateAmount = ethers.parseEther("0.04");

    beforeEach(async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: stakeAmount });
      await staking.connect(curator).delegate(AGENT_ID, { value: delegateAmount });
    });

    it("should slash proportionally between publisher and delegator", async function () {
      // 50% slash on total 0.14 ETH
      await staking.slash(AGENT_ID, 5000, "Low trust score", reporter.address);

      const info = await staking.getAgentStake(AGENT_ID);
      // Publisher had 0.10, slashed 50% = 0.05 remaining
      expect(info.stakeAmount).to.equal(stakeAmount / 2n);
      // Delegated had 0.04, slashed 50% = 0.02 remaining
      expect(info.delegatedStake).to.equal(delegateAmount / 2n);
      expect(info.totalStake).to.equal((stakeAmount + delegateAmount) / 2n);
    });

    it("should distribute slashed funds correctly", async function () {
      const totalStake = stakeAmount + delegateAmount; // 0.14 ETH
      const slashAmount = totalStake / 2n; // 50% = 0.07 ETH

      const reporterBefore = await ethers.provider.getBalance(reporter.address);
      const insuranceBefore = await ethers.provider.getBalance(insurancePool.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await staking.slash(AGENT_ID, 5000, "Malicious update", reporter.address);

      const reporterAfter = await ethers.provider.getBalance(reporter.address);
      const insuranceAfter = await ethers.provider.getBalance(insurancePool.address);

      // Reporter gets 40% of slashed amount
      const expectedReporter = slashAmount * 4000n / 10000n;
      expect(reporterAfter - reporterBefore).to.equal(expectedReporter);

      // Insurance pool gets 30%
      const expectedInsurance = slashAmount * 3000n / 10000n;
      expect(insuranceAfter - insuranceBefore).to.equal(expectedInsurance);
    });

    it("should deactivate agent when stake falls below minimum", async function () {
      // Slash 95% — should push below MIN_STAKE
      await staking.slash(AGENT_ID, 9500, "Credential leaking", reporter.address);
      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.active).to.be.false;
    });

    it("should record slash in history", async function () {
      await staking.slash(AGENT_ID, 5000, "Sybil ring detected", reporter.address);

      expect(await staking.getSlashHistoryLength()).to.equal(1);
      const record = await staking.getSlashRecord(0);
      expect(record.agentId).to.equal(AGENT_ID);
      expect(record.reason).to.equal("Sybil ring detected");
      expect(record.reporter).to.equal(reporter.address);
    });

    it("should return agent-specific slash history", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID_2, { value: stakeAmount });

      await staking.slash(AGENT_ID, 2500, "Reason A", reporter.address);
      await staking.slash(AGENT_ID_2, 1000, "Reason B", reporter.address);
      await staking.slash(AGENT_ID, 1000, "Reason C", reporter.address);

      const history = await staking.getAgentSlashHistory(AGENT_ID);
      expect(history.length).to.equal(2);
      expect(history[0].reason).to.equal("Reason A");
      expect(history[1].reason).to.equal("Reason C");
    });

    it("should only allow owner to slash", async function () {
      await expect(
        staking.connect(publisher).slash(AGENT_ID, 5000, "Unauthorized", reporter.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should emit AgentSlashed event", async function () {
      const totalStake = stakeAmount + delegateAmount;
      const expectedSlash = totalStake * 5000n / 10000n;

      await expect(staking.slash(AGENT_ID, 5000, "Test slash", reporter.address))
        .to.emit(staking, "AgentSlashed")
        .withArgs(AGENT_ID, expectedSlash, "Test slash", reporter.address);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. UNBONDING & WITHDRAWAL
  // ──────────────────────────────────────────────────────────────────────

  describe("Unbonding & Withdrawal", function () {
    const stakeAmount = ethers.parseEther("0.10");

    beforeEach(async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: stakeAmount });
    });

    it("should initiate unbonding with correct cooldown", async function () {
      const half = stakeAmount / 2n;
      await staking.connect(publisher).initiateUnbonding(AGENT_ID, half);

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.stakeAmount).to.equal(half);
      expect(info.totalStake).to.equal(half);

      const unbonding = await staking.getUnbonding(publisher.address, AGENT_ID);
      expect(unbonding.amount).to.equal(half);
    });

    it("should reject early withdrawal", async function () {
      await staking.connect(publisher).initiateUnbonding(AGENT_ID, stakeAmount);

      await expect(
        staking.connect(publisher).completeUnbonding(AGENT_ID)
      ).to.be.revertedWith("Still in unbonding period");
    });

    it("should allow withdrawal after unbonding period", async function () {
      await staking.connect(publisher).initiateUnbonding(AGENT_ID, stakeAmount);

      // Fast-forward 7 days
      await time.increase(UNBONDING_PERIOD);

      const balBefore = await ethers.provider.getBalance(publisher.address);
      const tx = await staking.connect(publisher).completeUnbonding(AGENT_ID);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(publisher.address);

      expect(balAfter - balBefore + gasCost).to.equal(stakeAmount);

      // Unbonding should be cleared
      const unbonding = await staking.getUnbonding(publisher.address, AGENT_ID);
      expect(unbonding.amount).to.equal(0);
    });

    it("should allow curator to unbond their delegation", async function () {
      const delegateAmount = ethers.parseEther("0.03");
      await staking.connect(curator).delegate(AGENT_ID, { value: delegateAmount });

      await staking.connect(curator).initiateUnbonding(AGENT_ID, delegateAmount);

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.delegatedStake).to.equal(0);
      expect(info.totalStake).to.equal(stakeAmount);
    });

    it("should deactivate agent if unbonding reduces stake below minimum", async function () {
      await staking.connect(publisher).initiateUnbonding(AGENT_ID, stakeAmount);
      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.active).to.be.false;
    });

    it("should reject unbonding more than staked", async function () {
      const tooMuch = stakeAmount + 1n;
      await expect(
        staking.connect(publisher).initiateUnbonding(AGENT_ID, tooMuch)
      ).to.be.revertedWith("Exceeds publisher stake");
    });

    it("should emit UnbondingInitiated and UnbondingCompleted events", async function () {
      await expect(staking.connect(publisher).initiateUnbonding(AGENT_ID, stakeAmount))
        .to.emit(staking, "UnbondingInitiated");

      await time.increase(UNBONDING_PERIOD);

      await expect(staking.connect(publisher).completeUnbonding(AGENT_ID))
        .to.emit(staking, "UnbondingCompleted")
        .withArgs(AGENT_ID, publisher.address, stakeAmount);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. INTEGRATION: SLASH + TRUST SCORE TRIGGER
  // ──────────────────────────────────────────────────────────────────────

  describe("Trust Score Slash Trigger", function () {
    it("should handle slash triggered by low trust score", async function () {
      const stakeAmount = ethers.parseEther("0.10");
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: stakeAmount });

      // Simulate: off-chain scoring engine detects trust score dropped below threshold
      // Owner calls slash with reason referencing the trust score
      await staking.slash(AGENT_ID, 2500, "Trust score dropped below BB (40)", reporter.address);

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.stakeAmount).to.equal(stakeAmount * 7500n / 10000n);
      expect(info.active).to.be.true; // Still above min stake
    });

    it("should handle slash triggered by validated complaint", async function () {
      const stakeAmount = ethers.parseEther("0.10");
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: stakeAmount });

      // 100% slash for confirmed credential leaking
      await staking.slash(AGENT_ID, 10000, "Confirmed credential leaking (Snyk)", reporter.address);

      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.totalStake).to.equal(0);
      expect(info.active).to.be.false;
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. MULTIPLE AGENTS / COMPLEX FLOWS
  // ──────────────────────────────────────────────────────────────────────

  describe("Complex Flows", function () {
    it("should handle multiple agents staked by same publisher", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });
      await staking.connect(publisher).stakeAgent(AGENT_ID_2, { value: MID_STAKE });

      const info1 = await staking.getAgentStake(AGENT_ID);
      const info2 = await staking.getAgentStake(AGENT_ID_2);

      expect(info1.publisher).to.equal(publisher.address);
      expect(info2.publisher).to.equal(publisher.address);
      expect(info1.tier).to.equal(1); // Tier2Low
      expect(info2.tier).to.equal(2); // Tier2Mid
    });

    it("should handle slash-then-unbond flow", async function () {
      const amount = ethers.parseEther("0.10");
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: amount });

      // Slash 50%
      await staking.slash(AGENT_ID, 5000, "Partial slash", reporter.address);

      const remaining = amount / 2n;
      const info = await staking.getAgentStake(AGENT_ID);
      expect(info.stakeAmount).to.equal(remaining);

      // Unbond remaining
      await staking.connect(publisher).initiateUnbonding(AGENT_ID, remaining);
      await time.increase(UNBONDING_PERIOD);
      await staking.connect(publisher).completeUnbonding(AGENT_ID);

      const unbonding = await staking.getUnbonding(publisher.address, AGENT_ID);
      expect(unbonding.amount).to.equal(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. TENURE VIEWS
  // ──────────────────────────────────────────────────────────────────────

  describe("Tenure Views", function () {
    it("should return stakedAt timestamp", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });

      const stakedAt = await staking.getStakedAt(AGENT_ID);
      expect(stakedAt).to.be.greaterThan(0);
    });

    it("should return 0 for unstaked agent", async function () {
      const stakedAt = await staking.getStakedAt(AGENT_ID);
      expect(stakedAt).to.equal(0);

      const tenure = await staking.getTenure(AGENT_ID);
      expect(tenure).to.equal(0);
    });

    it("should increase tenure over time", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: MIN_STAKE });

      const tenure1 = await staking.getTenure(AGENT_ID);

      // Fast-forward 30 days
      await time.increase(30 * 24 * 60 * 60);

      const tenure2 = await staking.getTenure(AGENT_ID);
      expect(tenure2).to.be.greaterThan(tenure1);
      expect(tenure2).to.be.closeTo(30n * 24n * 60n * 60n, 10n);
    });

    it("should reset tenure on slash", async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: HIGH_STAKE });

      // Build up tenure
      await time.increase(60 * 24 * 60 * 60); // 60 days

      const tenureBefore = await staking.getTenure(AGENT_ID);
      expect(tenureBefore).to.be.closeTo(60n * 24n * 60n * 60n, 10n);

      // Slash resets tenure
      await staking.slash(AGENT_ID, 1000, "Minor offense", reporter.address);

      const tenureAfter = await staking.getTenure(AGENT_ID);
      expect(tenureAfter).to.be.lessThan(10n); // Near zero
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. DELEGATION REVENUE
  // ──────────────────────────────────────────────────────────────────────

  describe("Delegation Revenue", function () {
    const stakeAmount = ethers.parseEther("0.10");
    const delegateAmount = ethers.parseEther("0.05");
    const revenueAmount = ethers.parseEther("0.01");

    beforeEach(async function () {
      await staking.connect(publisher).stakeAgent(AGENT_ID, { value: stakeAmount });
      await staking.connect(curator).delegate(AGENT_ID, { value: delegateAmount });
    });

    it("should track delegator count", async function () {
      const count = await staking.getDelegatorCount(AGENT_ID);
      expect(count).to.equal(1);
    });

    it("should accept revenue deposit and distribute pro-rata", async function () {
      await staking.depositRevenue(AGENT_ID, { value: revenueAmount });

      // Curator has 100% of delegated stake, so gets all revenue
      const pending = await staking.getPendingRevenue(curator.address);
      expect(pending).to.equal(revenueAmount);
    });

    it("should distribute revenue pro-rata among multiple delegators", async function () {
      // Add a second delegator with equal amount
      await staking.connect(reporter).delegate(AGENT_ID, { value: delegateAmount });

      await staking.depositRevenue(AGENT_ID, { value: revenueAmount });

      // Each delegator has 50% of delegated stake
      const pending1 = await staking.getPendingRevenue(curator.address);
      const pending2 = await staking.getPendingRevenue(reporter.address);

      expect(pending1).to.equal(revenueAmount / 2n);
      expect(pending2).to.equal(revenueAmount / 2n);
    });

    it("should allow curator to claim revenue", async function () {
      await staking.depositRevenue(AGENT_ID, { value: revenueAmount });

      const balBefore = await ethers.provider.getBalance(curator.address);
      const tx = await staking.connect(curator).claimRevenue();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(curator.address);

      expect(balAfter - balBefore + gasCost).to.equal(revenueAmount);

      // Pending should be zero after claiming
      const pendingAfter = await staking.getPendingRevenue(curator.address);
      expect(pendingAfter).to.equal(0);
    });

    it("should reject claim when no revenue pending", async function () {
      await expect(
        staking.connect(other).claimRevenue()
      ).to.be.revertedWith("No revenue to claim");
    });

    it("should reject revenue deposit with no delegators", async function () {
      const newAgent = ethers.id("solo-agent");
      await staking.connect(publisher).stakeAgent(newAgent, { value: MIN_STAKE });

      await expect(
        staking.depositRevenue(newAgent, { value: revenueAmount })
      ).to.be.revertedWith("No delegators");
    });

    it("should emit RevenueDeposited event", async function () {
      await expect(staking.depositRevenue(AGENT_ID, { value: revenueAmount }))
        .to.emit(staking, "RevenueDeposited")
        .withArgs(AGENT_ID, revenueAmount, 1);
    });

    it("should emit RevenueClaimed event", async function () {
      await staking.depositRevenue(AGENT_ID, { value: revenueAmount });

      await expect(staking.connect(curator).claimRevenue())
        .to.emit(staking, "RevenueClaimed")
        .withArgs(curator.address, revenueAmount);
    });

    it("should accumulate revenue across multiple deposits", async function () {
      await staking.depositRevenue(AGENT_ID, { value: revenueAmount });
      await staking.depositRevenue(AGENT_ID, { value: revenueAmount });

      const pending = await staking.getPendingRevenue(curator.address);
      expect(pending).to.equal(revenueAmount * 2n);
    });
  });
});
