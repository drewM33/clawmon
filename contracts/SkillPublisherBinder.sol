// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SkillRegistry.sol";
import "./StakeEscrow.sol";

/**
 * @title SkillPublisherBinder
 * @notice Atomic orchestrator for publishing a ClawHub skill on-chain.
 *
 *  In a single transaction the publisher can:
 *    1. Register the skill on SkillRegistry (via registerSkillFor)
 *    2. Stake MON on StakeEscrow (via stakeFor)
 *    3. Bind an optional ERC-8004 agentId for identity linkage
 *
 *  This contract must be set as an authorized binder on both
 *  SkillRegistry and StakeEscrow before use.
 *
 *  Identity paths:
 *    A) Publisher already has an ERC-8004 agentId → pass it in erc8004AgentId
 *    B) Publisher uses wallet only → pass 0 for erc8004AgentId
 *       (off-chain layer can lazy-register an 8004 identity later)
 */
contract SkillPublisherBinder {
    SkillRegistry public immutable registry;
    StakeEscrow public immutable escrow;
    address public owner;

    /// @notice Tracks which publisher published which skillId (for off-chain indexing)
    struct PublishRecord {
        uint256 skillId;
        address publisher;
        uint256 erc8004AgentId; // 0 if wallet-only
        bytes32 clawhubSkillId;
        uint256 stakedAmount;
        uint256 publishedAt;
    }

    /// @notice All publish records for enumeration
    PublishRecord[] public publishRecords;

    /// @notice publisher → list of skillIds they published
    mapping(address => uint256[]) public publisherSkills;

    /// @notice clawhubSkillId → skillId (reverse lookup)
    mapping(bytes32 => uint256) public clawhubToSkillId;

    // ── Events ────────────────────────────────────────────────────────────

    event SkillPublished(
        uint256 indexed skillId,
        address indexed publisher,
        uint256 erc8004AgentId,
        bytes32 indexed clawhubSkillId,
        uint256 stakedAmount,
        uint8 trustLevel
    );

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(SkillRegistry _registry, StakeEscrow _escrow) {
        require(address(_registry) != address(0), "BAD_REGISTRY");
        require(address(_escrow) != address(0), "BAD_ESCROW");
        registry = _registry;
        escrow = _escrow;
        owner = msg.sender;
    }

    // ── Core: Publish + Stake ─────────────────────────────────────────────

    /**
     * @notice Register a skill and stake MON in a single transaction.
     *
     * @param risk                Risk tier for the skill (LOW/MEDIUM/HIGH).
     * @param metadataHash        Hash of off-chain metadata (SKILL.md content hash).
     * @param clawhubSkillId      keccak256 of the ClawHub slug (canonical ID).
     * @param providerIdentityHash keccak256 binding the provider org/wallet.
     * @param erc8004AgentId      ERC-8004 agentId (0 if wallet-only, bound off-chain).
     *
     * @return skillId  The on-chain skill ID from SkillRegistry.
     */
    function publishAndStake(
        SkillRegistry.RiskTier risk,
        bytes32 metadataHash,
        bytes32 clawhubSkillId,
        bytes32 providerIdentityHash,
        uint256 erc8004AgentId
    ) external payable returns (uint256 skillId) {
        require(msg.value > 0, "MUST_STAKE");

        // 1. Register skill with the caller as provider
        skillId = registry.registerSkillFor(
            msg.sender,
            risk,
            metadataHash,
            clawhubSkillId,
            providerIdentityHash
        );

        // 2. Stake MON on behalf of the publisher
        escrow.stakeFor{value: msg.value}(skillId, msg.sender);

        // 3. Record the binding
        publishRecords.push(PublishRecord({
            skillId: skillId,
            publisher: msg.sender,
            erc8004AgentId: erc8004AgentId,
            clawhubSkillId: clawhubSkillId,
            stakedAmount: msg.value,
            publishedAt: block.timestamp
        }));

        publisherSkills[msg.sender].push(skillId);
        clawhubToSkillId[clawhubSkillId] = skillId;

        // 4. Emit for off-chain indexing
        uint8 trustLevel = escrow.getTrustLevel(skillId);
        emit SkillPublished(
            skillId,
            msg.sender,
            erc8004AgentId,
            clawhubSkillId,
            msg.value,
            trustLevel
        );
    }

    /**
     * @notice Register a skill without staking (publisher stakes later directly).
     */
    function publishOnly(
        SkillRegistry.RiskTier risk,
        bytes32 metadataHash,
        bytes32 clawhubSkillId,
        bytes32 providerIdentityHash,
        uint256 erc8004AgentId
    ) external returns (uint256 skillId) {
        skillId = registry.registerSkillFor(
            msg.sender,
            risk,
            metadataHash,
            clawhubSkillId,
            providerIdentityHash
        );

        publishRecords.push(PublishRecord({
            skillId: skillId,
            publisher: msg.sender,
            erc8004AgentId: erc8004AgentId,
            clawhubSkillId: clawhubSkillId,
            stakedAmount: 0,
            publishedAt: block.timestamp
        }));

        publisherSkills[msg.sender].push(skillId);
        clawhubToSkillId[clawhubSkillId] = skillId;

        emit SkillPublished(
            skillId,
            msg.sender,
            erc8004AgentId,
            clawhubSkillId,
            0,
            0
        );
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getPublishRecordCount() external view returns (uint256) {
        return publishRecords.length;
    }

    function getPublisherSkillCount(address publisher) external view returns (uint256) {
        return publisherSkills[publisher].length;
    }

    function getPublisherSkillIds(address publisher) external view returns (uint256[] memory) {
        return publisherSkills[publisher];
    }

    function getSkillIdByClawhubId(bytes32 clawhubSkillId) external view returns (uint256) {
        return clawhubToSkillId[clawhubSkillId];
    }
}
