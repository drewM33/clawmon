/**
 * Trusted ClawMon — AttestationRegistry Contract Tests (Phase 5)
 *
 * Full attestation lifecycle coverage:
 *   1. Deployment & initial state
 *   2. Single attestation publish
 *   3. Batch attestation publish
 *   4. Attestation reads & verification functions
 *   5. Freshness window enforcement
 *   6. Attestation revocation
 *   7. Access control (only attester can publish)
 *   8. Score & tier threshold verification
 *   9. Enumeration
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AttestationRegistry", function () {
  let registry;
  let owner, attester, consumer, other;

  // Test agent IDs (keccak256 hashes of string agent names)
  const AGENT_1 = ethers.id("gmail-integration");
  const AGENT_2 = ethers.id("github-token");
  const AGENT_3 = ethers.id("deep-research-agent");
  const AGENT_MALICIOUS = ethers.id("what-would-elon-do");

  // Tier constants
  const TIER_C = 0;
  const TIER_A = 6;
  const TIER_AA = 7;
  const TIER_AAA = 8;

  const SOURCE_CHAIN = "monad-testnet";

  beforeEach(async function () {
    [owner, attester, consumer, other] = await ethers.getSigners();

    const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
    registry = await AttestationRegistry.deploy(attester.address);
    await registry.waitForDeployment();
  });

  // ── 1. Deployment & Initial State ────────────────────────────────────

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("should set the correct attester", async function () {
      expect(await registry.attester()).to.equal(attester.address);
    });

    it("should start with zero attestations", async function () {
      expect(await registry.totalAttestations()).to.equal(0);
      expect(await registry.getAttestedAgentCount()).to.equal(0);
    });

    it("should report FRESHNESS_WINDOW as 24 hours", async function () {
      expect(await registry.FRESHNESS_WINDOW()).to.equal(86400);
    });
  });

  // ── 2. Single Attestation Publish ────────────────────────────────────

  describe("publishAttestation", function () {
    it("should publish a valid attestation", async function () {
      const now = Math.floor(Date.now() / 1000);

      await expect(
        registry.connect(attester).publishAttestation(
          AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
        )
      ).to.emit(registry, "AttestationPublished")
        .withArgs(AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN);

      expect(await registry.totalAttestations()).to.equal(1);
      expect(await registry.getAttestedAgentCount()).to.equal(1);
    });

    it("should store attestation data correctly", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 92, TIER_AAA, 100, now, SOURCE_CHAIN
      );

      const a = await registry.getAttestation(AGENT_1);
      expect(a.score).to.equal(92);
      expect(a.tier).to.equal(TIER_AAA);
      expect(a.feedbackCount).to.equal(100);
      expect(a.sourceTimestamp).to.equal(now);
      expect(a.sourceChain).to.equal(SOURCE_CHAIN);
      expect(a.revoked).to.equal(false);
      expect(a.isFresh).to.equal(true);
    });

    it("should update an existing attestation (overwrite)", async function () {
      const now = Math.floor(Date.now() / 1000);

      await registry.connect(attester).publishAttestation(
        AGENT_1, 60, 5, 20, now, SOURCE_CHAIN
      );
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 50, now + 3600, SOURCE_CHAIN
      );

      const a = await registry.getAttestation(AGENT_1);
      expect(a.score).to.equal(85);
      expect(a.tier).to.equal(TIER_AA);
      expect(a.feedbackCount).to.equal(50);

      // Agent count should still be 1 (same agent)
      expect(await registry.getAttestedAgentCount()).to.equal(1);
      // But attestation count for this agent should be 2
      expect(await registry.attestationCount(AGENT_1)).to.equal(2);
    });

    it("should reject score > 100", async function () {
      await expect(
        registry.connect(attester).publishAttestation(
          AGENT_1, 101, TIER_AAA, 10, 0, SOURCE_CHAIN
        )
      ).to.be.revertedWith("Score must be 0-100");
    });

    it("should reject invalid tier > 8", async function () {
      await expect(
        registry.connect(attester).publishAttestation(
          AGENT_1, 80, 9, 10, 0, SOURCE_CHAIN
        )
      ).to.be.revertedWith("Invalid tier");
    });

    it("should reject empty agent ID", async function () {
      await expect(
        registry.connect(attester).publishAttestation(
          ethers.ZeroHash, 80, TIER_AA, 10, 0, SOURCE_CHAIN
        )
      ).to.be.revertedWith("Empty agent ID");
    });

    it("should reject non-attester caller", async function () {
      await expect(
        registry.connect(other).publishAttestation(
          AGENT_1, 80, TIER_AA, 10, 0, SOURCE_CHAIN
        )
      ).to.be.revertedWith("Not authorized attester");
    });
  });

  // ── 3. Batch Attestation ─────────────────────────────────────────────

  describe("batchPublishAttestations", function () {
    it("should publish multiple attestations in one tx", async function () {
      const now = Math.floor(Date.now() / 1000);

      const agentIds = [AGENT_1, AGENT_2, AGENT_3];
      const scores = [85, 72, 95];
      const tiers = [TIER_AA, TIER_A, TIER_AAA];
      const feedbackCounts = [42, 28, 105];
      const timestamps = [now, now, now];

      await expect(
        registry.connect(attester).batchPublishAttestations(
          agentIds, scores, tiers, feedbackCounts, timestamps, SOURCE_CHAIN
        )
      ).to.emit(registry, "BatchAttestationPublished")
        .withArgs(3);

      expect(await registry.getAttestedAgentCount()).to.equal(3);

      // Verify each attestation
      const a1 = await registry.getAttestation(AGENT_1);
      expect(a1.score).to.equal(85);
      const a2 = await registry.getAttestation(AGENT_2);
      expect(a2.score).to.equal(72);
      const a3 = await registry.getAttestation(AGENT_3);
      expect(a3.score).to.equal(95);
    });

    it("should reject mismatched array lengths", async function () {
      await expect(
        registry.connect(attester).batchPublishAttestations(
          [AGENT_1, AGENT_2], [85], [TIER_AA, TIER_A], [42, 28], [0, 0], SOURCE_CHAIN
        )
      ).to.be.revertedWith("Array length mismatch");
    });

    it("should reject empty batch", async function () {
      await expect(
        registry.connect(attester).batchPublishAttestations(
          [], [], [], [], [], SOURCE_CHAIN
        )
      ).to.be.revertedWith("Empty batch");
    });
  });

  // ── 4. Verification Functions ────────────────────────────────────────

  describe("Verification", function () {
    beforeEach(async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );
    });

    it("isAttested should return true for freshly attested agent", async function () {
      expect(await registry.isAttested(AGENT_1)).to.equal(true);
    });

    it("isAttested should return false for non-attested agent", async function () {
      expect(await registry.isAttested(AGENT_2)).to.equal(false);
    });

    it("verifyMinScore should pass for score >= threshold", async function () {
      expect(await registry.verifyMinScore(AGENT_1, 80)).to.equal(true);
      expect(await registry.verifyMinScore(AGENT_1, 85)).to.equal(true);
    });

    it("verifyMinScore should fail for score < threshold", async function () {
      expect(await registry.verifyMinScore(AGENT_1, 90)).to.equal(false);
    });

    it("verifyMinTier should pass for tier >= threshold", async function () {
      expect(await registry.verifyMinTier(AGENT_1, TIER_A)).to.equal(true);
      expect(await registry.verifyMinTier(AGENT_1, TIER_AA)).to.equal(true);
    });

    it("verifyMinTier should fail for tier < threshold", async function () {
      expect(await registry.verifyMinTier(AGENT_1, TIER_AAA)).to.equal(false);
    });

    it("getAttestationAge should return small value for recent attestation", async function () {
      const age = await registry.getAttestationAge(AGENT_1);
      expect(age).to.be.lessThan(60); // should be within seconds of publish
    });

    it("getAttestationAge should return max uint64 for non-attested agent", async function () {
      const age = await registry.getAttestationAge(AGENT_2);
      expect(age).to.equal(BigInt("18446744073709551615")); // type(uint64).max
    });
  });

  // ── 5. Freshness Window ──────────────────────────────────────────────

  describe("Freshness Window", function () {
    it("should mark attestation as stale after 24 hours", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );

      // Initially fresh
      expect(await registry.isAttested(AGENT_1)).to.equal(true);

      // Advance time by 25 hours
      await ethers.provider.send("evm_increaseTime", [90000]);
      await ethers.provider.send("evm_mine", []);

      // Now stale
      expect(await registry.isAttested(AGENT_1)).to.equal(false);

      // But attestation data is still readable
      const a = await registry.getAttestation(AGENT_1);
      expect(a.score).to.equal(85);
      expect(a.isFresh).to.equal(false);
    });

    it("verifyMinScore should fail for stale attestation", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );

      await ethers.provider.send("evm_increaseTime", [90000]);
      await ethers.provider.send("evm_mine", []);

      expect(await registry.verifyMinScore(AGENT_1, 80)).to.equal(false);
    });

    it("re-attestation should refresh the window", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );

      await ethers.provider.send("evm_increaseTime", [90000]);
      await ethers.provider.send("evm_mine", []);
      expect(await registry.isAttested(AGENT_1)).to.equal(false);

      // Re-attest
      await registry.connect(attester).publishAttestation(
        AGENT_1, 88, TIER_AA, 50, now + 90000, SOURCE_CHAIN
      );
      expect(await registry.isAttested(AGENT_1)).to.equal(true);

      const a = await registry.getAttestation(AGENT_1);
      expect(a.score).to.equal(88);
      expect(a.isFresh).to.equal(true);
    });
  });

  // ── 6. Revocation ────────────────────────────────────────────────────

  describe("Revocation", function () {
    beforeEach(async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_MALICIOUS, 45, 3, 15, now, SOURCE_CHAIN
      );
    });

    it("should revoke an attestation", async function () {
      await expect(
        registry.connect(attester).revokeAttestation(AGENT_MALICIOUS, "Confirmed malware")
      ).to.emit(registry, "AttestationRevoked")
        .withArgs(AGENT_MALICIOUS, "Confirmed malware");

      const a = await registry.getAttestation(AGENT_MALICIOUS);
      expect(a.revoked).to.equal(true);
      expect(a.isFresh).to.equal(false);
    });

    it("isAttested should return false for revoked attestation", async function () {
      await registry.connect(attester).revokeAttestation(AGENT_MALICIOUS, "Malware");
      expect(await registry.isAttested(AGENT_MALICIOUS)).to.equal(false);
    });

    it("verifyMinScore should fail for revoked attestation", async function () {
      await registry.connect(attester).revokeAttestation(AGENT_MALICIOUS, "Malware");
      expect(await registry.verifyMinScore(AGENT_MALICIOUS, 0)).to.equal(false);
    });

    it("should reject revoking non-attested agent", async function () {
      await expect(
        registry.connect(attester).revokeAttestation(AGENT_1, "reason")
      ).to.be.revertedWith("Agent not attested");
    });

    it("should reject double revocation", async function () {
      await registry.connect(attester).revokeAttestation(AGENT_MALICIOUS, "Malware");
      await expect(
        registry.connect(attester).revokeAttestation(AGENT_MALICIOUS, "Malware again")
      ).to.be.revertedWith("Already revoked");
    });
  });

  // ── 7. Access Control ────────────────────────────────────────────────

  describe("Access Control", function () {
    it("only attester can publish", async function () {
      await expect(
        registry.connect(consumer).publishAttestation(
          AGENT_1, 80, TIER_AA, 10, 0, SOURCE_CHAIN
        )
      ).to.be.revertedWith("Not authorized attester");
    });

    it("only attester can revoke", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 80, TIER_AA, 10, now, SOURCE_CHAIN
      );

      await expect(
        registry.connect(consumer).revokeAttestation(AGENT_1, "reason")
      ).to.be.revertedWith("Not authorized attester");
    });

    it("only attester can batch publish", async function () {
      await expect(
        registry.connect(consumer).batchPublishAttestations(
          [AGENT_1], [80], [TIER_AA], [10], [0], SOURCE_CHAIN
        )
      ).to.be.revertedWith("Not authorized attester");
    });

    it("owner can update attester", async function () {
      await expect(
        registry.connect(owner).setAttester(other.address)
      ).to.emit(registry, "AttesterUpdated")
        .withArgs(attester.address, other.address);

      expect(await registry.attester()).to.equal(other.address);

      // Old attester can no longer publish
      await expect(
        registry.connect(attester).publishAttestation(
          AGENT_1, 80, TIER_AA, 10, 0, SOURCE_CHAIN
        )
      ).to.be.revertedWith("Not authorized attester");

      // New attester can publish
      await registry.connect(other).publishAttestation(
        AGENT_1, 80, TIER_AA, 10, 0, SOURCE_CHAIN
      );
    });

    it("non-owner cannot update attester", async function () {
      await expect(
        registry.connect(other).setAttester(other.address)
      ).to.be.revertedWith("Not owner");
    });

    it("owner can transfer ownership", async function () {
      await registry.connect(owner).transferOwnership(other.address);
      expect(await registry.owner()).to.equal(other.address);
    });
  });

  // ── 8. Enumeration ───────────────────────────────────────────────────

  describe("Enumeration", function () {
    it("should enumerate all attested agents", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );
      await registry.connect(attester).publishAttestation(
        AGENT_2, 72, TIER_A, 28, now, SOURCE_CHAIN
      );

      expect(await registry.getAttestedAgentCount()).to.equal(2);
      expect(await registry.getAttestedAgent(0)).to.equal(AGENT_1);
      expect(await registry.getAttestedAgent(1)).to.equal(AGENT_2);
    });

    it("should not duplicate agent in list on re-attestation", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );
      await registry.connect(attester).publishAttestation(
        AGENT_1, 90, TIER_AAA, 50, now + 60, SOURCE_CHAIN
      );

      expect(await registry.getAttestedAgentCount()).to.equal(1);
    });

    it("should track attestation count per agent", async function () {
      const now = Math.floor(Date.now() / 1000);
      await registry.connect(attester).publishAttestation(
        AGENT_1, 85, TIER_AA, 42, now, SOURCE_CHAIN
      );
      await registry.connect(attester).publishAttestation(
        AGENT_1, 88, TIER_AA, 45, now + 60, SOURCE_CHAIN
      );
      await registry.connect(attester).publishAttestation(
        AGENT_1, 90, TIER_AAA, 50, now + 120, SOURCE_CHAIN
      );

      expect(await registry.attestationCount(AGENT_1)).to.equal(3);
    });
  });

  // ── 9. Full Lifecycle ────────────────────────────────────────────────

  describe("Full Attestation Lifecycle", function () {
    it("should handle the complete lifecycle: publish → verify → update → stale → refresh → revoke", async function () {
      const now = Math.floor(Date.now() / 1000);

      // 1. Publish initial attestation
      await registry.connect(attester).publishAttestation(
        AGENT_1, 75, TIER_A, 30, now, SOURCE_CHAIN
      );
      expect(await registry.isAttested(AGENT_1)).to.equal(true);
      expect(await registry.verifyMinScore(AGENT_1, 70)).to.equal(true);

      // 2. Update score (agent improved)
      await registry.connect(attester).publishAttestation(
        AGENT_1, 88, TIER_AA, 55, now + 3600, SOURCE_CHAIN
      );
      expect(await registry.verifyMinScore(AGENT_1, 85)).to.equal(true);
      expect(await registry.verifyMinTier(AGENT_1, TIER_AA)).to.equal(true);

      // 3. Time passes — attestation goes stale
      await ethers.provider.send("evm_increaseTime", [90000]);
      await ethers.provider.send("evm_mine", []);
      expect(await registry.isAttested(AGENT_1)).to.equal(false);

      // 4. Bridge refreshes attestation
      await registry.connect(attester).publishAttestation(
        AGENT_1, 90, TIER_AAA, 70, now + 100000, SOURCE_CHAIN
      );
      expect(await registry.isAttested(AGENT_1)).to.equal(true);
      expect(await registry.verifyMinTier(AGENT_1, TIER_AAA)).to.equal(true);

      // 5. Agent discovered malicious — revoke
      await registry.connect(attester).revokeAttestation(AGENT_1, "Malicious behavior detected");
      expect(await registry.isAttested(AGENT_1)).to.equal(false);
      expect(await registry.verifyMinScore(AGENT_1, 0)).to.equal(false);

      // Data is still readable for historical reference
      const a = await registry.getAttestation(AGENT_1);
      expect(a.score).to.equal(90);
      expect(a.revoked).to.equal(true);

      // Attestation count reflects all updates
      expect(await registry.attestationCount(AGENT_1)).to.equal(3);
    });
  });
});
