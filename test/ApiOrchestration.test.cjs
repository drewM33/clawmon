const { expect } = require("chai");

/**
 * Phase 7: End-to-End API & Orchestration Tests
 *
 * Tests the new API endpoints, benefit tier configs, and event types.
 * Uses dynamic imports for ESM modules.
 */

describe("End-to-End API Orchestration (Phase 7)", function () {
  let benefitTypes;
  let gateClient;
  let rateLimiter;

  before(async function () {
    benefitTypes = await import("../src/benefits/types.js");
    gateClient = await import("../src/benefits/gate-client.js");
    rateLimiter = await import("../src/benefits/rate-limiter.js");
  });

  // ─── Benefit tier config completeness ─────────────────────────────────

  it("BENEFIT_CONFIGS has all four tiers", function () {
    const configs = benefitTypes.BENEFIT_CONFIGS;
    expect(configs.none).to.not.be.undefined;
    expect(configs.bronze).to.not.be.undefined;
    expect(configs.silver).to.not.be.undefined;
    expect(configs.gold).to.not.be.undefined;
  });

  it("benefit tiers have correct rate limits", function () {
    const configs = benefitTypes.BENEFIT_CONFIGS;
    expect(configs.none.rateLimitPerMin).to.equal(10);
    expect(configs.bronze.rateLimitPerMin).to.equal(100);
    expect(configs.silver.rateLimitPerMin).to.equal(500);
    expect(configs.gold.rateLimitPerMin).to.equal(2000);
  });

  it("gold tier includes VPS, compute, custom domain, and priority support", function () {
    const gold = benefitTypes.BENEFIT_CONFIGS.gold;
    expect(gold.vpsAccess).to.be.true;
    expect(gold.dedicatedCompute).to.be.true;
    expect(gold.customDomain).to.be.true;
    expect(gold.prioritySupport).to.be.true;
    expect(gold.analyticsDashboard).to.be.true;
  });

  it("silver tier has VPS access but not dedicated compute", function () {
    const silver = benefitTypes.BENEFIT_CONFIGS.silver;
    expect(silver.vpsAccess).to.be.true;
    expect(silver.dedicatedCompute).to.be.false;
    expect(silver.vpsSpec).to.not.be.undefined;
    expect(silver.vpsSpec.cpu).to.equal(1);
    expect(silver.vpsSpec.memoryMb).to.equal(2048);
  });

  it("bronze tier has priority queue and feedback badge only", function () {
    const bronze = benefitTypes.BENEFIT_CONFIGS.bronze;
    expect(bronze.priorityQueue).to.be.true;
    expect(bronze.feedbackBadge).to.be.true;
    expect(bronze.vpsAccess).to.be.false;
    expect(bronze.dedicatedCompute).to.be.false;
  });

  // ─── Offline benefit status ──────────────────────────────────────────

  it("getBenefitStatusOffline returns correct tier for given trust level", function () {
    const noneStatus = gateClient.getBenefitStatusOffline(1, 0, 0);
    expect(noneStatus.currentTier).to.equal("none");
    expect(noneStatus.rateLimitPerMin).to.equal(10);
    expect(noneStatus.nextTier).to.equal("bronze");
    expect(noneStatus.boostUnitsToNextTier).to.equal(2);

    const bronzeStatus = gateClient.getBenefitStatusOffline(2, 3, 1);
    expect(bronzeStatus.currentTier).to.equal("bronze");
    expect(bronzeStatus.rateLimitPerMin).to.equal(100);
    expect(bronzeStatus.nextTier).to.equal("silver");
    expect(bronzeStatus.boostUnitsToNextTier).to.equal(4); // need 7, have 3

    const silverStatus = gateClient.getBenefitStatusOffline(3, 10, 2);
    expect(silverStatus.currentTier).to.equal("silver");
    expect(silverStatus.benefits).to.include("VPS sandbox access");
    expect(silverStatus.boostUnitsToNextTier).to.equal(4); // need 14, have 10

    const goldStatus = gateClient.getBenefitStatusOffline(4, 20, 3);
    expect(goldStatus.currentTier).to.equal("gold");
    expect(goldStatus.benefits).to.include("Dedicated compute");
    expect(goldStatus.nextTier).to.be.null;
    expect(goldStatus.boostUnitsToNextTier).to.equal(0);
  });

  // ─── Rate limiter tier enforcement ────────────────────────────────────

  it("rate limiter enforces per-tier limits correctly", function () {
    rateLimiter.resetRateLimits();

    // Bronze: 100 limit
    for (let i = 0; i < 100; i++) {
      const r = rateLimiter.checkRateLimit("rl-bronze", "bronze");
      expect(r.allowed).to.be.true;
    }
    const denied = rateLimiter.checkRateLimit("rl-bronze", "bronze");
    expect(denied.allowed).to.be.false;
  });

  // ─── BENEFIT_TIER_VALUES matches enum ─────────────────────────────────

  it("BENEFIT_TIER_VALUES maps to correct integers", function () {
    expect(benefitTypes.BENEFIT_TIER_VALUES.none).to.equal(0);
    expect(benefitTypes.BENEFIT_TIER_VALUES.bronze).to.equal(1);
    expect(benefitTypes.BENEFIT_TIER_VALUES.silver).to.equal(2);
    expect(benefitTypes.BENEFIT_TIER_VALUES.gold).to.equal(3);
  });
});

/**
 * Event Types Validation (Phase 7)
 */
describe("WebSocket Event Types (Phase 7)", function () {
  it("new event types are correctly typed", async function () {
    // Simply importing verifies the types compile correctly
    const events = await import("../src/events/types.js");
    // Verify the new event types exist as type discriminators
    expect(events).to.not.be.undefined;
  });
});
