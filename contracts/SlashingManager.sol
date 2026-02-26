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

    // ── Validator Committee (Phase 4) ─────────────────────────────────────

    mapping(address => bool) public isValidator;
    uint256 public validatorCount;
    uint256 public slashQuorum;

    enum ProposalStatus { Pending, Approved, Rejected, Executed }

    struct SlashProposal {
        uint256 skillId;
        uint16 severityBps;
        bytes32 reasonHash;
        string evidenceURI;
        bytes32 caseId;
        address proposer;
        uint256 approvals;
        uint256 rejections;
        ProposalStatus status;
    }

    /// @notice Proposals keyed by caseId
    mapping(bytes32 => SlashProposal) private _proposals;

    /// @notice Tracks which validators have voted on each proposal
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    /// @notice All caseIds for enumeration
    bytes32[] public proposalCaseIds;

    // ── Events ────────────────────────────────────────────────────────────

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
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event QuorumUpdated(uint256 oldQuorum, uint256 newQuorum);
    event SlashProposed(
        bytes32 indexed caseId,
        uint256 indexed skillId,
        address indexed proposer,
        uint16 severityBps,
        bytes32 reasonHash
    );
    event SlashVoted(bytes32 indexed caseId, address indexed validator, bool approve);
    event ProposalExecuted(bytes32 indexed caseId, uint256 indexed skillId, uint256 amount);
    event ProposalRejected(bytes32 indexed caseId, uint256 indexed skillId);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyAuthority() {
        require(msg.sender == slashAuthority, "NOT_AUTHORITY");
        _;
    }

    modifier onlyValidator() {
        require(isValidator[msg.sender], "NOT_VALIDATOR");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

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
        slashQuorum = 3; // Default: 3 of N validators
    }

    // ── Admin ─────────────────────────────────────────────────────────────

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

    function addValidator(address validator) external onlyOwner {
        require(validator != address(0), "BAD_VALIDATOR");
        require(!isValidator[validator], "ALREADY_VALIDATOR");
        isValidator[validator] = true;
        validatorCount++;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        require(isValidator[validator], "NOT_VALIDATOR");
        isValidator[validator] = false;
        validatorCount--;
        emit ValidatorRemoved(validator);
    }

    function setSlashQuorum(uint256 newQuorum) external onlyOwner {
        require(newQuorum > 0, "BAD_QUORUM");
        uint256 old = slashQuorum;
        slashQuorum = newQuorum;
        emit QuorumUpdated(old, newQuorum);
    }

    // ── Direct Slash (existing authority path — backward compatible) ─────

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

    // ── Validator Governance (Phase 4) ────────────────────────────────────

    /**
     * @notice Propose a slash. Only validators can propose.
     *         The proposer's vote is auto-counted as an approval.
     */
    function proposeSlash(
        uint256 skillId,
        uint16 severityBps,
        bytes32 reasonHash,
        string calldata evidenceURI,
        bytes32 caseId
    ) external onlyValidator {
        require(caseId != bytes32(0), "BAD_CASE_ID");
        require(!usedCaseIds[caseId], "CASE_ALREADY_USED");
        require(_proposals[caseId].proposer == address(0), "PROPOSAL_EXISTS");
        require(severityBps > 0 && severityBps <= 10000, "BAD_BPS");
        require(registry.skillExists(skillId), "SKILL_NOT_FOUND");

        _proposals[caseId] = SlashProposal({
            skillId: skillId,
            severityBps: severityBps,
            reasonHash: reasonHash,
            evidenceURI: evidenceURI,
            caseId: caseId,
            proposer: msg.sender,
            approvals: 1,
            rejections: 0,
            status: ProposalStatus.Pending
        });

        hasVoted[caseId][msg.sender] = true;
        proposalCaseIds.push(caseId);

        emit SlashProposed(caseId, skillId, msg.sender, severityBps, reasonHash);
        emit SlashVoted(caseId, msg.sender, true);

        // Auto-execute if quorum of 1
        if (slashQuorum <= 1) {
            _executeProposal(caseId);
        }
    }

    /**
     * @notice Vote on a slash proposal. Only validators who haven't voted.
     *         If quorum is reached, the slash is auto-executed.
     */
    function voteOnSlash(bytes32 caseId, bool approve) external onlyValidator {
        SlashProposal storage p = _proposals[caseId];
        require(p.proposer != address(0), "PROPOSAL_NOT_FOUND");
        require(p.status == ProposalStatus.Pending, "PROPOSAL_NOT_PENDING");
        require(!hasVoted[caseId][msg.sender], "ALREADY_VOTED");

        hasVoted[caseId][msg.sender] = true;

        if (approve) {
            p.approvals++;
            emit SlashVoted(caseId, msg.sender, true);

            if (p.approvals >= slashQuorum) {
                _executeProposal(caseId);
            }
        } else {
            p.rejections++;
            emit SlashVoted(caseId, msg.sender, false);

            // Auto-reject if impossible to reach quorum
            uint256 remainingVoters = validatorCount - p.approvals - p.rejections;
            if (p.approvals + remainingVoters < slashQuorum) {
                p.status = ProposalStatus.Rejected;
                emit ProposalRejected(caseId, p.skillId);
            }
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _executeProposal(bytes32 caseId) internal {
        SlashProposal storage p = _proposals[caseId];
        p.status = ProposalStatus.Executed;
        usedCaseIds[caseId] = true;

        uint256 staked = escrow.getSkillStake(p.skillId);
        uint256 amount = (staked * p.severityBps) / 10000;
        if (amount > 0) {
            escrow.slash(p.skillId, amount, treasury);
        }

        emit ProposalExecuted(caseId, p.skillId, amount);
        emit SlashExecuted(p.skillId, amount, p.severityBps, p.reasonHash, p.evidenceURI, caseId);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getProposal(bytes32 caseId) external view returns (
        uint256 skillId,
        uint16 severityBps,
        bytes32 reasonHash,
        address proposer,
        uint256 approvals,
        uint256 rejections,
        ProposalStatus status
    ) {
        SlashProposal storage p = _proposals[caseId];
        return (p.skillId, p.severityBps, p.reasonHash, p.proposer, p.approvals, p.rejections, p.status);
    }

    function getProposalCount() external view returns (uint256) {
        return proposalCaseIds.length;
    }

    function getProposalEvidenceURI(bytes32 caseId) external view returns (string memory) {
        return _proposals[caseId].evidenceURI;
    }
}
