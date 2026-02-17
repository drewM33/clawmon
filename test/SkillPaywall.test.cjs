/**
 * SkillPaywall — Comprehensive test suite (Phase 9)
 *
 * Covers:
 *   1. Skill registration and pricing
 *   2. Trust tier price multipliers
 *   3. Payment processing and fee distribution (80/10/10)
 *   4. Payment record tracking
 *   5. Access control and edge cases
 *   6. Admin functions (treasury/pool update)
 *   7. Aggregate statistics
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SkillPaywall", function () {
  let paywall;
  let owner, publisher1, publisher2, caller1, caller2, treasury, insurance;

  const AGENT_ID = ethers.id("gmail-integration");
  const AGENT_ID_2 = ethers.id("github-token");
  const AGENT_UNREGISTERED = ethers.id("nonexistent-skill");
  const BASE_PRICE = ethers.parseEther("0.001");      // 0.001 ETH
  const PREMIUM_TIER = 8;  // AAA
  const STANDARD_TIER = 5; // BBB
  const BUDGET_TIER = 0;   // C

  beforeEach(async function () {
    [owner, publisher1, publisher2, caller1, caller2, treasury, insurance] =
      await ethers.getSigners();

    const SkillPaywall = await ethers.getContractFactory("SkillPaywall");
    paywall = await SkillPaywall.deploy(treasury.address, insurance.address);
    await paywall.waitForDeployment();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. SKILL REGISTRATION
  // ──────────────────────────────────────────────────────────────────────

  describe("Skill Registration", function () {
    it("should register a skill with pricing", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);

      const pricing = await paywall.getSkillPricing(AGENT_ID);
      expect(pricing[0]).to.equal(BASE_PRICE);       // pricePerCall
      expect(pricing[1]).to.equal(STANDARD_TIER);     // trustTier
      expect(pricing[2]).to.be.true;                   // active
      expect(pricing[3]).to.equal(publisher1.address); // publisher
    });

    it("should reject duplicate registration", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);

      await expect(
        paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER)
      ).to.be.revertedWith("Already registered");
    });

    it("should reject zero address publisher", async function () {
      await expect(
        paywall.registerSkill(AGENT_ID, ethers.ZeroAddress, BASE_PRICE, STANDARD_TIER)
      ).to.be.revertedWith("Invalid publisher");
    });

    it("should reject price below minimum", async function () {
      const tinyPrice = ethers.parseEther("0.00001");
      await expect(
        paywall.registerSkill(AGENT_ID, publisher1.address, tinyPrice, STANDARD_TIER)
      ).to.be.revertedWith("Below min price");
    });

    it("should reject invalid tier (> 8)", async function () {
      await expect(
        paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, 9)
      ).to.be.revertedWith("Invalid tier");
    });

    it("should emit SkillRegistered event", async function () {
      await expect(
        paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER)
      )
        .to.emit(paywall, "SkillRegistered")
        .withArgs(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
    });

    it("should only allow owner to register", async function () {
      await expect(
        paywall.connect(caller1).registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER)
      ).to.be.revertedWith("Not owner");
    });

    it("should increment registered skill count", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
      await paywall.registerSkill(AGENT_ID_2, publisher2.address, BASE_PRICE, PREMIUM_TIER);

      const count = await paywall.getRegisteredSkillCount();
      expect(count).to.equal(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. TRUST TIER PRICE MULTIPLIERS
  // ──────────────────────────────────────────────────────────────────────

  describe("Tier Pricing", function () {
    it("should apply 2x multiplier for premium tiers (AAA/AA/A = 6-8)", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, PREMIUM_TIER);

      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(BASE_PRICE * 2n); // 2.0x
    });

    it("should apply 1x multiplier for standard tiers (BBB/BB/B = 3-5)", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);

      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(BASE_PRICE); // 1.0x
    });

    it("should apply 0.5x multiplier for budget tiers (CCC/CC/C = 0-2)", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, BUDGET_TIER);

      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(BASE_PRICE / 2n); // 0.5x
    });

    it("should correctly price tier 6 (A) as premium", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, 6);
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(BASE_PRICE * 2n);
    });

    it("should correctly price tier 3 (B) as standard", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, 3);
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(BASE_PRICE);
    });

    it("should correctly price tier 2 (CCC) as budget", async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, 2);
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(BASE_PRICE / 2n);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. PAYMENT PROCESSING
  // ──────────────────────────────────────────────────────────────────────

  describe("Payment Processing", function () {
    beforeEach(async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
    });

    it("should process a payment and distribute fees correctly", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      const publisherBefore = await ethers.provider.getBalance(publisher1.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      const insuranceBefore = await ethers.provider.getBalance(insurance.address);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });

      const publisherAfter = await ethers.provider.getBalance(publisher1.address);
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);
      const insuranceAfter = await ethers.provider.getBalance(insurance.address);

      // 80% to publisher
      const expectedPublisher = (effectivePrice * 8000n) / 10000n;
      expect(publisherAfter - publisherBefore).to.equal(expectedPublisher);

      // 10% to treasury
      const expectedTreasury = (effectivePrice * 1000n) / 10000n;
      expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasury);

      // 10% to insurance (remainder)
      const expectedInsurance = effectivePrice - expectedPublisher - expectedTreasury;
      expect(insuranceAfter - insuranceBefore).to.equal(expectedInsurance);
    });

    it("should reject payment below effective price", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      const tooLittle = effectivePrice - 1n;

      await expect(
        paywall.connect(caller1).payForSkill(AGENT_ID, { value: tooLittle })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("should reject payment for unregistered skill", async function () {
      await expect(
        paywall.connect(caller1).payForSkill(AGENT_UNREGISTERED, { value: BASE_PRICE })
      ).to.be.revertedWith("Skill not registered");
    });

    it("should accept overpayment and distribute full amount", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      const overpayment = effectivePrice * 2n;

      const publisherBefore = await ethers.provider.getBalance(publisher1.address);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: overpayment });

      const publisherAfter = await ethers.provider.getBalance(publisher1.address);
      const expectedPublisher = (overpayment * 8000n) / 10000n;
      expect(publisherAfter - publisherBefore).to.equal(expectedPublisher);
    });

    it("should emit PaymentProcessed event", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      const publisherPayout = (effectivePrice * 8000n) / 10000n;
      const protocolPayout = (effectivePrice * 1000n) / 10000n;
      const insurancePayout = effectivePrice - publisherPayout - protocolPayout;

      await expect(
        paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice })
      )
        .to.emit(paywall, "PaymentProcessed")
        .withArgs(
          0, // first payment ID
          AGENT_ID,
          caller1.address,
          effectivePrice,
          publisherPayout,
          protocolPayout,
          insurancePayout
        );
    });

    it("should increment payment counters correctly", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });
      await paywall.connect(caller2).payForSkill(AGENT_ID, { value: effectivePrice });

      const count = await paywall.getPaymentCount();
      expect(count).to.equal(2);

      const skillCount = await paywall.skillPaymentCount(AGENT_ID);
      expect(skillCount).to.equal(2);

      const caller1Count = await paywall.callerPaymentCount(caller1.address);
      expect(caller1Count).to.equal(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. PAYMENT RECORDS
  // ──────────────────────────────────────────────────────────────────────

  describe("Payment Records", function () {
    beforeEach(async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
    });

    it("should store payment record with correct fields", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });

      const payment = await paywall.getPayment(0);
      expect(payment.id).to.equal(0);
      expect(payment.agentId).to.equal(AGENT_ID);
      expect(payment.caller).to.equal(caller1.address);
      expect(payment.publisher).to.equal(publisher1.address);
      expect(payment.amount).to.equal(effectivePrice);
    });

    it("should track per-skill total revenue", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });
      await paywall.connect(caller2).payForSkill(AGENT_ID, { value: effectivePrice });

      const revenue = await paywall.skillTotalRevenue(AGENT_ID);
      expect(revenue).to.equal(effectivePrice * 2n);
    });

    it("should assign sequential payment IDs", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });
      await paywall.connect(caller2).payForSkill(AGENT_ID, { value: effectivePrice });

      const p0 = await paywall.getPayment(0);
      const p1 = await paywall.getPayment(1);
      expect(p0.id).to.equal(0);
      expect(p1.id).to.equal(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. PRICE UPDATES
  // ──────────────────────────────────────────────────────────────────────

  describe("Price Updates", function () {
    beforeEach(async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
    });

    it("should update skill pricing and tier", async function () {
      const newPrice = ethers.parseEther("0.002");
      await paywall.updateSkillPricing(AGENT_ID, newPrice, PREMIUM_TIER);

      const pricing = await paywall.getSkillPricing(AGENT_ID);
      expect(pricing.pricePerCall).to.equal(newPrice);
      expect(pricing.trustTier).to.equal(PREMIUM_TIER);

      // Effective price should now be 0.002 * 2 = 0.004
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      expect(effectivePrice).to.equal(newPrice * 2n);
    });

    it("should emit SkillPriceUpdated event", async function () {
      const newPrice = ethers.parseEther("0.002");
      await expect(
        paywall.updateSkillPricing(AGENT_ID, newPrice, PREMIUM_TIER)
      )
        .to.emit(paywall, "SkillPriceUpdated")
        .withArgs(AGENT_ID, BASE_PRICE, newPrice, PREMIUM_TIER);
    });

    it("should reject update for unregistered skill", async function () {
      await expect(
        paywall.updateSkillPricing(AGENT_UNREGISTERED, BASE_PRICE, STANDARD_TIER)
      ).to.be.revertedWith("Not registered");
    });

    it("should only allow owner to update pricing", async function () {
      await expect(
        paywall.connect(caller1).updateSkillPricing(AGENT_ID, BASE_PRICE, PREMIUM_TIER)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. ADMIN FUNCTIONS
  // ──────────────────────────────────────────────────────────────────────

  describe("Admin Functions", function () {
    it("should update protocol treasury address", async function () {
      await paywall.updateProtocolTreasury(caller1.address);
      expect(await paywall.protocolTreasury()).to.equal(caller1.address);
    });

    it("should update insurance pool address", async function () {
      await paywall.updateInsurancePool(caller1.address);
      expect(await paywall.insurancePool()).to.equal(caller1.address);
    });

    it("should reject zero address for treasury", async function () {
      await expect(
        paywall.updateProtocolTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid treasury");
    });

    it("should reject zero address for insurance pool", async function () {
      await expect(
        paywall.updateInsurancePool(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid pool");
    });

    it("should emit ProtocolTreasuryUpdated event", async function () {
      await expect(
        paywall.updateProtocolTreasury(caller1.address)
      )
        .to.emit(paywall, "ProtocolTreasuryUpdated")
        .withArgs(treasury.address, caller1.address);
    });

    it("should emit InsurancePoolUpdated event", async function () {
      await expect(
        paywall.updateInsurancePool(caller1.address)
      )
        .to.emit(paywall, "InsurancePoolUpdated")
        .withArgs(insurance.address, caller1.address);
    });

    it("should only allow owner to update treasury", async function () {
      await expect(
        paywall.connect(caller1).updateProtocolTreasury(caller2.address)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. AGGREGATE STATISTICS
  // ──────────────────────────────────────────────────────────────────────

  describe("Aggregate Statistics", function () {
    beforeEach(async function () {
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
      await paywall.registerSkill(AGENT_ID_2, publisher2.address, BASE_PRICE, PREMIUM_TIER);
    });

    it("should track aggregate payment stats", async function () {
      const price1 = await paywall.getEffectivePrice(AGENT_ID);
      const price2 = await paywall.getEffectivePrice(AGENT_ID_2);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: price1 });
      await paywall.connect(caller2).payForSkill(AGENT_ID_2, { value: price2 });
      await paywall.connect(caller1).payForSkill(AGENT_ID_2, { value: price2 });

      const stats = await paywall.getPaymentStats();
      expect(stats._totalPayments).to.equal(3);
      expect(stats._registeredSkillCount).to.equal(2);

      // Total protocol revenue = 10% of each payment
      const expectedProtocol =
        (price1 * 1000n) / 10000n +
        (price2 * 1000n) / 10000n * 2n;
      expect(stats._totalProtocolRevenue).to.equal(expectedProtocol);
    });

    it("should track per-skill revenue independently", async function () {
      const price1 = await paywall.getEffectivePrice(AGENT_ID);
      const price2 = await paywall.getEffectivePrice(AGENT_ID_2);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: price1 });
      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: price1 });
      await paywall.connect(caller2).payForSkill(AGENT_ID_2, { value: price2 });

      const revenue1 = await paywall.skillTotalRevenue(AGENT_ID);
      const revenue2 = await paywall.skillTotalRevenue(AGENT_ID_2);

      expect(revenue1).to.equal(price1 * 2n);
      expect(revenue2).to.equal(price2);
    });

    it("should track per-caller payment count", async function () {
      const price1 = await paywall.getEffectivePrice(AGENT_ID);
      const price2 = await paywall.getEffectivePrice(AGENT_ID_2);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: price1 });
      await paywall.connect(caller1).payForSkill(AGENT_ID_2, { value: price2 });
      await paywall.connect(caller2).payForSkill(AGENT_ID, { value: price1 });

      const count1 = await paywall.callerPaymentCount(caller1.address);
      const count2 = await paywall.callerPaymentCount(caller2.address);

      expect(count1).to.equal(2);
      expect(count2).to.equal(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. MULTI-TIER PAYMENT SCENARIOS
  // ──────────────────────────────────────────────────────────────────────

  describe("Multi-Tier Scenarios", function () {
    it("should charge different effective prices for different tiers", async function () {
      const AGENT_PREMIUM = ethers.id("premium-skill");
      const AGENT_STANDARD = ethers.id("standard-skill");
      const AGENT_BUDGET = ethers.id("budget-skill");

      await paywall.registerSkill(AGENT_PREMIUM, publisher1.address, BASE_PRICE, PREMIUM_TIER);
      await paywall.registerSkill(AGENT_STANDARD, publisher1.address, BASE_PRICE, STANDARD_TIER);
      await paywall.registerSkill(AGENT_BUDGET, publisher1.address, BASE_PRICE, BUDGET_TIER);

      const pricePremium = await paywall.getEffectivePrice(AGENT_PREMIUM);
      const priceStandard = await paywall.getEffectivePrice(AGENT_STANDARD);
      const priceBudget = await paywall.getEffectivePrice(AGENT_BUDGET);

      // Premium = 2x, Standard = 1x, Budget = 0.5x
      expect(pricePremium).to.equal(BASE_PRICE * 2n);
      expect(priceStandard).to.equal(BASE_PRICE);
      expect(priceBudget).to.equal(BASE_PRICE / 2n);

      // Premium should be 4x budget
      expect(pricePremium).to.equal(priceBudget * 4n);
    });

    it("should process payments across multiple skills and tiers", async function () {
      const AGENT_P = ethers.id("premium-test");
      const AGENT_B = ethers.id("budget-test");

      await paywall.registerSkill(AGENT_P, publisher1.address, BASE_PRICE, PREMIUM_TIER);
      await paywall.registerSkill(AGENT_B, publisher2.address, BASE_PRICE, BUDGET_TIER);

      const priceP = await paywall.getEffectivePrice(AGENT_P);
      const priceB = await paywall.getEffectivePrice(AGENT_B);

      await paywall.connect(caller1).payForSkill(AGENT_P, { value: priceP });
      await paywall.connect(caller2).payForSkill(AGENT_B, { value: priceB });

      const stats = await paywall.getPaymentStats();
      expect(stats._totalPayments).to.equal(2);

      // Total revenue = premium price + budget price
      const totalExpected = priceP + priceB;
      const totalActual =
        stats._totalPublisherPayouts +
        stats._totalProtocolRevenue +
        stats._totalInsuranceContributions;
      expect(totalActual).to.equal(totalExpected);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 9. TENURE-BASED FEE DISCOUNTS
  // ──────────────────────────────────────────────────────────────────────

  describe("Tenure Fee Discounts", function () {
    let staking;

    beforeEach(async function () {
      // Deploy TrustStaking and wire it to SkillPaywall
      const TrustStaking = await ethers.getContractFactory("TrustStaking");
      staking = await TrustStaking.deploy(insurance.address, treasury.address);
      await staking.waitForDeployment();

      await paywall.setTrustStaking(await staking.getAddress());
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);
    });

    it("should give no discount when agent is not staked", async function () {
      const split = await paywall.getEffectiveSplit(AGENT_ID);
      expect(split.publisherBps).to.equal(8000n);
      expect(split.protocolBps).to.equal(1000n);
      expect(split.insuranceBps).to.equal(1000n);
      expect(split.tenureDiscount).to.equal(0n);
    });

    it("should give no discount immediately after staking", async function () {
      await staking.connect(publisher1).stakeAgent(AGENT_ID, { value: ethers.parseEther("0.10") });

      const split = await paywall.getEffectiveSplit(AGENT_ID);
      // Tenure is near zero, so discount should be very small
      expect(split.tenureDiscount).to.be.lessThan(10n);
    });

    it("should give partial discount at half tenure target", async function () {
      await staking.connect(publisher1).stakeAgent(AGENT_ID, { value: ethers.parseEther("0.10") });

      // Advance 45 days (half of 90-day target)
      await time.increase(45 * 24 * 60 * 60);

      const split = await paywall.getEffectiveSplit(AGENT_ID);
      // Should be approximately 500 bps (half of max 1000)
      expect(split.tenureDiscount).to.be.closeTo(500n, 20n);
      expect(split.publisherBps).to.be.closeTo(8500n, 20n);
      expect(split.protocolBps).to.be.closeTo(500n, 20n);
    });

    it("should give full discount at or after tenure target", async function () {
      await staking.connect(publisher1).stakeAgent(AGENT_ID, { value: ethers.parseEther("0.10") });

      // Advance 90 days (full tenure)
      await time.increase(90 * 24 * 60 * 60);

      const split = await paywall.getEffectiveSplit(AGENT_ID);
      expect(split.tenureDiscount).to.equal(1000n);
      expect(split.publisherBps).to.equal(9000n);
      expect(split.protocolBps).to.equal(0n);
      expect(split.insuranceBps).to.equal(1000n);
    });

    it("should shift protocol fee to publisher in actual payments", async function () {
      await staking.connect(publisher1).stakeAgent(AGENT_ID, { value: ethers.parseEther("0.10") });

      // Advance to full tenure
      await time.increase(90 * 24 * 60 * 60);

      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      const publisherBefore = await ethers.provider.getBalance(publisher1.address);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });

      const publisherAfter = await ethers.provider.getBalance(publisher1.address);
      // With full tenure discount: publisher gets 90% instead of 80%
      const expectedPublisher = (effectivePrice * 9000n) / 10000n;
      expect(publisherAfter - publisherBefore).to.equal(expectedPublisher);
    });

    it("should reset discount after slash resets tenure", async function () {
      await staking.connect(publisher1).stakeAgent(AGENT_ID, { value: ethers.parseEther("0.25") });

      // Build up full tenure
      await time.increase(90 * 24 * 60 * 60);

      const splitBefore = await paywall.getEffectiveSplit(AGENT_ID);
      expect(splitBefore.tenureDiscount).to.equal(1000n);

      // Slash resets tenure
      await staking.slash(AGENT_ID, 1000, "Minor issue", caller1.address);

      const splitAfter = await paywall.getEffectiveSplit(AGENT_ID);
      expect(splitAfter.tenureDiscount).to.be.lessThan(10n);
    });

    it("should emit TrustStakingUpdated when setting staking reference", async function () {
      const newStaking = caller2.address;
      await expect(paywall.setTrustStaking(newStaking))
        .to.emit(paywall, "TrustStakingUpdated");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 10. DELEGATION REVENUE SHARE
  // ──────────────────────────────────────────────────────────────────────

  describe("Delegation Revenue Share", function () {
    let staking;
    const stakeAmount = ethers.parseEther("0.10");
    const delegateAmount = ethers.parseEther("0.05");

    beforeEach(async function () {
      const TrustStaking = await ethers.getContractFactory("TrustStaking");
      staking = await TrustStaking.deploy(insurance.address, treasury.address);
      await staking.waitForDeployment();

      await paywall.setTrustStaking(await staking.getAddress());
      await paywall.registerSkill(AGENT_ID, publisher1.address, BASE_PRICE, STANDARD_TIER);

      // Stake and delegate
      await staking.connect(publisher1).stakeAgent(AGENT_ID, { value: stakeAmount });
      await staking.connect(caller2).delegate(AGENT_ID, { value: delegateAmount });
    });

    it("should send delegator revenue to TrustStaking vault on payment", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });

      // Delegator should have pending revenue
      const pending = await staking.getPendingRevenue(caller2.address);
      expect(pending).to.be.greaterThan(0);
    });

    it("should compute correct delegator share", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);

      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });

      // Total stake = 0.10 + 0.05 = 0.15 ETH
      // Delegated ratio = 0.05 / 0.15 = 1/3
      // Publisher payout ≈ 80% of effectivePrice (with tenure discount near zero)
      // Delegator pool = publisherPayout * (1/3) * (2000/10000)
      const pending = await staking.getPendingRevenue(caller2.address);
      const publisherPayout = (effectivePrice * 8000n) / 10000n;
      const expectedDelegatorPool = (publisherPayout * delegateAmount * 2000n) / (
        (stakeAmount + delegateAmount) * 10000n
      );
      expect(pending).to.be.closeTo(expectedDelegatorPool, 100n);
    });

    it("should send no delegator revenue when no delegators exist", async function () {
      // Register a new skill with no delegation
      const AGENT_SOLO = ethers.id("solo-skill");
      await paywall.registerSkill(AGENT_SOLO, publisher2.address, BASE_PRICE, STANDARD_TIER);
      await staking.connect(publisher2).stakeAgent(AGENT_SOLO, { value: stakeAmount });

      const effectivePrice = await paywall.getEffectivePrice(AGENT_SOLO);
      const publisherBefore = await ethers.provider.getBalance(publisher2.address);

      await paywall.connect(caller1).payForSkill(AGENT_SOLO, { value: effectivePrice });

      const publisherAfter = await ethers.provider.getBalance(publisher2.address);
      // Publisher gets full publisher share (no delegator carve-out)
      const expectedPublisher = (effectivePrice * 8000n) / 10000n;
      expect(publisherAfter - publisherBefore).to.equal(expectedPublisher);
    });

    it("should allow delegator to claim revenue after payment", async function () {
      const effectivePrice = await paywall.getEffectivePrice(AGENT_ID);
      await paywall.connect(caller1).payForSkill(AGENT_ID, { value: effectivePrice });

      const pending = await staking.getPendingRevenue(caller2.address);
      expect(pending).to.be.greaterThan(0);

      const balBefore = await ethers.provider.getBalance(caller2.address);
      const tx = await staking.connect(caller2).claimRevenue();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(caller2.address);

      expect(balAfter - balBefore + gasCost).to.equal(pending);
    });
  });
});
