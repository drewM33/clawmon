// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITrustStakingForInsurance
 * @notice Minimal interface for cross-contract calls to TrustStaking.
 */
interface ITrustStakingForInsurance {
    function agentStakes(bytes32 agentId) external view returns (
        address publisher,
        uint256 stakeAmount,
        uint256 delegatedStake,
        uint256 totalStake,
        uint256 stakedAt,
        uint256 lastSlashTime,
        bool    active,
        uint8   tier
    );
    function getTenure(bytes32 agentId) external view returns (uint256);
    function getDelegation(address curator, bytes32 agentId) external view returns (uint256);
    function getAgentCount() external view returns (uint256);
    function agentIds(uint256 index) external view returns (bytes32);
}

/**
 * @title InsurancePool
 * @notice Community insurance pool for Trusted ClawMon (Phase 6).
 *
 *  Funding
 *  ───────
 *   • 30 % of every slash from TrustStaking flows here automatically.
 *   • 5 % of protocol treasury revenue (ongoing).
 *   • Direct deposits from any address.
 *
 *  Claims
 *  ──────
 *   • Users harmed by a slashed (confirmed-malicious) skill submit a claim.
 *   • Arbiters (owner-gated for v1) vote to approve/reject.
 *   • Approved claims are paid out, capped at 50 % of pool balance.
 *
 *  Lifecycle
 *  ─────────
 *   receive()       → pool grows from slash proceeds / direct deposits
 *   submitClaim     → claimant files a loss claim against a slashed skill
 *   voteClaim       → arbiter casts approve/reject vote
 *   executePayout   → once quorum reached, payout or rejection is finalised
 *   rejectClaim     → owner fast-path rejection for invalid claims
 *
 *  Deployed to Monad testnet.
 */
contract InsurancePool {
    // ── Types ────────────────────────────────────────────────────────────

    enum ClaimStatus { Pending, Approved, Rejected, Paid }

    struct Claim {
        uint256 id;
        address claimant;
        bytes32 agentId;            // the malicious skill
        uint256 amount;             // claimed loss in wei
        bytes32 evidenceHash;       // IPFS / on-chain evidence reference
        uint256 submittedAt;
        ClaimStatus status;
        uint256 payoutAmount;       // actual payout (may be less than claimed)
        uint256 paidAt;
        uint256 approveVotes;
        uint256 rejectVotes;
    }

    // ── Constants ─────────────────────────────────────────────────────────

    /// @notice Max payout per claim: 50 % of pool balance at time of execution.
    uint256 public constant MAX_PAYOUT_BPS = 5000; // 50 % in basis points

    /// @notice Number of approve votes required for payout.
    uint256 public constant QUORUM = 3;

    /// @notice Minimum claim amount (prevents dust claims).
    uint256 public constant MIN_CLAIM = 0.001 ether;

    // ── Yield Constants ─────────────────────────────────────────────────

    /// @notice Max 10 % of surplus distributed per epoch
    uint256 public constant YIELD_CAP_BPS = 1000;

    /// @notice Yield distribution epoch: 30 days
    uint256 public constant YIELD_EPOCH = 30 days;

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Total ETH held for insurance payouts.
    uint256 public poolBalance;

    /// @notice Lifetime deposits into the pool.
    uint256 public totalDeposited;

    /// @notice Lifetime payouts from the pool.
    uint256 public totalPaidOut;

    /// @notice Number of claims ever submitted.
    uint256 public nextClaimId;

    /// @notice All claims by ID.
    mapping(uint256 => Claim) public claims;

    /// @notice Arbiter vote tracking: claimId → voter → voted.
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @notice Agents that have been confirmed slashed (eligible for claims).
    mapping(bytes32 => bool) public slashedAgents;

    /// @notice Claim IDs list for enumeration.
    uint256[] public claimIds;

    /// @notice Reference to TrustStaking for yield distribution lookups
    ITrustStakingForInsurance public trustStaking;

    /// @notice Surplus threshold: pool balance must exceed this for yield to be available
    uint256 public surplusThreshold = 1 ether;

    /// @notice Timestamp of last yield epoch start
    uint256 public lastYieldEpoch;

    /// @notice Total yield distributed in the current epoch
    uint256 public epochYieldDistributed;

    /// @notice Per-staker yield already claimed (staker address → total claimed)
    mapping(address => uint256) public yieldClaimed;

    // ── Events ────────────────────────────────────────────────────────────

    event Deposited(address indexed from, uint256 amount, uint256 newPoolBalance);
    event ClaimSubmitted(uint256 indexed claimId, address indexed claimant, bytes32 indexed agentId, uint256 amount);
    event ClaimVoted(uint256 indexed claimId, address indexed voter, bool approve);
    event ClaimApproved(uint256 indexed claimId, uint256 payoutAmount);
    event ClaimRejected(uint256 indexed claimId);
    event ClaimPaid(uint256 indexed claimId, address indexed claimant, uint256 amount);
    event AgentMarkedSlashed(bytes32 indexed agentId);
    event YieldClaimed(address indexed staker, bytes32 indexed agentId, uint256 amount);
    event SurplusThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event TrustStakingUpdated(address oldStaking, address newStaking);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── Receive ───────────────────────────────────────────────────────────

    /// @notice Accept ETH deposits (from TrustStaking slash, treasury, or direct).
    receive() external payable {
        poolBalance += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value, poolBalance);
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /// @notice Mark an agent as slashed so claims can be filed against it.
    function markAgentSlashed(bytes32 agentId) external onlyOwner {
        slashedAgents[agentId] = true;
        emit AgentMarkedSlashed(agentId);
    }

    /// @notice Direct deposit into the pool (alternative to plain ETH send).
    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        poolBalance += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value, poolBalance);
    }

    // ── Claims ────────────────────────────────────────────────────────────

    /**
     * @notice Submit a claim for compensation after a skill is slashed.
     * @param agentId       The slashed skill's keccak256 identifier.
     * @param lossAmount    Claimed loss in wei.
     * @param evidenceHash  Reference to evidence (IPFS hash, on-chain message ID, etc.).
     */
    function submitClaim(
        bytes32 agentId,
        uint256 lossAmount,
        bytes32 evidenceHash
    ) external {
        require(slashedAgents[agentId], "Agent not slashed");
        require(lossAmount >= MIN_CLAIM, "Below minimum claim");
        require(poolBalance > 0, "Pool empty");

        uint256 claimId = nextClaimId++;

        claims[claimId] = Claim({
            id: claimId,
            claimant: msg.sender,
            agentId: agentId,
            amount: lossAmount,
            evidenceHash: evidenceHash,
            submittedAt: block.timestamp,
            status: ClaimStatus.Pending,
            payoutAmount: 0,
            paidAt: 0,
            approveVotes: 0,
            rejectVotes: 0
        });

        claimIds.push(claimId);

        emit ClaimSubmitted(claimId, msg.sender, agentId, lossAmount);
    }

    // ── Voting ────────────────────────────────────────────────────────────

    /**
     * @notice Arbiter votes to approve or reject a claim.
     *         Owner-gated for v1 (any caller gated by onlyOwner; production
     *         would use a staked-arbiter registry).
     * @param claimId  The claim to vote on.
     * @param approve  True = approve, false = reject.
     */
    function voteClaim(uint256 claimId, bool approve) external onlyOwner {
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.Pending, "Not pending");
        require(!hasVoted[claimId][msg.sender], "Already voted");

        hasVoted[claimId][msg.sender] = true;

        if (approve) {
            c.approveVotes++;
            emit ClaimVoted(claimId, msg.sender, true);

            // Auto-execute if quorum reached
            if (c.approveVotes >= QUORUM) {
                _approveClaim(claimId);
            }
        } else {
            c.rejectVotes++;
            emit ClaimVoted(claimId, msg.sender, false);

            if (c.rejectVotes >= QUORUM) {
                c.status = ClaimStatus.Rejected;
                emit ClaimRejected(claimId);
            }
        }
    }

    /**
     * @notice Owner fast-path: directly approve a claim (bypasses voting for v1 demo).
     */
    function approveClaim(uint256 claimId) external onlyOwner {
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.Pending, "Not pending");
        _approveClaim(claimId);
    }

    /**
     * @notice Owner fast-path: directly reject a claim.
     */
    function rejectClaim(uint256 claimId) external onlyOwner {
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.Pending, "Not pending");
        c.status = ClaimStatus.Rejected;
        emit ClaimRejected(claimId);
    }

    // ── Yield Distribution ──────────────────────────────────────────────

    /**
     * @notice Claim yield from the insurance pool surplus.
     *         Yield is available when poolBalance > surplusThreshold.
     *         Capped at YIELD_CAP_BPS (10 %) of surplus per 30-day epoch.
     *         Caller's share is pro-rata by their stake in the given agent.
     * @param agentId  The agent the caller has staked/delegated to.
     */
    function claimYield(bytes32 agentId) external {
        require(address(trustStaking) != address(0), "TrustStaking not set");
        require(poolBalance > surplusThreshold, "No surplus");

        // Reset epoch if enough time has passed
        if (block.timestamp >= lastYieldEpoch + YIELD_EPOCH) {
            lastYieldEpoch = block.timestamp;
            epochYieldDistributed = 0;
        }

        uint256 surplus = poolBalance - surplusThreshold;
        uint256 epochCap = (surplus * YIELD_CAP_BPS) / 10000;
        uint256 remainingEpochYield = epochCap > epochYieldDistributed
            ? epochCap - epochYieldDistributed
            : 0;
        require(remainingEpochYield > 0, "Epoch yield exhausted");

        // Determine caller's stake in this agent
        (address publisher, uint256 stakeAmount, , uint256 totalStake, , , bool active, ) =
            trustStaking.agentStakes(agentId);
        require(active, "Agent not active");
        require(totalStake > 0, "No stake");

        uint256 callerStake;
        if (msg.sender == publisher) {
            callerStake = stakeAmount;
        } else {
            callerStake = trustStaking.getDelegation(msg.sender, agentId);
        }
        require(callerStake > 0, "No stake in this agent");

        // Pro-rata share of remaining epoch yield
        uint256 yieldAmount = (remainingEpochYield * callerStake) / totalStake;
        require(yieldAmount > 0, "Yield too small");

        // Cap to available pool balance (safety)
        if (yieldAmount > poolBalance) {
            yieldAmount = poolBalance;
        }

        epochYieldDistributed += yieldAmount;
        yieldClaimed[msg.sender] += yieldAmount;
        poolBalance -= yieldAmount;

        (bool ok,) = msg.sender.call{value: yieldAmount}("");
        require(ok, "Yield transfer failed");

        emit YieldClaimed(msg.sender, agentId, yieldAmount);
    }

    /**
     * @notice View the available yield for a staker on a given agent.
     */
    function getAvailableYield(bytes32 agentId, address staker) external view returns (uint256) {
        if (address(trustStaking) == address(0)) return 0;
        if (poolBalance <= surplusThreshold) return 0;

        uint256 surplus = poolBalance - surplusThreshold;
        uint256 epochCap = (surplus * YIELD_CAP_BPS) / 10000;

        // Check if epoch has rolled over
        uint256 currentEpochDistributed = (block.timestamp >= lastYieldEpoch + YIELD_EPOCH)
            ? 0
            : epochYieldDistributed;

        uint256 remainingEpochYield = epochCap > currentEpochDistributed
            ? epochCap - currentEpochDistributed
            : 0;
        if (remainingEpochYield == 0) return 0;

        (address publisher, uint256 stakeAmount, , uint256 totalStake, , , bool active, ) =
            trustStaking.agentStakes(agentId);
        if (!active || totalStake == 0) return 0;

        uint256 stakerStake;
        if (staker == publisher) {
            stakerStake = stakeAmount;
        } else {
            stakerStake = trustStaking.getDelegation(staker, agentId);
        }
        if (stakerStake == 0) return 0;

        return (remainingEpochYield * stakerStake) / totalStake;
    }

    /**
     * @notice Set the TrustStaking contract reference.
     */
    function setTrustStaking(address _trustStaking) external onlyOwner {
        address old = address(trustStaking);
        trustStaking = ITrustStakingForInsurance(_trustStaking);
        emit TrustStakingUpdated(old, _trustStaking);
    }

    /**
     * @notice Update the surplus threshold.
     */
    function setSurplusThreshold(uint256 newThreshold) external onlyOwner {
        uint256 old = surplusThreshold;
        surplusThreshold = newThreshold;
        emit SurplusThresholdUpdated(old, newThreshold);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getClaimCount() external view returns (uint256) {
        return claimIds.length;
    }

    function getClaim(uint256 claimId) external view returns (
        uint256 id,
        address claimant,
        bytes32 agentId,
        uint256 amount,
        bytes32 evidenceHash,
        uint256 submittedAt,
        ClaimStatus status,
        uint256 payoutAmount,
        uint256 paidAt,
        uint256 approveVotes,
        uint256 rejectVotes
    ) {
        Claim storage c = claims[claimId];
        return (
            c.id,
            c.claimant,
            c.agentId,
            c.amount,
            c.evidenceHash,
            c.submittedAt,
            c.status,
            c.payoutAmount,
            c.paidAt,
            c.approveVotes,
            c.rejectVotes
        );
    }

    function getPoolStats() external view returns (
        uint256 _poolBalance,
        uint256 _totalDeposited,
        uint256 _totalPaidOut,
        uint256 _totalClaims,
        uint256 _pendingClaims,
        uint256 _approvedClaims,
        uint256 _rejectedClaims,
        uint256 _paidClaims
    ) {
        uint256 pending = 0;
        uint256 approved = 0;
        uint256 rejected = 0;
        uint256 paid = 0;

        for (uint256 i = 0; i < claimIds.length; i++) {
            ClaimStatus s = claims[claimIds[i]].status;
            if (s == ClaimStatus.Pending) pending++;
            else if (s == ClaimStatus.Approved) approved++;
            else if (s == ClaimStatus.Rejected) rejected++;
            else if (s == ClaimStatus.Paid) paid++;
        }

        return (
            poolBalance,
            totalDeposited,
            totalPaidOut,
            claimIds.length,
            pending,
            approved,
            rejected,
            paid
        );
    }

    function isAgentSlashed(bytes32 agentId) external view returns (bool) {
        return slashedAgents[agentId];
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _approveClaim(uint256 claimId) internal {
        Claim storage c = claims[claimId];

        // Payout = min(claimed amount, 50% of pool)
        uint256 maxPayout = poolBalance * MAX_PAYOUT_BPS / 10000;
        uint256 payout = c.amount < maxPayout ? c.amount : maxPayout;

        c.status = ClaimStatus.Paid;
        c.payoutAmount = payout;
        c.paidAt = block.timestamp;

        poolBalance -= payout;
        totalPaidOut += payout;

        (bool ok,) = c.claimant.call{value: payout}("");
        require(ok, "Payout transfer failed");

        emit ClaimApproved(claimId, payout);
        emit ClaimPaid(claimId, c.claimant, payout);
    }
}
