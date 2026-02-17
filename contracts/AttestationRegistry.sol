// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AttestationRegistry
 * @notice On-chain attestation contract for Trusted ClawMon (Phase 5).
 *
 *  Purpose
 *  ───────
 *   Publishes trust score snapshots from the scoring engine
 *   as on-chain attestations on Monad. Consumers can verify an agent's
 *   trust score via simple view calls.
 *
 *  Design
 *  ──────
 *   - An authorized attester publishes score snapshots.
 *   - Each attestation records: agent ID, score (0-100), tier, timestamp,
 *     source chain, and feedback count.
 *   - Consumers call view functions to check attestation status and scores.
 *   - Attestations have a freshness window (default 24h) -- stale attestations
 *     are flagged but still readable for historical reference.
 *   - Batch attestation is supported for gas efficiency.
 *
 *  Deployed to Monad testnet.
 */
contract AttestationRegistry {
    // ── Types ────────────────────────────────────────────────────────────

    struct Attestation {
        bytes32 agentId;           // keccak256 of agent string ID
        uint16  score;             // 0–100 (hardened score)
        uint8   tier;              // 0=C, 1=CC, 2=CCC, 3=B, 4=BB, 5=BBB, 6=A, 7=AA, 8=AAA
        uint32  feedbackCount;     // number of feedback entries used
        uint64  sourceTimestamp;   // when the score was computed (unix seconds)
        uint64  attestedAt;        // when published on-chain (unix seconds)
        string  sourceChain;       // e.g. "monad-testnet"
        bool    revoked;           // attester can revoke if agent is delisted
    }

    // ── Constants ─────────────────────────────────────────────────────────

    uint64 public constant FRESHNESS_WINDOW = 24 hours;

    // Tier encoding (matches scoring/types.ts order)
    uint8 public constant TIER_C   = 0;
    uint8 public constant TIER_CC  = 1;
    uint8 public constant TIER_CCC = 2;
    uint8 public constant TIER_B   = 3;
    uint8 public constant TIER_BB  = 4;
    uint8 public constant TIER_BBB = 5;
    uint8 public constant TIER_A   = 6;
    uint8 public constant TIER_AA  = 7;
    uint8 public constant TIER_AAA = 8;

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;
    address public attester; // bridge service address authorized to publish

    /// @notice Latest attestation per agent
    mapping(bytes32 => Attestation) public attestations;

    /// @notice Historical attestation count per agent
    mapping(bytes32 => uint256) public attestationCount;

    /// @notice Total attestations published
    uint256 public totalAttestations;

    /// @notice All attested agent IDs for enumeration
    bytes32[] public attestedAgents;
    mapping(bytes32 => bool) private _agentAttested;

    // ── Events ────────────────────────────────────────────────────────────

    event AttestationPublished(
        bytes32 indexed agentId,
        uint16  score,
        uint8   tier,
        uint32  feedbackCount,
        uint64  sourceTimestamp,
        string  sourceChain
    );

    event AttestationRevoked(bytes32 indexed agentId, string reason);
    event AttesterUpdated(address indexed oldAttester, address indexed newAttester);
    event BatchAttestationPublished(uint256 count);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAttester() {
        require(msg.sender == attester, "Not authorized attester");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _attester) {
        owner = msg.sender;
        attester = _attester;
    }

    // ── Attestation Publishing ────────────────────────────────────────────

    /**
     * @notice Publish a trust score attestation for an agent.
     * @param agentId         keccak256 hash of the agent's string ID
     * @param score           Trust score (0-100)
     * @param tier            Trust tier (0=C .. 8=AAA)
     * @param feedbackCount   Number of feedback entries used in computation
     * @param sourceTimestamp  When the score was computed (unix seconds)
     * @param sourceChain     Source chain identifier (e.g. "monad-testnet")
     */
    function publishAttestation(
        bytes32 agentId,
        uint16  score,
        uint8   tier,
        uint32  feedbackCount,
        uint64  sourceTimestamp,
        string calldata sourceChain
    ) external onlyAttester {
        require(score <= 100, "Score must be 0-100");
        require(tier <= TIER_AAA, "Invalid tier");
        require(agentId != bytes32(0), "Empty agent ID");

        _storeAttestation(agentId, score, tier, feedbackCount, sourceTimestamp, sourceChain);

        emit AttestationPublished(agentId, score, tier, feedbackCount, sourceTimestamp, sourceChain);
    }

    /**
     * @notice Publish attestations for multiple agents in one transaction.
     * @dev Gas-efficient batch operation for the bridge service.
     */
    function batchPublishAttestations(
        bytes32[] calldata agentIds,
        uint16[]  calldata scores,
        uint8[]   calldata tiers,
        uint32[]  calldata feedbackCounts,
        uint64[]  calldata sourceTimestamps,
        string    calldata sourceChain
    ) external onlyAttester {
        uint256 len = agentIds.length;
        require(
            len == scores.length &&
            len == tiers.length &&
            len == feedbackCounts.length &&
            len == sourceTimestamps.length,
            "Array length mismatch"
        );
        require(len > 0, "Empty batch");

        for (uint256 i = 0; i < len; i++) {
            require(scores[i] <= 100, "Score must be 0-100");
            require(tiers[i] <= TIER_AAA, "Invalid tier");
            require(agentIds[i] != bytes32(0), "Empty agent ID");

            _storeAttestation(
                agentIds[i],
                scores[i],
                tiers[i],
                feedbackCounts[i],
                sourceTimestamps[i],
                sourceChain
            );

            emit AttestationPublished(
                agentIds[i], scores[i], tiers[i],
                feedbackCounts[i], sourceTimestamps[i], sourceChain
            );
        }

        totalAttestations += len;
        emit BatchAttestationPublished(len);
    }

    /**
     * @notice Revoke an attestation (e.g. agent delisted or detected malicious).
     */
    function revokeAttestation(bytes32 agentId, string calldata reason) external onlyAttester {
        require(_agentAttested[agentId], "Agent not attested");
        require(!attestations[agentId].revoked, "Already revoked");

        attestations[agentId].revoked = true;

        emit AttestationRevoked(agentId, reason);
    }

    // ── Verification Functions (Consumer-facing) ──────────────────────────

    /**
     * @notice Check if an agent has a valid (non-revoked, fresh) attestation.
     * @return valid True if attestation exists, is not revoked, and is within freshness window
     */
    function isAttested(bytes32 agentId) external view returns (bool valid) {
        Attestation storage a = attestations[agentId];
        if (!_agentAttested[agentId]) return false;
        if (a.revoked) return false;
        if (block.timestamp > a.attestedAt + FRESHNESS_WINDOW) return false;
        return true;
    }

    /**
     * @notice Get the full attestation record for an agent.
     */
    function getAttestation(bytes32 agentId) external view returns (
        uint16  score,
        uint8   tier,
        uint32  feedbackCount,
        uint64  sourceTimestamp,
        uint64  attestedAt,
        string memory sourceChain,
        bool    revoked,
        bool    isFresh
    ) {
        Attestation storage a = attestations[agentId];
        bool fresh = !a.revoked && (block.timestamp <= a.attestedAt + FRESHNESS_WINDOW);
        return (
            a.score,
            a.tier,
            a.feedbackCount,
            a.sourceTimestamp,
            a.attestedAt,
            a.sourceChain,
            a.revoked,
            fresh
        );
    }

    /**
     * @notice Check how long since the attestation was published.
     * @return ageSeconds Seconds since attestation (or max uint64 if not attested)
     */
    function getAttestationAge(bytes32 agentId) external view returns (uint64 ageSeconds) {
        if (!_agentAttested[agentId]) return type(uint64).max;
        Attestation storage a = attestations[agentId];
        if (block.timestamp < a.attestedAt) return 0;
        return uint64(block.timestamp - a.attestedAt);
    }

    /**
     * @notice Verify an agent meets a minimum trust score requirement.
     * @param agentId   Agent to check
     * @param minScore  Minimum score threshold (0-100)
     * @return meets    True if agent has a fresh, non-revoked attestation with score >= minScore
     */
    function verifyMinScore(bytes32 agentId, uint16 minScore) external view returns (bool meets) {
        Attestation storage a = attestations[agentId];
        if (!_agentAttested[agentId]) return false;
        if (a.revoked) return false;
        if (block.timestamp > a.attestedAt + FRESHNESS_WINDOW) return false;
        return a.score >= minScore;
    }

    /**
     * @notice Verify an agent meets a minimum trust tier requirement.
     * @param agentId  Agent to check
     * @param minTier  Minimum tier (0=C, 8=AAA)
     * @return meets   True if agent has a fresh, non-revoked attestation with tier >= minTier
     */
    function verifyMinTier(bytes32 agentId, uint8 minTier) external view returns (bool meets) {
        Attestation storage a = attestations[agentId];
        if (!_agentAttested[agentId]) return false;
        if (a.revoked) return false;
        if (block.timestamp > a.attestedAt + FRESHNESS_WINDOW) return false;
        return a.tier >= minTier;
    }

    // ── Enumeration ───────────────────────────────────────────────────────

    /**
     * @notice Get the total number of unique agents with attestations.
     */
    function getAttestedAgentCount() external view returns (uint256) {
        return attestedAgents.length;
    }

    /**
     * @notice Get an attested agent ID by index (for enumeration).
     */
    function getAttestedAgent(uint256 index) external view returns (bytes32) {
        require(index < attestedAgents.length, "Index out of bounds");
        return attestedAgents[index];
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /**
     * @notice Update the authorized attester address (bridge service).
     */
    function setAttester(address _attester) external onlyOwner {
        require(_attester != address(0), "Zero address");
        address old = attester;
        attester = _attester;
        emit AttesterUpdated(old, _attester);
    }

    /**
     * @notice Transfer ownership.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _storeAttestation(
        bytes32 agentId,
        uint16  score,
        uint8   tier,
        uint32  feedbackCount,
        uint64  sourceTimestamp,
        string calldata sourceChain
    ) internal {
        attestations[agentId] = Attestation({
            agentId:          agentId,
            score:            score,
            tier:             tier,
            feedbackCount:    feedbackCount,
            sourceTimestamp:  sourceTimestamp,
            attestedAt:       uint64(block.timestamp),
            sourceChain:      sourceChain,
            revoked:          false
        });

        if (!_agentAttested[agentId]) {
            attestedAgents.push(agentId);
            _agentAttested[agentId] = true;
        }

        attestationCount[agentId]++;
        totalAttestations++;
    }
}
