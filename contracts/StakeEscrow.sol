// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./SkillRegistry.sol";

/**
 * @title StakeEscrow
 * @notice Native MON escrow with Discord-style boost thresholds and pro-rata slashing.
 *
 * Safety properties:
 * - Share accounting keeps pool solvent after slashes.
 * - Unstake requests lock shares (not nominal assets) so later slashes are reflected fairly.
 * - Trust level is derived fully on-chain from current escrowed assets.
 */
contract StakeEscrow {
    SkillRegistry public immutable registry;
    address public owner;
    address public slashingManager;

    uint256 public constant L1_BOOSTS = 2;
    uint256 public constant L2_BOOSTS = 7;
    uint256 public constant L3_BOOSTS = 14;

    uint64 public unstakeCooldownSeconds = 7 days;

    mapping(SkillRegistry.RiskTier => uint256) public boostUnitWei;

    struct SkillPool {
        uint256 totalAssets;
        uint256 totalShares;
    }

    struct UnstakeRequest {
        uint256 shares;
        uint64 unlockTime;
    }

    mapping(uint256 => SkillPool) private _pools;
    mapping(uint256 => mapping(address => uint256)) private _providerShares;
    mapping(uint256 => mapping(address => uint256)) private _lockedShares;
    mapping(uint256 => mapping(address => UnstakeRequest)) public pendingUnstake;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event SlashingManagerSet(address indexed slashingManager);
    event UnstakeCooldownUpdated(uint64 oldCooldown, uint64 newCooldown);
    event BoostUnitUpdated(SkillRegistry.RiskTier indexed riskTier, uint256 oldUnitWei, uint256 newUnitWei);

    event Staked(uint256 indexed skillId, address indexed provider, uint256 amount, uint256 mintedShares);
    event UnstakeRequested(
        uint256 indexed skillId,
        address indexed provider,
        uint256 requestedAmount,
        uint256 lockedShares,
        uint64 unlockTime
    );
    event Unstaked(uint256 indexed skillId, address indexed provider, uint256 amount, uint256 burnedShares);
    event Slashed(uint256 indexed skillId, uint256 amount, address recipient);
    event TrustLevelChanged(uint256 indexed skillId, uint8 oldLevel, uint8 newLevel);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlySlasher() {
        require(msg.sender == slashingManager, "NOT_SLASHER");
        _;
    }

    constructor(
        SkillRegistry _registry,
        uint256 lowUnit,
        uint256 medUnit,
        uint256 highUnit
    ) {
        require(address(_registry) != address(0), "BAD_REGISTRY");
        require(lowUnit > 0 && medUnit > 0 && highUnit > 0, "BAD_UNITS");
        registry = _registry;
        owner = msg.sender;
        boostUnitWei[SkillRegistry.RiskTier.LOW] = lowUnit;
        boostUnitWei[SkillRegistry.RiskTier.MEDIUM] = medUnit;
        boostUnitWei[SkillRegistry.RiskTier.HIGH] = highUnit;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    function setSlashingManager(address sm) external onlyOwner {
        require(sm != address(0), "BAD_SLASHER");
        slashingManager = sm;
        emit SlashingManagerSet(sm);
    }

    function setUnstakeCooldownSeconds(uint64 newCooldown) external onlyOwner {
        uint64 old = unstakeCooldownSeconds;
        unstakeCooldownSeconds = newCooldown;
        emit UnstakeCooldownUpdated(old, newCooldown);
    }

    function setBoostUnitWei(SkillRegistry.RiskTier riskTier, uint256 newUnitWei) external onlyOwner {
        require(newUnitWei > 0, "BAD_UNIT");
        uint256 old = boostUnitWei[riskTier];
        boostUnitWei[riskTier] = newUnitWei;
        emit BoostUnitUpdated(riskTier, old, newUnitWei);
    }

    function stake(uint256 skillId) external payable {
        require(msg.value > 0, "ZERO");
        (address provider, , bool active) = registry.getSkillCore(skillId);
        require(active, "SKILL_INACTIVE");
        require(provider == msg.sender, "NOT_SKILL_PROVIDER");

        uint8 oldLevel = getTrustLevel(skillId);
        SkillPool storage p = _pools[skillId];
        uint256 shares = _assetsToSharesDown(p, msg.value);
        if (p.totalShares == 0) {
            shares = msg.value;
        }
        require(shares > 0, "ZERO_SHARES");

        p.totalAssets += msg.value;
        p.totalShares += shares;
        _providerShares[skillId][msg.sender] += shares;

        emit Staked(skillId, msg.sender, msg.value, shares);
        _emitLevelChangeIfNeeded(skillId, oldLevel);
    }

    function requestUnstake(uint256 skillId, uint256 amount) external {
        require(amount > 0, "ZERO");
        require(registry.skillExists(skillId), "SKILL_NOT_FOUND");
        SkillPool storage p = _pools[skillId];
        require(p.totalShares > 0, "NO_STAKE");

        uint256 sharesToLock = _assetsToSharesUp(p, amount);
        require(sharesToLock > 0, "ZERO_SHARES");

        uint256 availableShares = _providerShares[skillId][msg.sender] - _lockedShares[skillId][msg.sender];
        require(availableShares >= sharesToLock, "INSUFFICIENT");

        uint64 unlock = uint64(block.timestamp) + unstakeCooldownSeconds;
        pendingUnstake[skillId][msg.sender] = UnstakeRequest({
            shares: sharesToLock,
            unlockTime: unlock
        });

        _lockedShares[skillId][msg.sender] = sharesToLock;
        emit UnstakeRequested(skillId, msg.sender, amount, sharesToLock, unlock);
    }

    function cancelUnstake(uint256 skillId) external {
        UnstakeRequest memory req = pendingUnstake[skillId][msg.sender];
        require(req.shares > 0, "NONE");
        delete pendingUnstake[skillId][msg.sender];
        _lockedShares[skillId][msg.sender] = 0;
    }

    function executeUnstake(uint256 skillId) external {
        UnstakeRequest memory req = pendingUnstake[skillId][msg.sender];
        require(req.shares > 0, "NONE");
        require(block.timestamp >= req.unlockTime, "LOCKED");

        uint8 oldLevel = getTrustLevel(skillId);
        SkillPool storage p = _pools[skillId];
        uint256 providerShares = _providerShares[skillId][msg.sender];
        require(providerShares >= req.shares, "INSUFFICIENT");

        uint256 assetsOut = _sharesToAssetsDown(p, req.shares);
        require(assetsOut > 0, "NOTHING_TO_WITHDRAW");

        delete pendingUnstake[skillId][msg.sender];
        _lockedShares[skillId][msg.sender] = 0;

        _providerShares[skillId][msg.sender] = providerShares - req.shares;
        p.totalShares -= req.shares;
        p.totalAssets -= assetsOut;

        (bool ok, ) = msg.sender.call{ value: assetsOut }("");
        require(ok, "TRANSFER_FAIL");

        emit Unstaked(skillId, msg.sender, assetsOut, req.shares);
        _emitLevelChangeIfNeeded(skillId, oldLevel);
    }

    function slash(uint256 skillId, uint256 amount, address recipient) external onlySlasher {
        require(recipient != address(0), "BAD_RECIPIENT");
        require(amount > 0, "ZERO");
        require(registry.skillExists(skillId), "SKILL_NOT_FOUND");

        uint8 oldLevel = getTrustLevel(skillId);
        SkillPool storage p = _pools[skillId];
        require(amount <= p.totalAssets, "TOO_MUCH");

        p.totalAssets -= amount;
        (bool ok, ) = recipient.call{ value: amount }("");
        require(ok, "TRANSFER_FAIL");

        emit Slashed(skillId, amount, recipient);
        _emitLevelChangeIfNeeded(skillId, oldLevel);
    }

    function getBoostUnits(uint256 skillId) public view returns (uint256) {
        (, SkillRegistry.RiskTier risk, ) = registry.getSkillCore(skillId);
        uint256 unit = boostUnitWei[risk];
        if (unit == 0) return 0;
        return _pools[skillId].totalAssets / unit;
    }

    function getTrustLevel(uint256 skillId) public view returns (uint8) {
        if (!registry.skillExists(skillId)) return 0;
        uint256 boosts = getBoostUnits(skillId);
        if (boosts >= L3_BOOSTS) return 3;
        if (boosts >= L2_BOOSTS) return 2;
        if (boosts >= L1_BOOSTS) return 1;
        return 0;
    }

    function getSkillStake(uint256 skillId) external view returns (uint256) {
        return _pools[skillId].totalAssets;
    }

    function getSkillShares(uint256 skillId) external view returns (uint256) {
        return _pools[skillId].totalShares;
    }

    function getProviderStake(uint256 skillId, address provider) external view returns (uint256) {
        return _sharesToAssetsDown(_pools[skillId], _providerShares[skillId][provider]);
    }

    function getProviderShares(uint256 skillId, address provider) external view returns (uint256) {
        return _providerShares[skillId][provider];
    }

    function getAvailableProviderShares(uint256 skillId, address provider) external view returns (uint256) {
        return _providerShares[skillId][provider] - _lockedShares[skillId][provider];
    }

    function _assetsToSharesDown(SkillPool storage p, uint256 assets) internal view returns (uint256) {
        if (p.totalShares == 0 || p.totalAssets == 0) return assets;
        return (assets * p.totalShares) / p.totalAssets;
    }

    function _assetsToSharesUp(SkillPool storage p, uint256 assets) internal view returns (uint256) {
        if (p.totalShares == 0 || p.totalAssets == 0) return assets;
        return ((assets * p.totalShares) + p.totalAssets - 1) / p.totalAssets;
    }

    function _sharesToAssetsDown(SkillPool storage p, uint256 shares) internal view returns (uint256) {
        if (p.totalShares == 0 || p.totalAssets == 0 || shares == 0) return 0;
        return (shares * p.totalAssets) / p.totalShares;
    }

    function _emitLevelChangeIfNeeded(uint256 skillId, uint8 oldLevel) internal {
        uint8 newLevel = getTrustLevel(skillId);
        if (newLevel != oldLevel) {
            emit TrustLevelChanged(skillId, oldLevel, newLevel);
        }
    }
}
