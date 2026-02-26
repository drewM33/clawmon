// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./StakeEscrow.sol";
import "./SkillRegistry.sol";

/**
 * @title BenefitGate
 * @notice On-chain benefit tier gating based on StakeEscrow boost levels.
 *
 * Benefit tiers (Discord Nitro-style):
 *   None   (L0) — Public API access, 10 req/min
 *   Bronze (L1) — Priority queue, 100 req/min, feedback badge
 *   Silver (L2) — VPS sandbox access, 500 req/min, analytics dashboard
 *   Gold   (L3) — Dedicated compute, 2000 req/min, persistent state, custom domain
 *
 * Reads trust level from StakeEscrow to determine tier. Emits events for
 * off-chain provisioners to react to tier changes.
 */
contract BenefitGate {
    StakeEscrow public immutable escrow;
    SkillRegistry public immutable registry;
    address public owner;

    enum BenefitTier { None, Bronze, Silver, Gold }

    struct BenefitAllocation {
        BenefitTier tier;
        uint256 activatedAt;
        uint256 expiresAt;     // 0 = no expiry (active while staked)
        bytes32 vpsId;         // L2+: provisioned VPS identifier
        bytes32 computeId;     // L3: dedicated compute identifier
    }

    mapping(uint256 => BenefitAllocation) public allocations;

    event BenefitActivated(uint256 indexed skillId, BenefitTier tier, bytes32 resourceId);
    event BenefitDeactivated(uint256 indexed skillId, BenefitTier oldTier);
    event BenefitUpgraded(uint256 indexed skillId, BenefitTier oldTier, BenefitTier newTier);
    event ResourceAssigned(uint256 indexed skillId, bytes32 vpsId, bytes32 computeId);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(StakeEscrow _escrow, SkillRegistry _registry) {
        require(address(_escrow) != address(0), "BAD_ESCROW");
        require(address(_registry) != address(0), "BAD_REGISTRY");
        escrow = _escrow;
        registry = _registry;
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // ─── Core Gate Logic ────────────────────────────────────────────────

    /**
     * @notice Check and activate/update benefit tier for a skill.
     *         Reads current trust level from StakeEscrow, maps to BenefitTier,
     *         and updates the allocation. Emits events for off-chain provisioners.
     * @param skillId The skill to activate benefits for.
     * @return The new BenefitTier.
     */
    function checkAndActivate(uint256 skillId) external returns (BenefitTier) {
        require(registry.skillExists(skillId), "SKILL_NOT_FOUND");

        uint8 level = escrow.getTrustLevel(skillId);
        BenefitTier newTier = _levelToTier(level);
        BenefitAllocation storage alloc = allocations[skillId];
        BenefitTier oldTier = alloc.tier;

        if (newTier != oldTier) {
            alloc.tier = newTier;
            alloc.activatedAt = block.timestamp;
            alloc.expiresAt = 0;

            if (newTier == BenefitTier.None) {
                // Deactivated — clear resource IDs
                alloc.vpsId = bytes32(0);
                alloc.computeId = bytes32(0);
                emit BenefitDeactivated(skillId, oldTier);
            } else if (oldTier == BenefitTier.None) {
                // First activation
                emit BenefitActivated(skillId, newTier, bytes32(0));
            } else {
                // Tier change (upgrade or downgrade)
                if (newTier < oldTier) {
                    // Downgrade — clear higher-tier resources
                    if (newTier < BenefitTier.Silver) {
                        alloc.vpsId = bytes32(0);
                    }
                    if (newTier < BenefitTier.Gold) {
                        alloc.computeId = bytes32(0);
                    }
                }
                emit BenefitUpgraded(skillId, oldTier, newTier);
            }
        }

        return newTier;
    }

    // ─── Read Functions ─────────────────────────────────────────────────

    /**
     * @notice Get current benefit tier for a skill (live from StakeEscrow).
     */
    function getBenefitTier(uint256 skillId) public view returns (BenefitTier) {
        if (!registry.skillExists(skillId)) return BenefitTier.None;
        uint8 level = escrow.getTrustLevel(skillId);
        return _levelToTier(level);
    }

    /**
     * @notice Check if a skill is authorized for a specific benefit tier.
     * @param skillId The skill to check.
     * @param requiredTier The minimum tier required.
     * @return true if skill's tier >= requiredTier.
     */
    function isAuthorized(uint256 skillId, BenefitTier requiredTier) external view returns (bool) {
        return getBenefitTier(skillId) >= requiredTier;
    }

    /**
     * @notice Get the full allocation record for a skill.
     */
    function getAllocation(uint256 skillId) external view returns (
        BenefitTier tier,
        uint256 activatedAt,
        uint256 expiresAt,
        bytes32 vpsId,
        bytes32 computeId
    ) {
        BenefitAllocation memory alloc = allocations[skillId];
        return (alloc.tier, alloc.activatedAt, alloc.expiresAt, alloc.vpsId, alloc.computeId);
    }

    // ─── Admin: Resource Assignment ─────────────────────────────────────

    /**
     * @notice Assign VPS and compute resource IDs to a skill allocation.
     *         Called by off-chain provisioner after creating resources.
     */
    function assignResources(uint256 skillId, bytes32 vpsId, bytes32 computeId) external onlyOwner {
        BenefitAllocation storage alloc = allocations[skillId];
        require(alloc.tier != BenefitTier.None, "NOT_ACTIVATED");

        alloc.vpsId = vpsId;
        alloc.computeId = computeId;
        emit ResourceAssigned(skillId, vpsId, computeId);
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _levelToTier(uint8 level) internal pure returns (BenefitTier) {
        if (level >= 3) return BenefitTier.Gold;
        if (level >= 2) return BenefitTier.Silver;
        if (level >= 1) return BenefitTier.Bronze;
        return BenefitTier.None;
    }
}
