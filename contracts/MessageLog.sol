// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MessageLog
 * @notice On-chain ordered message log for Trusted ClawMon.
 *
 *  Purpose
 *  ───────
 *   Replaces Hedera Consensus Service (HCS) topics with on-chain storage.
 *   Stores JSON-encoded identity registrations and feedback submissions
 *   as ordered, immutable messages that can be read via simple view calls.
 *
 *  Design
 *  ──────
 *   • Two topics: Identity (agent registrations) and Feedback (community feedback).
 *   • Messages are stored as strings in mappings keyed by (topic, sequenceNumber).
 *   • Each topic has an independent auto-incrementing sequence counter.
 *   • Emits a MessageSubmitted event for off-chain indexers / watchers.
 *   • Owner can set topic memos for metadata.
 *   • Batch reads via getMessageBatch() for efficient pagination.
 *
 *  Deployed to Monad testnet.
 */
contract MessageLog {
    // ── Types ────────────────────────────────────────────────────────────

    enum Topic {
        Identity,   // 0 — agent/skill registrations
        Feedback    // 1 — community feedback submissions
    }

    struct Message {
        string  payload;        // JSON-encoded message content
        address sender;         // msg.sender who submitted
        uint64  timestamp;      // block.timestamp when submitted
        uint256 sequenceNumber; // 1-based sequence within the topic
    }

    // ── Events ───────────────────────────────────────────────────────────

    event MessageSubmitted(
        Topic   indexed topic,
        uint256 indexed sequenceNumber,
        address indexed sender,
        uint64  timestamp,
        string  payload
    );

    event TopicMemoUpdated(
        Topic  indexed topic,
        string memo
    );

    // ── Constants ────────────────────────────────────────────────────────

    uint256 public constant MAX_PAYLOAD_SIZE = 24_576; // 24 KB
    uint256 public constant MAX_BATCH_SIZE   = 100;

    // ── State ────────────────────────────────────────────────────────────

    address public owner;

    /// @dev topic => sequenceNumber => Message
    mapping(Topic => mapping(uint256 => Message)) private _messages;

    /// @dev topic => current message count
    mapping(Topic => uint256) private _messageCount;

    /// @dev topic => memo string
    mapping(Topic => string) private _topicMemos;

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "MessageLog: caller is not the owner");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        _topicMemos[Topic.Identity] = "TrustedClawMon:Identity - agent registrations";
        _topicMemos[Topic.Feedback] = "TrustedClawMon:Feedback - community feedback";
    }

    // ── Write Operations ─────────────────────────────────────────────────

    /**
     * @notice Submit a JSON message to a topic.
     * @param topic  The topic to write to (Identity or Feedback).
     * @param payload  The JSON-encoded message content.
     * @return sequenceNumber  The 1-based sequence number assigned.
     */
    function submitMessage(
        Topic topic,
        string calldata payload
    ) external returns (uint256 sequenceNumber) {
        require(bytes(payload).length > 0, "MessageLog: empty payload");
        require(
            bytes(payload).length <= MAX_PAYLOAD_SIZE,
            "MessageLog: payload too large"
        );

        _messageCount[topic]++;
        sequenceNumber = _messageCount[topic];

        _messages[topic][sequenceNumber] = Message({
            payload:        payload,
            sender:         msg.sender,
            timestamp:      uint64(block.timestamp),
            sequenceNumber: sequenceNumber
        });

        emit MessageSubmitted(
            topic,
            sequenceNumber,
            msg.sender,
            uint64(block.timestamp),
            payload
        );
    }

    // ── Read Operations ──────────────────────────────────────────────────

    /**
     * @notice Get a single message by topic and sequence number.
     * @param topic  The topic to read from.
     * @param seqNum  The 1-based sequence number.
     * @return message  The stored message struct.
     */
    function getMessage(
        Topic topic,
        uint256 seqNum
    ) external view returns (Message memory message) {
        require(
            seqNum >= 1 && seqNum <= _messageCount[topic],
            "MessageLog: sequence number out of range"
        );
        return _messages[topic][seqNum];
    }

    /**
     * @notice Get the total number of messages in a topic.
     * @param topic  The topic to query.
     * @return count  The number of messages submitted.
     */
    function getMessageCount(
        Topic topic
    ) external view returns (uint256 count) {
        return _messageCount[topic];
    }

    /**
     * @notice Read a batch of messages from a topic (inclusive range).
     * @dev Capped at MAX_BATCH_SIZE messages per call to avoid gas limits.
     * @param topic  The topic to read from.
     * @param fromSeq  The starting sequence number (1-based, inclusive).
     * @param toSeq  The ending sequence number (inclusive).
     * @return messages  Array of Message structs.
     */
    function getMessageBatch(
        Topic topic,
        uint256 fromSeq,
        uint256 toSeq
    ) external view returns (Message[] memory messages) {
        uint256 total = _messageCount[topic];

        require(fromSeq >= 1, "MessageLog: fromSeq must be >= 1");
        require(toSeq >= fromSeq, "MessageLog: toSeq must be >= fromSeq");

        // Clamp toSeq to the actual message count
        if (toSeq > total) {
            toSeq = total;
        }

        // If fromSeq is beyond the total, return empty
        if (fromSeq > total) {
            return new Message[](0);
        }

        uint256 batchSize = toSeq - fromSeq + 1;
        require(
            batchSize <= MAX_BATCH_SIZE,
            "MessageLog: batch too large, max 100"
        );

        messages = new Message[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            messages[i] = _messages[topic][fromSeq + i];
        }
    }

    /**
     * @notice Get the topic memo (metadata string).
     * @param topic  The topic to query.
     * @return memo  The memo string.
     */
    function getTopicMemo(
        Topic topic
    ) external view returns (string memory memo) {
        return _topicMemos[topic];
    }

    // ── Owner Operations ─────────────────────────────────────────────────

    /**
     * @notice Update the memo for a topic.
     * @param topic  The topic to update.
     * @param memo  The new memo string.
     */
    function setTopicMemo(
        Topic topic,
        string calldata memo
    ) external onlyOwner {
        _topicMemos[topic] = memo;
        emit TopicMemoUpdated(topic, memo);
    }

    /**
     * @notice Transfer ownership of the contract.
     * @param newOwner  The new owner address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MessageLog: zero address");
        owner = newOwner;
    }
}
