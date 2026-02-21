// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SkillRegistry
 * @notice Canonical registry for Clawhub-listed skills.
 *
 * Each on-chain skill record is bound to:
 * - provider wallet
 * - Clawhub canonical ID hash
 * - provider identity hash (org/wallet binding)
 * - metadata hash
 *
 * This keeps staking/slashing tied to canonical identities instead of names.
 */
contract SkillRegistry {
    enum RiskTier {
        LOW,
        MEDIUM,
        HIGH
    }

    struct Skill {
        address provider;
        RiskTier risk;
        bytes32 metadataHash;
        bytes32 clawhubSkillId;
        bytes32 providerIdentityHash;
        bool active;
    }

    address public owner;
    uint256 public nextSkillId = 1;
    mapping(uint256 => Skill) private _skills;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event SkillRegistered(
        uint256 indexed skillId,
        address indexed provider,
        RiskTier risk,
        bytes32 metadataHash,
        bytes32 clawhubSkillId,
        bytes32 providerIdentityHash
    );
    event SkillStatusChanged(uint256 indexed skillId, bool active);
    event SkillMetadataUpdated(uint256 indexed skillId, bytes32 metadataHash);
    event SkillMappingUpdated(uint256 indexed skillId, bytes32 clawhubSkillId, bytes32 providerIdentityHash);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyProvider(uint256 skillId) {
        require(_exists(skillId), "SKILL_NOT_FOUND");
        require(_skills[skillId].provider == msg.sender, "NOT_PROVIDER");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    function registerSkill(
        RiskTier risk,
        bytes32 metadataHash,
        bytes32 clawhubSkillId,
        bytes32 providerIdentityHash
    ) external returns (uint256 skillId) {
        require(clawhubSkillId != bytes32(0), "MISSING_CLAWHUB_ID");
        require(providerIdentityHash != bytes32(0), "MISSING_PROVIDER_ID");

        skillId = nextSkillId++;
        _skills[skillId] = Skill({
            provider: msg.sender,
            risk: risk,
            metadataHash: metadataHash,
            clawhubSkillId: clawhubSkillId,
            providerIdentityHash: providerIdentityHash,
            active: true
        });

        emit SkillRegistered(
            skillId,
            msg.sender,
            risk,
            metadataHash,
            clawhubSkillId,
            providerIdentityHash
        );
    }

    function setActive(uint256 skillId, bool active) external onlyProvider(skillId) {
        _skills[skillId].active = active;
        emit SkillStatusChanged(skillId, active);
    }

    function updateMetadata(uint256 skillId, bytes32 metadataHash) external onlyProvider(skillId) {
        _skills[skillId].metadataHash = metadataHash;
        emit SkillMetadataUpdated(skillId, metadataHash);
    }

    function updateClawhubBinding(
        uint256 skillId,
        bytes32 clawhubSkillId,
        bytes32 providerIdentityHash
    ) external onlyProvider(skillId) {
        require(clawhubSkillId != bytes32(0), "MISSING_CLAWHUB_ID");
        require(providerIdentityHash != bytes32(0), "MISSING_PROVIDER_ID");
        _skills[skillId].clawhubSkillId = clawhubSkillId;
        _skills[skillId].providerIdentityHash = providerIdentityHash;
        emit SkillMappingUpdated(skillId, clawhubSkillId, providerIdentityHash);
    }

    function getSkillCore(uint256 skillId)
        external
        view
        returns (address provider, RiskTier risk, bool active)
    {
        require(_exists(skillId), "SKILL_NOT_FOUND");
        Skill storage s = _skills[skillId];
        return (s.provider, s.risk, s.active);
    }

    function getSkillBinding(uint256 skillId)
        external
        view
        returns (bytes32 clawhubSkillId, bytes32 providerIdentityHash, bytes32 metadataHash)
    {
        require(_exists(skillId), "SKILL_NOT_FOUND");
        Skill storage s = _skills[skillId];
        return (s.clawhubSkillId, s.providerIdentityHash, s.metadataHash);
    }

    function skillExists(uint256 skillId) external view returns (bool) {
        return _exists(skillId);
    }

    function _exists(uint256 skillId) internal view returns (bool) {
        return skillId > 0 && skillId < nextSkillId;
    }
}
