// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Governance
 * @notice Lightweight governance for Trusted ClawMon (Phase 10).
 *
 *  Overview
 *  ────────
 *   Owner-gated proposal creation with community stake-weighted voting.
 *   Designed for v1 parameter tuning — scoring weights, staking minimums,
 *   slash percentages, and insurance pool caps can all be changed through
 *   a proposal → vote → timelock → execute lifecycle.
 *
 *  Lifecycle
 *  ─────────
 *   createProposal  → owner submits a parameter-change proposal
 *   castVote         → any staker votes FOR/AGAINST, weight = their stake
 *   queueProposal    → once quorum + majority reached, owner queues for execution
 *   executeProposal  → after timelock delay, owner executes the change
 *   cancelProposal   → owner can cancel before execution
 *
 *  Parameters
 *  ──────────
 *   Governable parameters are identified by a bytes32 key.
 *   The contract stores a registry of current parameter values and tracks
 *   every change through proposals.
 *
 *  Deployed to Monad testnet.
 */
contract Governance {
    // ── Types ────────────────────────────────────────────────────────────

    enum ProposalStatus { Active, Queued, Executed, Cancelled, Defeated }

    enum VoteType { Against, For }

    struct Proposal {
        uint256 id;
        address proposer;
        bytes32 paramKey;           // parameter being changed
        uint256 oldValue;           // current value at proposal time
        uint256 newValue;           // proposed new value
        string  description;        // human-readable description
        uint256 createdAt;
        uint256 votingDeadline;
        uint256 executionTime;      // set when queued (block.timestamp + TIMELOCK)
        ProposalStatus status;
        uint256 forVotes;           // stake-weighted votes FOR
        uint256 againstVotes;       // stake-weighted votes AGAINST
        uint256 voterCount;         // number of unique voters
    }

    // ── Constants ─────────────────────────────────────────────────────────

    /// @notice Voting period: 3 days for production, compressed for demo.
    uint256 public constant VOTING_PERIOD = 3 days;

    /// @notice Timelock delay after queuing before execution is allowed.
    uint256 public constant TIMELOCK_DELAY = 1 days;

    /// @notice Quorum: minimum total stake-weighted votes required (in wei).
    ///         Set low for testnet/demo — 0.05 ETH of voting power.
    uint256 public constant QUORUM = 0.05 ether;

    /// @notice Minimum stake required to vote (prevents dust votes).
    uint256 public constant MIN_VOTE_STAKE = 0.001 ether;

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Auto-incrementing proposal counter.
    uint256 public nextProposalId;

    /// @notice All proposals by ID.
    mapping(uint256 => Proposal) public proposals;

    /// @notice Vote tracking: proposalId → voter → voted.
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @notice Vote record: proposalId → voter → vote weight.
    mapping(uint256 => mapping(address => uint256)) public voteWeight;

    /// @notice Vote direction: proposalId → voter → voteType.
    mapping(uint256 => mapping(address => VoteType)) public voteDirection;

    /// @notice Governable parameter registry: paramKey → current value.
    mapping(bytes32 => uint256) public parameters;

    /// @notice Track which parameters have been initialized.
    mapping(bytes32 => bool) public parameterExists;

    /// @notice Proposal IDs list for enumeration.
    uint256[] public proposalIds;

    /// @notice Parameter keys list for enumeration.
    bytes32[] public parameterKeys;

    // ── Events ────────────────────────────────────────────────────────────

    event ParameterInitialized(bytes32 indexed paramKey, uint256 value);
    event ParameterUpdated(bytes32 indexed paramKey, uint256 oldValue, uint256 newValue, uint256 indexed proposalId);

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 indexed paramKey,
        uint256 oldValue,
        uint256 newValue,
        string  description,
        uint256 votingDeadline
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        VoteType voteType,
        uint256 weight
    );

    event ProposalQueued(uint256 indexed proposalId, uint256 executionTime);
    event ProposalExecuted(uint256 indexed proposalId, bytes32 indexed paramKey, uint256 newValue);
    event ProposalCancelled(uint256 indexed proposalId);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;

        // Initialize default protocol parameters
        _initParam("SCORING_WEIGHT_NAIVE", 100);         // basis points (1.00x)
        _initParam("SCORING_WEIGHT_HARDENED", 150);       // 1.50x
        _initParam("SCORING_WEIGHT_STAKE", 200);          // 2.00x
        _initParam("MIN_STAKE_WEI", 0.01 ether);         // 0.01 ETH
        _initParam("SLASH_REPORTER_BPS", 4000);           // 40%
        _initParam("SLASH_INSURANCE_BPS", 3000);          // 30%
        _initParam("SLASH_TREASURY_BPS", 2000);           // 20%
        _initParam("SLASH_BURN_BPS", 1000);               // 10%
        _initParam("INSURANCE_MAX_PAYOUT_BPS", 5000);     // 50%
        _initParam("INSURANCE_POOL_CAP", 100 ether);      // 100 ETH
        _initParam("REVIEW_BOND_WEI", 0.001 ether);       // 0.001 ETH
        _initParam("UNBONDING_PERIOD", 7 days);           // 7 days
        _initParam("TEE_FRESHNESS_WINDOW", 24 hours);     // 24 hours
        _initParam("FOREIGN_STAKE_DISCOUNT_BPS", 5000);   // 50%
    }

    // ── Proposal Creation (Owner-Gated) ──────────────────────────────────

    /**
     * @notice Create a new governance proposal to change a protocol parameter.
     * @param paramKey     The parameter key (must already be initialized).
     * @param newValue     The proposed new value.
     * @param description  Human-readable description of the change and rationale.
     */
    function createProposal(
        bytes32 paramKey,
        uint256 newValue,
        string calldata description
    ) external onlyOwner returns (uint256) {
        require(parameterExists[paramKey], "Unknown parameter");
        require(newValue != parameters[paramKey], "No change");

        uint256 proposalId = nextProposalId++;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            paramKey: paramKey,
            oldValue: parameters[paramKey],
            newValue: newValue,
            description: description,
            createdAt: block.timestamp,
            votingDeadline: block.timestamp + VOTING_PERIOD,
            executionTime: 0,
            status: ProposalStatus.Active,
            forVotes: 0,
            againstVotes: 0,
            voterCount: 0
        });

        proposalIds.push(proposalId);

        emit ProposalCreated(
            proposalId,
            msg.sender,
            paramKey,
            parameters[paramKey],
            newValue,
            description,
            block.timestamp + VOTING_PERIOD
        );

        return proposalId;
    }

    // ── Voting (Stake-Weighted) ──────────────────────────────────────────

    /**
     * @notice Cast a stake-weighted vote on an active proposal.
     *         msg.value serves as the voter's stake weight for this vote.
     *         ETH is held by the contract until the proposal resolves,
     *         then refundable via withdrawVoteStake().
     * @param proposalId  The proposal to vote on.
     * @param support     VoteType.For (1) or VoteType.Against (0).
     */
    function castVote(
        uint256 proposalId,
        VoteType support
    ) external payable {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Not active");
        require(block.timestamp <= p.votingDeadline, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        require(msg.value >= MIN_VOTE_STAKE, "Below min vote stake");

        hasVoted[proposalId][msg.sender] = true;
        voteWeight[proposalId][msg.sender] = msg.value;
        voteDirection[proposalId][msg.sender] = support;
        p.voterCount++;

        if (support == VoteType.For) {
            p.forVotes += msg.value;
        } else {
            p.againstVotes += msg.value;
        }

        emit VoteCast(proposalId, msg.sender, support, msg.value);
    }

    // ── Queue for Execution ──────────────────────────────────────────────

    /**
     * @notice Queue a proposal for time-locked execution.
     *         Requires: voting period ended, quorum met, majority FOR.
     */
    function queueProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Not active");
        require(block.timestamp > p.votingDeadline, "Voting not ended");

        uint256 totalVotes = p.forVotes + p.againstVotes;
        require(totalVotes >= QUORUM, "Quorum not met");
        require(p.forVotes > p.againstVotes, "Majority not reached");

        p.status = ProposalStatus.Queued;
        p.executionTime = block.timestamp + TIMELOCK_DELAY;

        emit ProposalQueued(proposalId, p.executionTime);
    }

    // ── Execute Proposal ─────────────────────────────────────────────────

    /**
     * @notice Execute a queued proposal after the timelock has elapsed.
     *         Updates the parameter registry with the new value.
     */
    function executeProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Queued, "Not queued");
        require(block.timestamp >= p.executionTime, "Timelock not elapsed");

        uint256 oldValue = parameters[p.paramKey];
        parameters[p.paramKey] = p.newValue;
        p.status = ProposalStatus.Executed;

        emit ProposalExecuted(proposalId, p.paramKey, p.newValue);
        emit ParameterUpdated(p.paramKey, oldValue, p.newValue, proposalId);
    }

    // ── Cancel Proposal ──────────────────────────────────────────────────

    /**
     * @notice Cancel a proposal (Active or Queued). Owner-only.
     */
    function cancelProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(
            p.status == ProposalStatus.Active || p.status == ProposalStatus.Queued,
            "Cannot cancel"
        );

        p.status = ProposalStatus.Cancelled;

        emit ProposalCancelled(proposalId);
    }

    /**
     * @notice Mark a proposal as defeated if voting ended without quorum or majority.
     */
    function defeatProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Not active");
        require(block.timestamp > p.votingDeadline, "Voting not ended");

        uint256 totalVotes = p.forVotes + p.againstVotes;
        require(
            totalVotes < QUORUM || p.forVotes <= p.againstVotes,
            "Proposal passed - queue instead"
        );

        p.status = ProposalStatus.Defeated;
    }

    // ── Vote Stake Withdrawal ────────────────────────────────────────────

    /**
     * @notice Withdraw ETH staked for voting after proposal resolves.
     *         Only available once the proposal is Executed, Cancelled, or Defeated.
     */
    function withdrawVoteStake(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(
            p.status == ProposalStatus.Executed ||
            p.status == ProposalStatus.Cancelled ||
            p.status == ProposalStatus.Defeated,
            "Proposal still active"
        );
        require(hasVoted[proposalId][msg.sender], "Did not vote");

        uint256 amount = voteWeight[proposalId][msg.sender];
        require(amount > 0, "Already withdrawn");

        voteWeight[proposalId][msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdrawal failed");
    }

    // ── Admin: Initialize Parameters ─────────────────────────────────────

    /**
     * @notice Initialize a new governable parameter (owner-only, one-time per key).
     */
    function initParameter(bytes32 paramKey, uint256 value) external onlyOwner {
        require(!parameterExists[paramKey], "Already initialized");
        _initParam(paramKey, value);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    function getProposalCount() external view returns (uint256) {
        return proposalIds.length;
    }

    function getProposalCore(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        bytes32 paramKey,
        uint256 oldValue,
        uint256 newValue,
        string memory description,
        ProposalStatus status
    ) {
        Proposal storage p = proposals[proposalId];
        return (
            p.id,
            p.proposer,
            p.paramKey,
            p.oldValue,
            p.newValue,
            p.description,
            p.status
        );
    }

    function getProposalVoting(uint256 proposalId) external view returns (
        uint256 createdAt,
        uint256 votingDeadline,
        uint256 executionTime,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 voterCount
    ) {
        Proposal storage p = proposals[proposalId];
        return (
            p.createdAt,
            p.votingDeadline,
            p.executionTime,
            p.forVotes,
            p.againstVotes,
            p.voterCount
        );
    }

    function getParameter(bytes32 paramKey) external view returns (uint256) {
        require(parameterExists[paramKey], "Unknown parameter");
        return parameters[paramKey];
    }

    function getParameterCount() external view returns (uint256) {
        return parameterKeys.length;
    }

    function getParameterKeyAt(uint256 index) external view returns (bytes32) {
        return parameterKeys[index];
    }

    function getVoterInfo(uint256 proposalId, address voter) external view returns (
        bool voted,
        uint256 weight,
        VoteType direction
    ) {
        return (
            hasVoted[proposalId][voter],
            voteWeight[proposalId][voter],
            voteDirection[proposalId][voter]
        );
    }

    function getGovernanceStats() external view returns (
        uint256 totalProposals,
        uint256 activeProposals,
        uint256 queuedProposals,
        uint256 executedProposals,
        uint256 cancelledProposals,
        uint256 defeatedProposals,
        uint256 totalParameters
    ) {
        uint256 active = 0;
        uint256 queued = 0;
        uint256 executed = 0;
        uint256 cancelled = 0;
        uint256 defeated = 0;

        for (uint256 i = 0; i < proposalIds.length; i++) {
            ProposalStatus s = proposals[proposalIds[i]].status;
            if (s == ProposalStatus.Active) active++;
            else if (s == ProposalStatus.Queued) queued++;
            else if (s == ProposalStatus.Executed) executed++;
            else if (s == ProposalStatus.Cancelled) cancelled++;
            else if (s == ProposalStatus.Defeated) defeated++;
        }

        return (
            proposalIds.length,
            active,
            queued,
            executed,
            cancelled,
            defeated,
            parameterKeys.length
        );
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _initParam(bytes32 paramKey, uint256 value) internal {
        parameters[paramKey] = value;
        parameterExists[paramKey] = true;
        parameterKeys.push(paramKey);
        emit ParameterInitialized(paramKey, value);
    }

    // Allow contract to receive ETH (for vote stakes)
    receive() external payable {}
}
