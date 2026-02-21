// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./StakeEscrow.sol";
import "./SkillRegistry.sol";

/**
 * @title SlashingManager
 * @notice Committee-authorized slashing for Clawhub skills.
 *
 * MVP model:
 * - Slash authority (multisig) executes slashes.
 * - Each slash references a unique caseId to prevent replay/duplicates.
 * - Slashed funds route to treasury.
 */
contract SlashingManager {
    StakeEscrow public immutable escrow;
    SkillRegistry public immutable registry;

    address public owner;
    address public slashAuthority;
    address public treasury;

    mapping(bytes32 => bool) public usedCaseIds;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event SlashAuthorityUpdated(address indexed oldAuthority, address indexed newAuthority);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event SlashExecuted(
        uint256 indexed skillId,
        uint256 amount,
        uint16 severityBps,
        bytes32 indexed reasonHash,
        string evidenceURI,
        bytes32 indexed caseId
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyAuthority() {
        require(msg.sender == slashAuthority, "NOT_AUTHORITY");
        _;
    }

    constructor(
        StakeEscrow _escrow,
        SkillRegistry _registry,
        address _authority,
        address _treasury
    ) {
        require(address(_escrow) != address(0), "BAD_ESCROW");
        require(address(_registry) != address(0), "BAD_REGISTRY");
        require(_authority != address(0), "BAD_AUTHORITY");
        require(_treasury != address(0), "BAD_TREASURY");

        escrow = _escrow;
        registry = _registry;
        owner = msg.sender;
        slashAuthority = _authority;
        treasury = _treasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    function setSlashAuthority(address newAuthority) external onlyOwner {
        require(newAuthority != address(0), "BAD_AUTHORITY");
        address old = slashAuthority;
        slashAuthority = newAuthority;
        emit SlashAuthorityUpdated(old, newAuthority);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "BAD_TREASURY");
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function slashSkill(
        uint256 skillId,
        uint16 severityBps,
        bytes32 reasonHash,
        string calldata evidenceURI,
        bytes32 caseId
    ) external onlyAuthority {
        require(caseId != bytes32(0), "BAD_CASE_ID");
        require(!usedCaseIds[caseId], "CASE_ALREADY_USED");
        require(severityBps > 0 && severityBps <= 10000, "BAD_BPS");
        require(registry.skillExists(skillId), "SKILL_NOT_FOUND");

        usedCaseIds[caseId] = true;

        uint256 staked = escrow.getSkillStake(skillId);
        uint256 amount = (staked * severityBps) / 10000;
        require(amount > 0, "NOTHING_TO_SLASH");

        escrow.slash(skillId, amount, treasury);
        emit SlashExecuted(skillId, amount, severityBps, reasonHash, evidenceURI, caseId);
    }
}
