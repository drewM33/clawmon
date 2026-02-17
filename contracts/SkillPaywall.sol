// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITrustStaking
 * @notice Minimal interface for cross-contract calls to TrustStaking.
 */
interface ITrustStaking {
    function getStakedAt(bytes32 agentId) external view returns (uint256);
    function getTenure(bytes32 agentId) external view returns (uint256);
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
    function depositRevenue(bytes32 agentId) external payable;
}

/**
 * @title SkillPaywall
 * @notice x402 micropayment contract for Trusted ClawMon (Phase 9).
 *
 *  Per-use skill payments with trust-tier-influenced pricing.
 *  Fee distribution:
 *    80% → Skill publisher
 *    10% → Protocol treasury
 *    10% → Insurance pool
 *
 *  Trust tiers affect pricing:
 *    AAA/AA/A (premium) → higher base price
 *    BBB/BB/B (standard) → default price
 *    CCC/CC/C (budget)   → lower / free
 *
 *  Payment history feeds back into the scoring engine as a trust signal:
 *    - Skills with consistent payment volume gain credibility
 *    - Payment velocity anomalies can flag suspicious activity
 */
contract SkillPaywall {
    // ── Types ────────────────────────────────────────────────────────────

    struct SkillPricing {
        uint256 pricePerCall;       // wei per invocation
        uint8   trustTier;          // 0=C .. 8=AAA
        bool    active;
        address publisher;
    }

    struct PaymentRecord {
        uint256 id;
        bytes32 agentId;
        address caller;
        address publisher;
        uint256 amount;
        uint256 publisherPayout;
        uint256 protocolPayout;
        uint256 insurancePayout;
        uint256 timestamp;
    }

    // ── Constants ─────────────────────────────────────────────────────────

    /// @notice Publisher share: 80% (8000 bps)
    uint256 public constant PUBLISHER_BPS = 8000;

    /// @notice Protocol treasury share: 10% (1000 bps)
    uint256 public constant PROTOCOL_BPS = 1000;

    /// @notice Insurance pool share: 10% (1000 bps)
    uint256 public constant INSURANCE_BPS = 1000;

    /// @notice Total basis points (must sum to 10000)
    uint256 public constant TOTAL_BPS = 10000;

    /// @notice Minimum payment amount
    uint256 public constant MIN_PAYMENT = 0.0001 ether;

    // ── Trust tier price multipliers (in basis points, 10000 = 1.0x) ─────

    /// @notice Premium tiers (AAA=8, AA=7, A=6) charge 2x base
    uint256 public constant PREMIUM_MULTIPLIER_BPS = 20000;

    /// @notice Standard tiers (BBB=5, BB=4, B=3) charge 1x base
    uint256 public constant STANDARD_MULTIPLIER_BPS = 10000;

    /// @notice Budget tiers (CCC=2, CC=1, C=0) charge 0.5x base (or free)
    uint256 public constant BUDGET_MULTIPLIER_BPS = 5000;

    // ── Tenure Discount Constants ────────────────────────────────────────

    /// @notice Max discount on protocol fee for tenured publishers (10% = 1000 bps)
    uint256 public constant TENURE_DISCOUNT_MAX_BPS = 1000;

    /// @notice Time to reach full tenure discount (90 days)
    uint256 public constant TENURE_TARGET = 90 days;

    /// @notice Max share of publisher payout directed to delegators (20% = 2000 bps)
    uint256 public constant DELEGATOR_SHARE_BPS = 2000;

    // ── State ─────────────────────────────────────────────────────────────

    address public owner;
    address public protocolTreasury;
    address public insurancePool;

    /// @notice Reference to TrustStaking contract for tenure + delegation lookups
    ITrustStaking public trustStaking;

    /// @notice Next payment ID
    uint256 public nextPaymentId;

    /// @notice Skill pricing by agentId hash
    mapping(bytes32 => SkillPricing) public skillPricing;

    /// @notice Payment records by ID
    mapping(uint256 => PaymentRecord) public payments;

    /// @notice Payment IDs for enumeration
    uint256[] public paymentIds;

    /// @notice Total protocol revenue collected
    uint256 public totalProtocolRevenue;

    /// @notice Total publisher payouts
    uint256 public totalPublisherPayouts;

    /// @notice Total insurance contributions
    uint256 public totalInsuranceContributions;

    /// @notice Total payments processed
    uint256 public totalPaymentsProcessed;

    /// @notice Per-skill payment count
    mapping(bytes32 => uint256) public skillPaymentCount;

    /// @notice Per-skill total revenue
    mapping(bytes32 => uint256) public skillTotalRevenue;

    /// @notice Per-caller payment count
    mapping(address => uint256) public callerPaymentCount;

    /// @notice Registered skills list for enumeration
    bytes32[] public registeredSkills;

    // ── Events ────────────────────────────────────────────────────────────

    event SkillRegistered(bytes32 indexed agentId, address indexed publisher, uint256 pricePerCall, uint8 trustTier);
    event SkillPriceUpdated(bytes32 indexed agentId, uint256 oldPrice, uint256 newPrice, uint8 newTier);
    event PaymentProcessed(
        uint256 indexed paymentId,
        bytes32 indexed agentId,
        address indexed caller,
        uint256 amount,
        uint256 publisherPayout,
        uint256 protocolPayout,
        uint256 insurancePayout
    );
    event ProtocolTreasuryUpdated(address oldTreasury, address newTreasury);
    event InsurancePoolUpdated(address oldPool, address newPool);
    event TrustStakingUpdated(address oldStaking, address newStaking);

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _protocolTreasury, address _insurancePool) {
        require(_protocolTreasury != address(0), "Invalid treasury");
        require(_insurancePool != address(0), "Invalid insurance pool");
        owner = msg.sender;
        protocolTreasury = _protocolTreasury;
        insurancePool = _insurancePool;
    }

    // ── Skill Registration ───────────────────────────────────────────────

    /**
     * @notice Register a skill with pricing. Only owner can register (v1).
     * @param agentId     keccak256 hash of the skill name
     * @param publisher   Address that receives publisher share
     * @param pricePerCall Base price in wei per invocation
     * @param trustTier   Trust tier (0=C to 8=AAA)
     */
    function registerSkill(
        bytes32 agentId,
        address publisher,
        uint256 pricePerCall,
        uint8 trustTier
    ) external onlyOwner {
        require(publisher != address(0), "Invalid publisher");
        require(pricePerCall >= MIN_PAYMENT, "Below min price");
        require(trustTier <= 8, "Invalid tier");
        require(!skillPricing[agentId].active, "Already registered");

        skillPricing[agentId] = SkillPricing({
            pricePerCall: pricePerCall,
            trustTier: trustTier,
            active: true,
            publisher: publisher
        });

        registeredSkills.push(agentId);

        emit SkillRegistered(agentId, publisher, pricePerCall, trustTier);
    }

    /**
     * @notice Update skill pricing and trust tier.
     */
    function updateSkillPricing(
        bytes32 agentId,
        uint256 newPrice,
        uint8 newTier
    ) external onlyOwner {
        require(skillPricing[agentId].active, "Not registered");
        require(newPrice >= MIN_PAYMENT, "Below min price");
        require(newTier <= 8, "Invalid tier");

        uint256 oldPrice = skillPricing[agentId].pricePerCall;
        skillPricing[agentId].pricePerCall = newPrice;
        skillPricing[agentId].trustTier = newTier;

        emit SkillPriceUpdated(agentId, oldPrice, newPrice, newTier);
    }

    // ── Payment Processing ───────────────────────────────────────────────

    /**
     * @notice Pay to invoke a skill. Caller sends ETH >= effective price.
     *         Effective price = basePrice * tierMultiplier / 10000.
     *         Fee is split: 80% publisher, 10% protocol, 10% insurance.
     * @param agentId  The skill to pay for
     */
    function payForSkill(bytes32 agentId) external payable {
        SkillPricing storage pricing = skillPricing[agentId];
        require(pricing.active, "Skill not registered");

        uint256 effectivePrice = getEffectivePrice(agentId);
        require(msg.value >= effectivePrice, "Insufficient payment");

        uint256 amount = msg.value;

        // Compute fee split (tenure-adjusted) and delegation data
        (uint256 publisherPayout, uint256 protocolPayout, uint256 insurancePayout,
         uint256 delegatorPayout) = _computePaymentSplit(agentId, amount);

        // Record payment and update counters
        uint256 paymentId = _recordPayment(
            agentId, pricing.publisher, amount,
            publisherPayout, protocolPayout, insurancePayout
        );

        // Transfer funds
        _executeTransfers(
            agentId, pricing.publisher,
            publisherPayout, protocolPayout, insurancePayout, delegatorPayout
        );

        emit PaymentProcessed(
            paymentId, agentId, msg.sender, amount,
            publisherPayout, protocolPayout, insurancePayout
        );
    }

    // ── View Functions ───────────────────────────────────────────────────

    /**
     * @notice Get the effective price for a skill (base * tier multiplier).
     */
    function getEffectivePrice(bytes32 agentId) public view returns (uint256) {
        SkillPricing storage pricing = skillPricing[agentId];
        require(pricing.active, "Skill not registered");

        uint256 multiplier = _getTierMultiplier(pricing.trustTier);
        return (pricing.pricePerCall * multiplier) / TOTAL_BPS;
    }

    /**
     * @notice Get skill pricing details (core).
     */
    function getSkillPricing(bytes32 agentId) external view returns (
        uint256 pricePerCall,
        uint8 trustTier,
        bool active,
        address publisher,
        uint256 effectivePrice
    ) {
        SkillPricing storage p = skillPricing[agentId];
        uint256 ep = p.active ? getEffectivePrice(agentId) : 0;
        return (p.pricePerCall, p.trustTier, p.active, p.publisher, ep);
    }

    /**
     * @notice Get skill usage stats (payment count + total revenue).
     */
    function getSkillUsage(bytes32 agentId) external view returns (
        uint256 paymentCount,
        uint256 totalRevenue
    ) {
        return (skillPaymentCount[agentId], skillTotalRevenue[agentId]);
    }

    /**
     * @notice Get a specific payment record.
     */
    function getPayment(uint256 paymentId) external view returns (
        uint256 id,
        bytes32 agentId,
        address caller,
        address publisher,
        uint256 amount,
        uint256 publisherPayout,
        uint256 protocolPayout,
        uint256 insurancePayout,
        uint256 timestamp
    ) {
        PaymentRecord storage p = payments[paymentId];
        return (
            p.id,
            p.agentId,
            p.caller,
            p.publisher,
            p.amount,
            p.publisherPayout,
            p.protocolPayout,
            p.insurancePayout,
            p.timestamp
        );
    }

    /**
     * @notice Get aggregate payment statistics.
     */
    function getPaymentStats() external view returns (
        uint256 _totalPayments,
        uint256 _totalProtocolRevenue,
        uint256 _totalPublisherPayouts,
        uint256 _totalInsuranceContributions,
        uint256 _registeredSkillCount
    ) {
        return (
            totalPaymentsProcessed,
            totalProtocolRevenue,
            totalPublisherPayouts,
            totalInsuranceContributions,
            registeredSkills.length
        );
    }

    /**
     * @notice Get the total number of payments.
     */
    function getPaymentCount() external view returns (uint256) {
        return paymentIds.length;
    }

    /**
     * @notice Get the number of registered skills.
     */
    function getRegisteredSkillCount() external view returns (uint256) {
        return registeredSkills.length;
    }

    /**
     * @notice Get the effective fee split for a skill, accounting for tenure discount.
     * @return publisherBps  Publisher share in basis points
     * @return protocolBps   Protocol share in basis points
     * @return insuranceBps  Insurance share in basis points
     * @return tenureDiscount Tenure discount applied (basis points shifted from protocol to publisher)
     */
    function getEffectiveSplit(bytes32 agentId) external view returns (
        uint256 publisherBps,
        uint256 protocolBps,
        uint256 insuranceBps,
        uint256 tenureDiscount
    ) {
        uint256 discount = 0;
        if (address(trustStaking) != address(0)) {
            uint256 tenure = trustStaking.getTenure(agentId);
            if (tenure > 0) {
                discount = tenure >= TENURE_TARGET
                    ? TENURE_DISCOUNT_MAX_BPS
                    : (TENURE_DISCOUNT_MAX_BPS * tenure) / TENURE_TARGET;
            }
        }

        uint256 pBps = PROTOCOL_BPS > discount ? PROTOCOL_BPS - discount : 0;
        return (PUBLISHER_BPS + discount, pBps, INSURANCE_BPS, discount);
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setTrustStaking(address _trustStaking) external onlyOwner {
        address old = address(trustStaking);
        trustStaking = ITrustStaking(_trustStaking);
        emit TrustStakingUpdated(old, _trustStaking);
    }

    function updateProtocolTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        address old = protocolTreasury;
        protocolTreasury = newTreasury;
        emit ProtocolTreasuryUpdated(old, newTreasury);
    }

    function updateInsurancePool(address newPool) external onlyOwner {
        require(newPool != address(0), "Invalid pool");
        address old = insurancePool;
        insurancePool = newPool;
        emit InsurancePoolUpdated(old, newPool);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    /**
     * @dev Compute the tenure-adjusted fee split and delegator carve-out.
     */
    function _computePaymentSplit(bytes32 agentId, uint256 amount)
        internal
        view
        returns (uint256 publisherPayout, uint256 protocolPayout, uint256 insurancePayout, uint256 delegatorPayout)
    {
        uint256 tenureDiscount = _getTenureDiscount(agentId);

        uint256 protocolBps = PROTOCOL_BPS > tenureDiscount
            ? PROTOCOL_BPS - tenureDiscount
            : 0;
        uint256 publisherBps = PUBLISHER_BPS + tenureDiscount;

        publisherPayout = (amount * publisherBps) / TOTAL_BPS;
        protocolPayout = (amount * protocolBps) / TOTAL_BPS;
        insurancePayout = amount - publisherPayout - protocolPayout;

        // Delegation revenue share: carve from publisher payout
        delegatorPayout = _getDelegatorPayout(agentId, publisherPayout);
        publisherPayout -= delegatorPayout;
    }

    /**
     * @dev Get tenure-based protocol fee discount in basis points.
     */
    function _getTenureDiscount(bytes32 agentId) internal view returns (uint256) {
        if (address(trustStaking) == address(0)) return 0;
        uint256 tenure = trustStaking.getTenure(agentId);
        if (tenure == 0) return 0;
        if (tenure >= TENURE_TARGET) return TENURE_DISCOUNT_MAX_BPS;
        return (TENURE_DISCOUNT_MAX_BPS * tenure) / TENURE_TARGET;
    }

    /**
     * @dev Compute delegator payout as a share of the publisher payout.
     */
    function _getDelegatorPayout(bytes32 agentId, uint256 publisherPayout)
        internal
        view
        returns (uint256)
    {
        if (address(trustStaking) == address(0)) return 0;
        (, , uint256 delegatedStake, uint256 totalStake, , , , ) = trustStaking.agentStakes(agentId);
        if (delegatedStake == 0 || totalStake == 0) return 0;
        return (publisherPayout * delegatedStake * DELEGATOR_SHARE_BPS) / (totalStake * TOTAL_BPS);
    }

    /**
     * @dev Record a payment and update all counters.
     */
    function _recordPayment(
        bytes32 agentId,
        address pub,
        uint256 amount,
        uint256 publisherPayout,
        uint256 protocolPayout,
        uint256 insurancePayout
    ) internal returns (uint256 paymentId) {
        paymentId = nextPaymentId++;
        payments[paymentId] = PaymentRecord({
            id: paymentId,
            agentId: agentId,
            caller: msg.sender,
            publisher: pub,
            amount: amount,
            publisherPayout: publisherPayout,
            protocolPayout: protocolPayout,
            insurancePayout: insurancePayout,
            timestamp: block.timestamp
        });

        paymentIds.push(paymentId);

        totalProtocolRevenue += protocolPayout;
        totalPublisherPayouts += publisherPayout;
        totalInsuranceContributions += insurancePayout;
        totalPaymentsProcessed++;
        skillPaymentCount[agentId]++;
        skillTotalRevenue[agentId] += amount;
        callerPaymentCount[msg.sender]++;
    }

    /**
     * @dev Execute ETH transfers for a payment.
     */
    function _executeTransfers(
        bytes32 agentId,
        address pub,
        uint256 publisherPayout,
        uint256 protocolPayout,
        uint256 insurancePayout,
        uint256 delegatorPayout
    ) internal {
        (bool okPub,) = pub.call{value: publisherPayout}("");
        require(okPub, "Publisher transfer failed");

        if (protocolPayout > 0) {
            (bool okProto,) = protocolTreasury.call{value: protocolPayout}("");
            require(okProto, "Protocol transfer failed");
        }

        (bool okIns,) = insurancePool.call{value: insurancePayout}("");
        require(okIns, "Insurance transfer failed");

        if (delegatorPayout > 0) {
            trustStaking.depositRevenue{value: delegatorPayout}(agentId);
        }
    }

    /**
     * @notice Map trust tier (0-8) to a price multiplier in basis points.
     *         AAA(8),AA(7),A(6) → 2.0x = 20000 bps
     *         BBB(5),BB(4),B(3) → 1.0x = 10000 bps
     *         CCC(2),CC(1),C(0) → 0.5x = 5000 bps
     */
    function _getTierMultiplier(uint8 tier) internal pure returns (uint256) {
        if (tier >= 6) return PREMIUM_MULTIPLIER_BPS;
        if (tier >= 3) return STANDARD_MULTIPLIER_BPS;
        return BUDGET_MULTIPLIER_BPS;
    }
}
