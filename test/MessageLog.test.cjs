/**
 * Trusted ClawMon — MessageLog Contract Tests
 *
 * Coverage:
 *   1. Deployment & initial state
 *   2. Message submission (Identity + Feedback topics)
 *   3. Message reading (single + batch)
 *   4. Sequence numbering
 *   5. Payload size limits
 *   6. Topic memos
 *   7. Owner-only access control
 *   8. Edge cases (empty payload, out-of-range reads, large batches)
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MessageLog", function () {
  let messageLog;
  let owner, alice, bob;

  // Topic enum values
  const TOPIC_IDENTITY = 0;
  const TOPIC_FEEDBACK = 1;

  // Sample JSON payloads
  const IDENTITY_MSG = JSON.stringify({
    type: "register",
    agentId: "gmail-integration",
    name: "Gmail Integration",
    publisher: "0x1234",
    category: "productivity",
    timestamp: 1700000000000,
  });

  const FEEDBACK_MSG = JSON.stringify({
    type: "feedback",
    agentId: "gmail-integration",
    clientAddress: "reviewer-0001",
    value: 85,
    tag1: "reliability",
    timestamp: 1700000001000,
  });

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const MessageLog = await ethers.getContractFactory("MessageLog");
    messageLog = await MessageLog.deploy();
    await messageLog.waitForDeployment();
  });

  // ── Deployment ──────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the deployer as owner", async function () {
      expect(await messageLog.owner()).to.equal(owner.address);
    });

    it("should initialize topic message counts to 0", async function () {
      expect(await messageLog.getMessageCount(TOPIC_IDENTITY)).to.equal(0);
      expect(await messageLog.getMessageCount(TOPIC_FEEDBACK)).to.equal(0);
    });

    it("should set default topic memos", async function () {
      const identityMemo = await messageLog.getTopicMemo(TOPIC_IDENTITY);
      expect(identityMemo).to.include("Identity");

      const feedbackMemo = await messageLog.getTopicMemo(TOPIC_FEEDBACK);
      expect(feedbackMemo).to.include("Feedback");
    });
  });

  // ── Message Submission ──────────────────────────────────────────────

  describe("submitMessage", function () {
    it("should submit a message to the Identity topic", async function () {
      const tx = await messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG);
      const receipt = await tx.wait();

      expect(await messageLog.getMessageCount(TOPIC_IDENTITY)).to.equal(1);

      // Check return value via reading
      const msg = await messageLog.getMessage(TOPIC_IDENTITY, 1);
      expect(msg.payload).to.equal(IDENTITY_MSG);
      expect(msg.sender).to.equal(owner.address);
      expect(msg.sequenceNumber).to.equal(1);
    });

    it("should submit a message to the Feedback topic", async function () {
      await messageLog.submitMessage(TOPIC_FEEDBACK, FEEDBACK_MSG);

      expect(await messageLog.getMessageCount(TOPIC_FEEDBACK)).to.equal(1);

      const msg = await messageLog.getMessage(TOPIC_FEEDBACK, 1);
      expect(msg.payload).to.equal(FEEDBACK_MSG);
    });

    it("should emit MessageSubmitted event", async function () {
      await expect(messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG))
        .to.emit(messageLog, "MessageSubmitted")
        .withArgs(
          TOPIC_IDENTITY,
          1,
          owner.address,
          (ts) => ts > 0, // any positive timestamp
          IDENTITY_MSG,
        );
    });

    it("should increment sequence numbers independently per topic", async function () {
      await messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG);
      await messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG);
      await messageLog.submitMessage(TOPIC_FEEDBACK, FEEDBACK_MSG);

      expect(await messageLog.getMessageCount(TOPIC_IDENTITY)).to.equal(2);
      expect(await messageLog.getMessageCount(TOPIC_FEEDBACK)).to.equal(1);
    });

    it("should allow different senders", async function () {
      await messageLog.connect(alice).submitMessage(TOPIC_FEEDBACK, FEEDBACK_MSG);

      const msg = await messageLog.getMessage(TOPIC_FEEDBACK, 1);
      expect(msg.sender).to.equal(alice.address);
    });

    it("should reject empty payload", async function () {
      await expect(
        messageLog.submitMessage(TOPIC_IDENTITY, ""),
      ).to.be.revertedWith("MessageLog: empty payload");
    });

    it("should reject payload exceeding MAX_PAYLOAD_SIZE", async function () {
      const hugePayload = "x".repeat(24_577); // 24KB + 1
      await expect(
        messageLog.submitMessage(TOPIC_IDENTITY, hugePayload),
      ).to.be.revertedWith("MessageLog: payload too large");
    });
  });

  // ── Message Reading ─────────────────────────────────────────────────

  describe("getMessage", function () {
    it("should return the correct message by sequence number", async function () {
      await messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG);
      await messageLog.submitMessage(TOPIC_IDENTITY, FEEDBACK_MSG);

      const msg1 = await messageLog.getMessage(TOPIC_IDENTITY, 1);
      expect(msg1.payload).to.equal(IDENTITY_MSG);

      const msg2 = await messageLog.getMessage(TOPIC_IDENTITY, 2);
      expect(msg2.payload).to.equal(FEEDBACK_MSG);
    });

    it("should revert for sequence number 0", async function () {
      await messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG);

      await expect(
        messageLog.getMessage(TOPIC_IDENTITY, 0),
      ).to.be.revertedWith("MessageLog: sequence number out of range");
    });

    it("should revert for sequence number beyond count", async function () {
      await messageLog.submitMessage(TOPIC_IDENTITY, IDENTITY_MSG);

      await expect(
        messageLog.getMessage(TOPIC_IDENTITY, 2),
      ).to.be.revertedWith("MessageLog: sequence number out of range");
    });
  });

  // ── Batch Reading ───────────────────────────────────────────────────

  describe("getMessageBatch", function () {
    beforeEach(async function () {
      // Submit 5 messages
      for (let i = 0; i < 5; i++) {
        await messageLog.submitMessage(
          TOPIC_IDENTITY,
          JSON.stringify({ type: "register", index: i }),
        );
      }
    });

    it("should return a range of messages", async function () {
      const batch = await messageLog.getMessageBatch(TOPIC_IDENTITY, 2, 4);

      expect(batch.length).to.equal(3);
      expect(batch[0].sequenceNumber).to.equal(2);
      expect(batch[2].sequenceNumber).to.equal(4);
    });

    it("should return all messages when range covers everything", async function () {
      const batch = await messageLog.getMessageBatch(TOPIC_IDENTITY, 1, 5);
      expect(batch.length).to.equal(5);
    });

    it("should clamp toSeq to actual count", async function () {
      const batch = await messageLog.getMessageBatch(TOPIC_IDENTITY, 4, 100);
      expect(batch.length).to.equal(2); // messages 4 and 5
    });

    it("should return empty array if fromSeq > count", async function () {
      const batch = await messageLog.getMessageBatch(TOPIC_IDENTITY, 10, 20);
      expect(batch.length).to.equal(0);
    });

    it("should revert if fromSeq is 0", async function () {
      await expect(
        messageLog.getMessageBatch(TOPIC_IDENTITY, 0, 5),
      ).to.be.revertedWith("MessageLog: fromSeq must be >= 1");
    });

    it("should revert if toSeq < fromSeq", async function () {
      await expect(
        messageLog.getMessageBatch(TOPIC_IDENTITY, 3, 2),
      ).to.be.revertedWith("MessageLog: toSeq must be >= fromSeq");
    });
  });

  // ── Topic Memos ─────────────────────────────────────────────────────

  describe("Topic Memos", function () {
    it("should allow owner to update topic memo", async function () {
      await messageLog.setTopicMemo(TOPIC_IDENTITY, "New Identity Memo");

      const memo = await messageLog.getTopicMemo(TOPIC_IDENTITY);
      expect(memo).to.equal("New Identity Memo");
    });

    it("should emit TopicMemoUpdated event", async function () {
      await expect(
        messageLog.setTopicMemo(TOPIC_FEEDBACK, "Updated Feedback"),
      )
        .to.emit(messageLog, "TopicMemoUpdated")
        .withArgs(TOPIC_FEEDBACK, "Updated Feedback");
    });

    it("should reject non-owner memo updates", async function () {
      await expect(
        messageLog.connect(alice).setTopicMemo(TOPIC_IDENTITY, "Hacked"),
      ).to.be.revertedWith("MessageLog: caller is not the owner");
    });
  });

  // ── Ownership ───────────────────────────────────────────────────────

  describe("Ownership", function () {
    it("should allow ownership transfer", async function () {
      await messageLog.transferOwnership(alice.address);
      expect(await messageLog.owner()).to.equal(alice.address);
    });

    it("should reject transfer to zero address", async function () {
      await expect(
        messageLog.transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWith("MessageLog: zero address");
    });

    it("should reject non-owner transfer", async function () {
      await expect(
        messageLog.connect(alice).transferOwnership(bob.address),
      ).to.be.revertedWith("MessageLog: caller is not the owner");
    });
  });
});
