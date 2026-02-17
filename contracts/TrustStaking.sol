// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TrustStaking
 * @notice Staking & slashing contract for Trusted ClawMon (Phase 4).
 *
 *  Roles
 *  ─────
 *   • Publisher  – stakes ETH against an agentId to list at Tier 2.
 *   • Curator    – delegates ETH to a staked agent, sharing reward/risk.
 *   • Arbiter    – (owner-gated for v1) can execute slashes.
 *
 *  Lifecycle
 *  ─────────
 *   stakeAgent  → agent is active, tier computed from totalStake
 *   delegate    → curators add ETH, totalStake rises
 *   slash       → arbiter/owner penalises agent; funds split to
 *                 reporter (40 %), insurance pool (30 %),
 *                 treasury (20 %), burned (10 %)
 *   initiateUnbonding → starts 7-day cooldown
 *   completeUnbonding → withdraw ETH after cooldown
 *
 *  Deployed to Monad testnet.
 */
contract TrustStaking {
    // ── Types ────────────────────────────────────────────────────────────

    enum StakeTier { None, Tier2Low, Tier2Mid, Tier2High }

    struct AgentStake {
        address publisher;
        uint256 stakeAmount;        // publisher's own ETH
        uint256 delegatedStake;     // sum of all curator delegations
        uint256 totalStake;         // stakeAmount + delegatedStake
        uint256 stakedAt;
        uint256 lastSlashTime;
        bool    active;
        StakeTier tier;
    }

    struct Unbonding {
        uint256 amount;
        uint256 availableAt;
    }

    struct SlashRecord {
        bytes32 agentId;
        uint256 amount;
        string  reason;
        address reporter;
        uint256 timestamp;
    }

    // ── Constants ─────────────────────────────────────────────────────────

    uint256 public constant MIN_STAKE         = 0.01 ether;  // low for testnet
    uint256 public constant TIER2_MID_STAKE   = 0.05 ether;
    uint256 public constant TIER2_HIGH_STAKE  = 0.25 ether;
    uint256 public constant UNBONDING_PERIOD  = 7 days;

    // Slash distribution basis points (total = 10 000)
    uint256 public constant REPORTER_BPS   = 4000; // 40 %
    uint256 public constant INSURANCE_BPS  = 3000; // 30 %
    uint256 public constant TREASURY_BPS   = 2000; // 20 %
    // Remaining 10 % is effectively burned (stays in contract / not sent)

    // Delegation revenue share: max 20 % of publisher payout goes to delegators
    uint256 public constant DELEGATOR_REVENUE_BPS = 2000;

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;
    address public insurancePool;
    address public treasury;

    mapping(bytes32 => AgentStake) public agentStakes;

    // curator → agentId → delegated amount
    mapping(address => mapping(bytes32 => uint256)) public delegations;

    // unbonding queue: user → agentId → Unbonding
    mapping(address => mapping(bytes32 => Unbonding)) public unbondings;

    // Slash history (append-only)
    SlashRecord[] public slashHistory;

    // Agent list for enumeration
    bytes32[] public agentIds;
    mapping(bytes32 => bool) private _agentExists;

    // Delegation revenue vault: curator → pending claimable revenue
    mapping(address => uint256) public pendingRevenue;
    // Per-agent list of delegator addresses for revenue distribution
    mapping(bytes32 => address[]) private _agentDelegators;
    mapping(bytes32 => mapping(address => bool)) private _isDelegator;

    // ── Events ────────────────────────────────────────────────────────────

    event AgentStaked(bytes32 indexed agentId, address indexed publisher, uint256 amount, StakeTier tier);
    event DelegationAdded(bytes32 indexed agentId, address indexed curator, uint256 amount);
    event DelegationRemoved(bytes32 indexed agentId, address indexed curator, uint256 amount);
    event AgentSlashed(bytes32 indexed agentId, uint256 slashAmount, string reason, address reporter);
    event UnbondingInitiated(bytes32 indexed agentId, address indexed requester, uint256 amount, uint256 availableAt);
    event UnbondingCompleted(bytes32 indexed agentId, address indexed requester, uint256 amount);
    event StakeIncreased(bytes32 indexed agentId, address indexed publisher, uint256 addedAmount, uint256 newTotal);
    event RevenueDeposited(bytes32 indexed agentId, uint256 amount, uint256 delegatorCount);
    event RevenueClaimed(address indexed curator, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _insurancePool, address _treasury) {
        owner = msg.sender;
        insurancePool = _insurancePool;
        treasury = _treasury;
    }

    // ── Publisher Staking ─────────────────────────────────────────────────

    /**
     * @notice Stake ETH for an agent to list it at Tier 2.
     * @param agentId  Keccak256 of the agent's string identifier.
     */
    function stakeAgent(bytes32 agentId) external payable {
        require(msg.value >= MIN_STAKE, "Below minimum stake");
        require(!agentStakes[agentId].active, "Already staked");

        StakeTier tier = _computeTier(msg.value);

        agentStakes[agentId] = AgentStake({
            publisher:      msg.sender,
            stakeAmount:    msg.value,
            delegatedStake: 0,
            totalStake:     msg.value,
            stakedAt:       block.timestamp,
            lastSlashTime:  0,
            active:         true,
            tier:           tier
        });

        if (!_agentExists[agentId]) {
            agentIds.push(agentId);
            _agentExists[agentId] = true;
        }

        emit AgentStaked(agentId, msg.sender, msg.value, tier);
    }

    /**
     * @notice Publisher adds more ETH to their existing stake.
     */
    function increaseStake(bytes32 agentId) external payable {
        AgentStake storage s = agentStakes[agentId];
        require(s.active, "Agent not active");
        require(msg.sender == s.publisher, "Not publisher");
        require(msg.value > 0, "Zero amount");

        s.stakeAmount += msg.value;
        s.totalStake  += msg.value;
        s.tier = _computeTier(s.totalStake);

        emit StakeIncreased(agentId, msg.sender, msg.value, s.totalStake);
    }

    // ── Curator Delegation ────────────────────────────────────────────────

    /**
     * @notice Delegate ETH to a staked agent. Delegators share slashing risk.
     */
    function delegate(bytes32 agentId) external payable {
        AgentStake storage s = agentStakes[agentId];
        require(s.active, "Agent not active");
        require(msg.value > 0, "Zero delegation");

        delegations[msg.sender][agentId] += msg.value;
        s.delegatedStake += msg.value;
        s.totalStake     += msg.value;
        s.tier = _computeTier(s.totalStake);

        // Track delegator address for revenue distribution
        if (!_isDelegator[agentId][msg.sender]) {
            _agentDelegators[agentId].push(msg.sender);
            _isDelegator[agentId][msg.sender] = true;
        }

        emit DelegationAdded(agentId, msg.sender, msg.value);
    }

    // ── Slashing ──────────────────────────────────────────────────────────

    /**
     * @notice Slash an agent's stake. Owner-gated for v1 (arbiter committee later).
     * @param agentId      Agent to slash.
     * @param basisPoints  Percentage in basis points (e.g. 5000 = 50 %).
     * @param reason       Human-readable reason for the slash.
     * @param reporter     Address that reported the offense (receives 40 %).
     */
    function slash(
        bytes32 agentId,
        uint256 basisPoints,
        string calldata reason,
        address reporter
    ) external onlyOwner {
        AgentStake storage s = agentStakes[agentId];
        require(s.active, "Agent not active");
        require(basisPoints > 0 && basisPoints <= 10000, "Invalid basis points");

        uint256 slashAmount = s.totalStake * basisPoints / 10000;
        require(slashAmount > 0, "Nothing to slash");

        // Proportional reduction: publisher first, then delegated
        uint256 publisherSlash = s.stakeAmount * basisPoints / 10000;
        uint256 delegatedSlash = slashAmount - publisherSlash;

        s.stakeAmount    -= publisherSlash;
        s.delegatedStake -= delegatedSlash;
        s.totalStake     -= slashAmount;
        s.lastSlashTime   = block.timestamp;
        s.tier = _computeTier(s.totalStake);

        // If total stake falls below minimum, deactivate
        if (s.totalStake < MIN_STAKE) {
            s.active = false;
        }

        // Distribute slashed funds
        uint256 toReporter  = slashAmount * REPORTER_BPS  / 10000;
        uint256 toInsurance = slashAmount * INSURANCE_BPS / 10000;
        uint256 toTreasury  = slashAmount * TREASURY_BPS  / 10000;
        // remainder is burned (stays in contract)

        if (reporter != address(0) && toReporter > 0) {
            (bool ok1,) = reporter.call{value: toReporter}("");
            require(ok1, "Reporter transfer failed");
        }
        if (insurancePool != address(0) && toInsurance > 0) {
            (bool ok2,) = insurancePool.call{value: toInsurance}("");
            require(ok2, "Insurance transfer failed");
        }
        if (treasury != address(0) && toTreasury > 0) {
            (bool ok3,) = treasury.call{value: toTreasury}("");
            require(ok3, "Treasury transfer failed");
        }

        slashHistory.push(SlashRecord({
            agentId:   agentId,
            amount:    slashAmount,
            reason:    reason,
            reporter:  reporter,
            timestamp: block.timestamp
        }));

        emit AgentSlashed(agentId, slashAmount, reason, reporter);
    }

    // ── Unbonding / Withdrawal ────────────────────────────────────────────

    /**
     * @notice Begin unstaking. Funds are locked for UNBONDING_PERIOD.
     * @param agentId  The agent to unstake from.
     * @param amount   Amount to unbond (must be ≤ caller's position).
     */
    function initiateUnbonding(bytes32 agentId, uint256 amount) external {
        AgentStake storage s = agentStakes[agentId];
        require(s.active || s.totalStake > 0, "No stake to unbond");

        Unbonding storage u = unbondings[msg.sender][agentId];
        require(u.amount == 0, "Existing unbonding pending");

        if (msg.sender == s.publisher) {
            require(amount <= s.stakeAmount, "Exceeds publisher stake");
            s.stakeAmount -= amount;
        } else {
            require(amount <= delegations[msg.sender][agentId], "Exceeds delegation");
            delegations[msg.sender][agentId] -= amount;
            s.delegatedStake -= amount;
        }

        s.totalStake -= amount;
        s.tier = _computeTier(s.totalStake);

        if (s.totalStake < MIN_STAKE && s.active) {
            s.active = false;
        }

        uint256 availableAt = block.timestamp + UNBONDING_PERIOD;
        unbondings[msg.sender][agentId] = Unbonding({
            amount:      amount,
            availableAt: availableAt
        });

        emit UnbondingInitiated(agentId, msg.sender, amount, availableAt);
    }

    /**
     * @notice Complete withdrawal after the unbonding period elapses.
     */
    function completeUnbonding(bytes32 agentId) external {
        Unbonding storage u = unbondings[msg.sender][agentId];
        require(u.amount > 0, "No pending unbonding");
        require(block.timestamp >= u.availableAt, "Still in unbonding period");

        uint256 amount = u.amount;
        u.amount = 0;
        u.availableAt = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdrawal transfer failed");

        emit UnbondingCompleted(agentId, msg.sender, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getAgentStake(bytes32 agentId) external view returns (
        address publisher,
        uint256 stakeAmount,
        uint256 delegatedStake,
        uint256 totalStake,
        uint256 stakedAt,
        uint256 lastSlashTime,
        bool    active,
        StakeTier tier
    ) {
        AgentStake storage s = agentStakes[agentId];
        return (
            s.publisher,
            s.stakeAmount,
            s.delegatedStake,
            s.totalStake,
            s.stakedAt,
            s.lastSlashTime,
            s.active,
            s.tier
        );
    }

    function getSlashHistoryLength() external view returns (uint256) {
        return slashHistory.length;
    }

    function getSlashRecord(uint256 index) external view returns (
        bytes32 agentId,
        uint256 amount,
        string memory reason,
        address reporter,
        uint256 timestamp
    ) {
        SlashRecord storage r = slashHistory[index];
        return (r.agentId, r.amount, r.reason, r.reporter, r.timestamp);
    }

    function getAgentSlashHistory(bytes32 agentId) external view returns (SlashRecord[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < slashHistory.length; i++) {
            if (slashHistory[i].agentId == agentId) count++;
        }

        SlashRecord[] memory result = new SlashRecord[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < slashHistory.length; i++) {
            if (slashHistory[i].agentId == agentId) {
                result[idx++] = slashHistory[i];
            }
        }
        return result;
    }

    function getAgentCount() external view returns (uint256) {
        return agentIds.length;
    }

    function isAgentActive(bytes32 agentId) external view returns (bool) {
        return agentStakes[agentId].active;
    }

    function getDelegation(address curator, bytes32 agentId) external view returns (uint256) {
        return delegations[curator][agentId];
    }

    function getUnbonding(address user, bytes32 agentId) external view returns (uint256 amount, uint256 availableAt) {
        Unbonding storage u = unbondings[user][agentId];
        return (u.amount, u.availableAt);
    }

    /**
     * @notice Get the timestamp when an agent was originally staked.
     * @param agentId  The agent identifier.
     * @return stakedAt  Unix timestamp (seconds), 0 if never staked.
     */
    function getStakedAt(bytes32 agentId) external view returns (uint256) {
        return agentStakes[agentId].stakedAt;
    }

    /**
     * @notice Get the "clean tenure" of an agent in seconds.
     *         Clean tenure = time since the later of (stakedAt, lastSlashTime).
     *         Resets to zero on each slash, rewarding incident-free longevity.
     * @param agentId  The agent identifier.
     * @return tenure  Clean tenure in seconds, 0 if not staked.
     */
    function getTenure(bytes32 agentId) external view returns (uint256) {
        AgentStake storage s = agentStakes[agentId];
        if (s.stakedAt == 0) return 0;
        uint256 tenureStart = s.lastSlashTime > s.stakedAt ? s.lastSlashTime : s.stakedAt;
        return block.timestamp - tenureStart;
    }

    // ── Delegation Revenue ─────────────────────────────────────────────────

    /**
     * @notice Deposit revenue for an agent's delegators (called by SkillPaywall).
     *         Distributes incoming ETH pro-rata across all delegators of the agent.
     * @param agentId  The agent whose delegators receive revenue.
     */
    function depositRevenue(bytes32 agentId) external payable {
        require(msg.value > 0, "Zero revenue");
        AgentStake storage s = agentStakes[agentId];
        require(s.delegatedStake > 0, "No delegators");

        address[] storage delegatorList = _agentDelegators[agentId];
        uint256 distributed = 0;

        for (uint256 i = 0; i < delegatorList.length; i++) {
            address curator = delegatorList[i];
            uint256 curatorStake = delegations[curator][agentId];
            if (curatorStake == 0) continue;

            uint256 share = (msg.value * curatorStake) / s.delegatedStake;
            pendingRevenue[curator] += share;
            distributed += share;
        }

        // Any dust from rounding stays in the contract
        emit RevenueDeposited(agentId, msg.value, delegatorList.length);
    }

    /**
     * @notice Claim all accumulated delegation revenue.
     */
    function claimRevenue() external {
        uint256 amount = pendingRevenue[msg.sender];
        require(amount > 0, "No revenue to claim");

        pendingRevenue[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Revenue transfer failed");

        emit RevenueClaimed(msg.sender, amount);
    }

    /**
     * @notice View pending revenue for a curator.
     */
    function getPendingRevenue(address curator) external view returns (uint256) {
        return pendingRevenue[curator];
    }

    /**
     * @notice Get the number of delegators for an agent.
     */
    function getDelegatorCount(bytes32 agentId) external view returns (uint256) {
        return _agentDelegators[agentId].length;
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _computeTier(uint256 total) internal pure returns (StakeTier) {
        if (total >= TIER2_HIGH_STAKE) return StakeTier.Tier2High;
        if (total >= TIER2_MID_STAKE)  return StakeTier.Tier2Mid;
        if (total >= MIN_STAKE)        return StakeTier.Tier2Low;
        return StakeTier.None;
    }

    // Allow contract to receive ETH (for slashing remainder / burn)
    receive() external payable {}
}
