const { expect } = require("chai");

/**
 * Agent-to-Agent Feedback (Phase 5)
 *
 * Tests the agent feedback weighting, self-feedback prevention,
 * tag parsing, and scoring integration — all offline logic that
 * doesn't require contract deployment.
 *
 * We use dynamic import() to load ESM modules into CommonJS tests.
 */

describe("Agent-to-Agent Feedback (Phase 5)", function () {
  let agentWeighted;
  let agentFeedbackModule;
  let feedbackTypes;
  let reputationTiers;

  before(async function () {
    // Dynamic import for ESM modules
    agentWeighted = await import("../src/scoring/agent-weighted.js");
    agentFeedbackModule = await import("../src/feedback/agent-feedback.js");
    feedbackTypes = await import("../src/feedback/types.js");
    reputationTiers = await import("../src/scoring/reputation-tiers.js");
  });

  // Helper to create a mock Feedback object
  function makeFeedback(overrides = {}) {
    return {
      id: `fb-${Math.random().toString(36).slice(2)}`,
      agentId: "agent-target-1",
      clientAddress: "0xreviewer1",
      value: 75,
      valueDecimals: 0,
      tag1: undefined,
      tag2: undefined,
      endpoint: undefined,
      feedbackURI: undefined,
      feedbackHash: undefined,
      timestamp: Date.now(),
      revoked: false,
      ...overrides,
    };
  }

  // ─── Tag constants ────────────────────────────────────────────────────

  it("AGENT_REVIEW_TAG1 is 'agent-review'", function () {
    expect(feedbackTypes.AGENT_REVIEW_TAG1).to.equal("agent-review");
  });

  // ─── isAgentReview detection ──────────────────────────────────────────

  it("isAgentReview correctly identifies agent feedback via tag1", function () {
    expect(agentFeedbackModule.isAgentReview("agent-review")).to.be.true;
    expect(agentFeedbackModule.isAgentReview("user-review")).to.be.false;
    expect(agentFeedbackModule.isAgentReview(undefined)).to.be.false;
    expect(agentFeedbackModule.isAgentReview("")).to.be.false;
  });

  // ─── extractReviewerAgentId from tag2 ─────────────────────────────────

  it("extractReviewerAgentId parses agent ID from tag2", function () {
    expect(agentFeedbackModule.extractReviewerAgentId("42")).to.equal(42);
    expect(agentFeedbackModule.extractReviewerAgentId("0")).to.equal(0);
    expect(agentFeedbackModule.extractReviewerAgentId("999")).to.equal(999);
    expect(agentFeedbackModule.extractReviewerAgentId(undefined)).to.equal(-1);
    expect(agentFeedbackModule.extractReviewerAgentId("not-a-number")).to.equal(-1);
  });

  // ─── Agent review weight: unknown reviewer ────────────────────────────

  it("unknown reviewer gets 0.5x weight", function () {
    const result = agentWeighted.computeAgentReviewWeight("0xunknown");
    expect(result.weight).to.equal(0.5);
    expect(result.tier).to.equal("unknown");
  });

  // ─── Agent review weight: claw tier reviewer ──────────────────────────

  it("claw tier reviewer gets 1.0x weight", function () {
    // Create a claw-tier user
    reputationTiers.getOrCreateUser("0xclawuser");
    const result = agentWeighted.computeAgentReviewWeight("0xclawuser");
    expect(result.weight).to.equal(1.0);
    expect(result.tier).to.equal("claw");
  });

  // ─── Agent review weight: publisher gets 3x ───────────────────────────

  it("published-skill reviewer gets 3.0x weight", function () {
    reputationTiers.getOrCreateUser("0xpublisher");
    reputationTiers.markPublisher("0xpublisher");
    const result = agentWeighted.computeAgentReviewWeight("0xpublisher");
    expect(result.weight).to.equal(3.0);
    expect(result.tier).to.include("publisher");
  });

  // ─── Agent-weighted summary: human-only ───────────────────────────────

  it("computeAgentWeightedSummary with human-only feedback", function () {
    const feedback = [
      makeFeedback({ id: "h1", value: 80 }),
      makeFeedback({ id: "h2", value: 60 }),
      makeFeedback({ id: "h3", value: 70 }),
    ];
    const summary = agentWeighted.computeAgentWeightedSummary(feedback);
    // All human feedback → standard weight 1.0 → simple average = 70
    expect(summary.summaryValue).to.equal(70);
    expect(summary.feedbackCount).to.equal(3);
  });

  // ─── Agent-weighted summary: mixed human + agent ──────────────────────

  it("computeAgentWeightedSummary applies higher weight to agent reviews", function () {
    // Create a publisher reviewer (3x weight)
    reputationTiers.getOrCreateUser("0xagentreviewer");
    reputationTiers.markPublisher("0xagentreviewer");

    const feedback = [
      // Human feedback: value 60, weight 1.0
      makeFeedback({ id: "h1", value: 60, clientAddress: "0xhuman1" }),
      // Agent feedback from publisher: value 90, weight 3.0
      makeFeedback({
        id: "a1",
        value: 90,
        clientAddress: "0xagentreviewer",
        tag1: "agent-review",
        tag2: "42",
      }),
    ];

    const summary = agentWeighted.computeAgentWeightedSummary(feedback);

    // Weighted avg = (60*1.0 + 90*3.0) / (1.0 + 3.0) = (60+270)/4 = 330/4 = 82.5
    expect(summary.summaryValue).to.equal(82.5);
    expect(summary.feedbackCount).to.equal(2);
  });

  // ─── Revoked agent feedback excluded from scoring ─────────────────────

  it("revoked agent feedback is excluded from scoring", function () {
    const feedback = [
      makeFeedback({ id: "h1", value: 80 }),
      makeFeedback({
        id: "a-revoked",
        value: 10,
        tag1: "agent-review",
        tag2: "99",
        revoked: true,
      }),
    ];

    const summary = agentWeighted.computeAgentWeightedSummary(feedback);
    // Only the non-revoked feedback counts
    expect(summary.feedbackCount).to.equal(1);
    expect(summary.summaryValue).to.equal(80);
  });

  // ─── Agent feedback stats breakdown ───────────────────────────────────

  it("getAgentFeedbackStats breaks down human vs agent feedback", function () {
    const feedback = [
      makeFeedback({ id: "h1", value: 70, clientAddress: "0xhuman1" }),
      makeFeedback({ id: "h2", value: 80, clientAddress: "0xhuman2" }),
      makeFeedback({
        id: "a1",
        value: 90,
        clientAddress: "0xagent1",
        tag1: "agent-review",
        tag2: "10",
      }),
      makeFeedback({
        id: "a2",
        value: 85,
        clientAddress: "0xagent2",
        tag1: "agent-review",
        tag2: "20",
      }),
    ];

    const stats = agentWeighted.getAgentFeedbackStats(feedback);
    expect(stats.totalFeedback).to.equal(4);
    expect(stats.humanFeedbackCount).to.equal(2);
    expect(stats.agentFeedbackCount).to.equal(2);
    expect(stats.humanAvg).to.equal(75); // (70+80)/2
    expect(stats.agentAvg).to.equal(87.5); // (90+85)/2
    expect(stats.uniqueAgentReviewers).to.equal(2);
  });

  // ─── Empty feedback returns empty summary ─────────────────────────────

  it("empty feedback returns zero summary", function () {
    const summary = agentWeighted.computeAgentWeightedSummary([]);
    expect(summary.feedbackCount).to.equal(0);
    expect(summary.summaryValue).to.equal(0);
  });

  // ─── Default weight config values ─────────────────────────────────────

  it("default weight config has correct values", function () {
    const config = feedbackTypes.DEFAULT_AGENT_REVIEW_WEIGHTS;
    expect(config.whaleTierWeight).to.equal(5.0);
    expect(config.publishedAndStakedWeight).to.equal(3.0);
    expect(config.lobsterTierWeight).to.equal(2.0);
    expect(config.unknownAgentWeight).to.equal(0.5);
  });

  // ─── feedbackFile builder (offline) ───────────────────────────────────

  it("buildAgentFeedbackFile includes reviewer info and assessment", function () {
    const params = {
      targetAgentId: 1,
      reviewerAgentId: 2,
      value: 85,
      reviewerSkillUsed: "security-scanner",
      automatedAssessment: {
        securityScore: 90,
        reliabilityScore: 80,
        performanceScore: 85,
        summary: "Well-secured skill with good performance",
      },
    };

    const file = agentFeedbackModule.buildAgentFeedbackFile(params, "0xrevieweraddr");

    expect(file.reviewerAgentId).to.equal(2);
    expect(file.reviewerSkillUsed).to.equal("security-scanner");
    expect(file.automatedAssessment.securityScore).to.equal(90);
    expect(file.tag1).to.equal("agent-review");
    expect(file.tag2).to.equal("2");
    expect(file.value).to.equal(85);
    expect(file.clientAddress).to.include("0xrevieweraddr");
  });
});
