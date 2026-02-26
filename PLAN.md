# Skill Publisher Staking & Agent Feedback System — Implementation Plan

> Connects ClawHub skill discovery → publisher staking → 8004-compliant feedback → malicious skill slashing → boost-based benefit unlocks. All on Monad registries.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FLOW (End-to-End)                            │
│                                                                      │
│  1. FETCH          ClawHub CLI → fetchAllSkills() → skill catalog    │
│       │                                                              │
│  2. REGISTER       Publisher registers skill on SkillRegistry.sol    │
│       │            + links to ERC-8004 agentId OR publisher wallet   │
│       │                                                              │
│  3. STAKE          Publisher stakes MON on StakeEscrow.sol           │
│       │            Skill gets trust level (L1/L2/L3)                 │
│       │                                                              │
│  4. AUTHORIZE      Publisher sets feedbackAuth: "open" on-chain      │
│       │            (ERC-8004 compliance — allows community feedback)  │
│       │                                                              │
│  5. FEEDBACK       Agents give feedback via ReputationRegistry       │
│       │            (ERC-8004 giveFeedback with tag1/tag2)            │
│       │                                                              │
│  6. VALIDATE       Skill validators (principals) can propose slash   │
│       │            SlashingManager reviews evidence, executes slash   │
│       │                                                              │
│  7. BOOST          Agents stake MON on skills (Discord nitro-style)  │
│       │            Boost level = number of boost units staked         │
│       │                                                              │
│  8. REPUTATION     Feedback + stake + boosts → trust tier + score    │
│       │            Stored in Monad registries                        │
│       │                                                              │
│  9. BENEFITS       Higher boost levels unlock real benefits:         │
│                    L1: Priority queue + API rate limit increase       │
│                    L2: VPS sandbox access (isolated execution)        │
│                    L3: Dedicated compute + persistent state           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Gap Analysis: What Exists vs. What's Needed

### Already Built (Solid Foundation)
| Component | Status | Files |
|-----------|--------|-------|
| ClawHub skill fetch | DONE | `src/clawhub/client.ts`, `sync.ts`, `types.ts` |
| SkillRegistry.sol (registration) | DONE | `contracts/SkillRegistry.sol` |
| StakeEscrow.sol (boost staking) | DONE | `contracts/StakeEscrow.sol` |
| SlashingManager.sol (slash authority) | DONE | `contracts/SlashingManager.sol` |
| TrustStaking.sol (publisher staking) | DONE | `contracts/TrustStaking.sol` |
| ERC-8004 client (feedback read/write) | DONE | `src/erc8004/client.ts` |
| Scoring engine (naive + hardened) | DONE | `src/scoring/engine.ts`, `hardened.ts` |
| Reputation tiers (claw→lobster→whale) | DONE | `src/scoring/reputation-tiers.ts` |
| InsurancePool.sol | DONE | `contracts/InsurancePool.sol` |
| SkillPaywall.sol (x402 payments) | DONE | `contracts/SkillPaywall.sol` |
| Hardhat test suite | DONE | `test/*.test.cjs` |
| Boost reads (off-chain) | DONE | `src/staking/boost.ts` |

### Gaps to Fill
| Gap | Why It Matters | Priority |
|-----|---------------|----------|
| **Publisher → 8004 agentId binding** | No mechanism to tie a ClawHub publisher's wallet to their ERC-8004 identity | CRITICAL |
| **Feedback authorization flow** | Publisher must explicitly enable open feedback (8004 compliance) — not automated | CRITICAL |
| **Skill validator (principal) role** | SlashingManager uses single `slashAuthority` — no principal framework | HIGH |
| **Agent-to-agent feedback via 8004** | Feedback is human-submitted — no agent-as-reviewer pathway | HIGH |
| **Boost benefit unlock contract** | StakeEscrow computes trust levels but doesn't gate real benefits | HIGH |
| **Benefit provisioning system** | No infrastructure for VPS/compute allocation | HIGH |
| **Publisher staking orchestration** | No end-to-end publish→register→stake→authorize flow | MEDIUM |
| **Unified flow test harness** | Individual tests exist, no E2E flow test | MEDIUM |

---

## Phase 1: Publisher Identity Binding (8004 ↔ Wallet ↔ SkillRegistry)

**Problem:** A ClawHub publisher who registers a skill needs a way to be identified as an ERC-8004 agent OR have their wallet bound to the skill they publish.

**Solution:** Two identity paths, converging into `SkillRegistry`:

### Path A: Publisher has ERC-8004 agentId
- Publisher calls `registerAgent(agentURI)` on IdentityRegistry → gets `agentId` (ERC-721 tokenId)
- Publisher calls `SkillRegistry.registerSkill()` with their wallet as `provider`
- The `providerIdentityHash` field stores `keccak256(abi.encodePacked(agentId))` — binding the on-chain skill to their 8004 identity

### Path B: Publisher uses wallet only (no prior 8004 registration)
- Publisher calls `SkillRegistry.registerSkill()` directly with their wallet
- System auto-registers an ERC-8004 agent on their behalf (lazy registration)
- The wallet extracted from `SKILL.md` frontmatter (already parsed by `extractWalletFromSkillMd()`) is used

### New Contract: `SkillPublisherBinder.sol`
Orchestrator contract that atomically:
1. Registers the skill on `SkillRegistry`
2. Registers the agent on ERC-8004 `IdentityRegistry` (if not already registered)
3. Sets `feedbackAuth: "open"` metadata on the 8004 identity
4. Stakes initial MON on `StakeEscrow`

```solidity
// SkillPublisherBinder.sol — atomic publish + bind + authorize + stake
contract SkillPublisherBinder {
    SkillRegistry public registry;
    StakeEscrow public escrow;
    // ERC-8004 IdentityRegistry address for lazy registration
    address public identityRegistry;

    function publishAndStake(
        SkillRegistry.RiskTier risk,
        bytes32 metadataHash,
        bytes32 clawhubSkillId,
        bytes32 providerIdentityHash,
        uint256 erc8004AgentId  // 0 = auto-register
    ) external payable returns (uint256 skillId) {
        // 1. Register skill
        skillId = registry.registerSkill(risk, metadataHash, clawhubSkillId, providerIdentityHash);
        // 2. Stake on skill
        escrow.stake{value: msg.value}(skillId);
        // 3. Emit binding event for off-chain indexing
        emit SkillPublished(skillId, msg.sender, erc8004AgentId, clawhubSkillId);
    }
}
```

### Off-Chain: `src/publishing/publisher-binder.ts`
TypeScript orchestrator that:
1. Takes a `ClawHubSkill` (from fetch)
2. Resolves publisher identity (wallet from SKILL.md, or 8004 agentId)
3. Calls `SkillPublisherBinder.publishAndStake()` or individual contract calls
4. Stores the binding in local state for the scoring engine

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `contracts/SkillPublisherBinder.sol` | CREATE | Atomic publish+bind+stake orchestrator |
| `src/publishing/publisher-binder.ts` | CREATE | Off-chain orchestration logic |
| `src/publishing/types.ts` | CREATE | PublishRequest, PublishResult, IdentityBinding types |
| `contracts/SkillRegistry.sol` | MODIFY | Add `registerSkillFor()` (called by binder on behalf of publisher) |
| `test/SkillPublisherBinder.test.cjs` | CREATE | Hardhat tests |

### Milestone Test: "Publisher Identity Binding"
```
TEST 1: Publisher with wallet registers skill → skill.provider === wallet
TEST 2: Publisher with 8004 agentId registers → providerIdentityHash links to agentId
TEST 3: Atomic publishAndStake → skill registered + MON staked in single tx
TEST 4: Wallet from SKILL.md frontmatter is correctly extracted and bound
TEST 5: Duplicate clawhubSkillId registration reverts
```

---

## Phase 2: Feedback Authorization (8004 Compliance)

**Problem:** ERC-8004 requires the agent publisher to explicitly authorize that feedback can be given. The current system checks for `feedbackAuth: "open"` but doesn't enforce it on-chain.

**Solution:** Use ERC-8004 `setMetadata()` to store feedback authorization policy on-chain.

### On-Chain: Metadata key `feedbackAuth`
```typescript
// Set feedback auth to "open" — required for listing
await identityWrite.setMetadata(
  agentId,
  'feedbackAuth',
  ethers.toUtf8Bytes('open')
);
```

### Integration into SkillPublisherBinder
The `publishAndStake()` flow automatically sets `feedbackAuth: "open"` as part of the atomic operation. This ensures:
- No skill can be listed without open feedback authorization
- The publisher explicitly consents to community review
- Compliance is enforced at the contract level

### New: `FeedbackAuthGate` in scoring engine
```typescript
// src/scoring/feedback-auth-gate.ts
export async function checkFeedbackAuth(agentId: number): Promise<boolean> {
  const metadata = await getAgentMetadata(agentId, 'feedbackAuth');
  return ethers.toUtf8String(metadata) === 'open';
}
```

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `src/scoring/feedback-auth-gate.ts` | CREATE | On-chain feedback auth verification |
| `src/publishing/publisher-binder.ts` | MODIFY | Add setMetadata call in publish flow |
| `src/server.ts` | MODIFY | Add feedback auth check to POST /api/feedback |

### Milestone Test: "Feedback Authorization"
```
TEST 1: Skill with feedbackAuth: "open" → feedback accepted
TEST 2: Skill with feedbackAuth: "closed" → feedback rejected (403)
TEST 3: Publisher sets feedbackAuth from "closed" to "open" → feedback now accepted
TEST 4: New skill via publishAndStake → feedbackAuth auto-set to "open"
TEST 5: Reading feedbackAuth from on-chain metadata returns correct value
```

---

## Phase 3: Publisher Staking on ClawMon

**Problem:** Need a clean flow for publishers to stake MON against their skill, tying stake to both the SkillRegistry entry and the ERC-8004 identity.

**Current state:** `StakeEscrow.sol` exists and works (boost-style staking with L1/L2/L3 trust levels). `TrustStaking.sol` also exists (separate publisher staking). These need unification.

**Decision: Use StakeEscrow as the primary staking contract.** It already has:
- Share-based accounting (pro-rata slash distribution)
- Trust level computation (L1=2 boosts, L2=7 boosts, L3=14 boosts)
- Unstake cooldown (7 days)
- Slashing integration with SlashingManager

### Changes to StakeEscrow.sol
Add a `publisherStake` mapping that tracks who is the primary staker (publisher) vs. boosters:

```solidity
// Track publisher vs. booster stakes separately
mapping(uint256 => address) public skillPublisher; // skillId → publisher address

function stakeAsPublisher(uint256 skillId) external payable {
    require(skillPublisher[skillId] == address(0) || skillPublisher[skillId] == msg.sender, "NOT_PUBLISHER");
    // ... existing stake logic ...
    skillPublisher[skillId] = msg.sender;
}

function boostSkill(uint256 skillId) external payable {
    // Anyone can boost — same as existing stake() but doesn't set publisher
    // ... existing stake logic ...
}
```

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `contracts/StakeEscrow.sol` | MODIFY | Add `stakeAsPublisher()` + `boostSkill()` + `skillPublisher` mapping |
| `src/staking/publisher-staking.ts` | CREATE | Off-chain publisher staking orchestration |
| `test/StakeBoostSlashing.test.cjs` | MODIFY | Add publisher vs. booster staking tests |

### Milestone Test: "Publisher Staking"
```
TEST 1: Publisher stakes 0.1 MON → trust level L1 (2 boost units)
TEST 2: Publisher increases stake to 0.5 MON → trust level L2
TEST 3: Non-publisher cannot claim publisher role after publisher stakes
TEST 4: Unstake initiates 7-day cooldown → cannot withdraw early
TEST 5: Slash reduces publisher stake pro-rata
TEST 6: After slash below minimum → trust level drops
```

---

## Phase 4: Skill Validators (Principals) & Slash Governance

**Problem:** `SlashingManager.sol` uses a single `slashAuthority` address. Need a principal-based validation framework where multiple validators can flag malicious skills.

**Solution:** Extend `SlashingManager` with a validator (principal) committee.

### New: Validator Registry in SlashingManager

```solidity
// Validator roles
mapping(address => bool) public isValidator;
uint256 public validatorCount;
uint256 public slashQuorum; // e.g., 3

struct SlashProposal {
    uint256 skillId;
    uint16 severityBps;
    bytes32 reasonHash;
    string evidenceURI;
    bytes32 caseId;
    address proposer;
    uint256 approvals;
    uint256 rejections;
    bool executed;
    mapping(address => bool) voted;
}

mapping(bytes32 => SlashProposal) public proposals;

function proposeSlash(uint256 skillId, uint16 severityBps, bytes32 reasonHash, string calldata evidenceURI, bytes32 caseId) external {
    require(isValidator[msg.sender], "NOT_VALIDATOR");
    // Create proposal, auto-approve from proposer
}

function voteOnSlash(bytes32 caseId, bool approve) external {
    require(isValidator[msg.sender], "NOT_VALIDATOR");
    // Vote, execute if quorum reached
}
```

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `contracts/SlashingManager.sol` | MODIFY | Add validator registry + proposal voting |
| `src/validators/types.ts` | CREATE | Validator, SlashProposal types |
| `src/validators/slash-governance.ts` | CREATE | Off-chain proposal tracking + voting UI data |
| `test/SlashingManager.test.cjs` | CREATE | Validator voting tests |

### Milestone Test: "Slash Governance"
```
TEST 1: Validator proposes slash → proposal created with status "pending"
TEST 2: 3 of 5 validators approve → slash auto-executed
TEST 3: Non-validator cannot propose or vote
TEST 4: Slash distributes funds: treasury receives slashed MON
TEST 5: Same caseId cannot be used twice (replay prevention)
TEST 6: Executed slash deactivates skill if stake falls below minimum
```

---

## Phase 5: Agent-to-Agent Feedback (8004-Compliant)

**Problem:** Current feedback comes from human users. Need agents to give feedback to other agents' skills, with proper 8004 compliance.

**Solution:** Agents use their ERC-8004 identity (agentId) to submit feedback through the ReputationRegistry.

### Agent Feedback Flow
1. Agent has an ERC-8004 agentId (via IdentityRegistry)
2. Agent's wallet is the `clientAddress` in feedback
3. Agent calls `giveFeedback()` on ReputationRegistry with:
   - `agentId` = target skill's 8004 ID
   - `tag1` = "agent-review" (distinguishes from human feedback)
   - `tag2` = agent's own agentId (string) for attribution
   - `feedbackURI` = link to structured review (see below)

### Agent Feedback File Schema
```typescript
interface AgentFeedbackFile extends FeedbackFile {
  reviewerAgentId: number;     // The reviewing agent's 8004 ID
  reviewerSkillUsed: string;   // Which skill the reviewer used to evaluate
  automatedAssessment: {
    securityScore: number;     // 0-100
    reliabilityScore: number;  // 0-100
    performanceScore: number;  // 0-100
    summary: string;
  };
}
```

### Reputation Signal from Agent Feedback
In the scoring engine, agent feedback gets weighted differently:
- Agent with high reputation (whale tier) → 5x weight
- Agent with published skill + stake → 3x weight
- New/unknown agent → 0.5x weight (discount until proven)

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `src/feedback/agent-feedback.ts` | CREATE | Agent feedback submission + validation |
| `src/feedback/types.ts` | CREATE | AgentFeedbackFile, AgentReviewParams |
| `src/scoring/agent-weighted.ts` | CREATE | Agent-specific feedback weighting |
| `src/server.ts` | MODIFY | Add POST /api/feedback/agent endpoint |
| `test/agent-feedback.test.cjs` | CREATE | Agent feedback flow tests |

### Milestone Test: "Agent Feedback"
```
TEST 1: Agent submits feedback with tag1="agent-review" → accepted
TEST 2: Agent cannot review its own skill (self-feedback check)
TEST 3: Agent feedback weighted by reviewer's reputation tier
TEST 4: Feedback file includes reviewerAgentId and automatedAssessment
TEST 5: getFeedbackSummary() includes agent feedback in aggregation
TEST 6: Revoked agent feedback excluded from scoring
```

---

## Phase 6: Boost-Based Benefit Unlocks

**Problem:** Staking/boosting exists but unlocks no real benefits. Need Discord Nitro-style benefit tiers.

**Solution:** New `BenefitGate.sol` contract + off-chain provisioning system.

### Benefit Tiers (Designed Together)

| Level | Boost Units | Benefits | Implementation |
|-------|-------------|----------|----------------|
| **L0** (Unstaked) | 0 | Public API access, 10 req/min rate limit | Default — no contract check needed |
| **L1** (Bronze) | 2+ boosts | Priority queue, 100 req/min, feedback badge | On-chain gate check → API middleware |
| **L2** (Silver) | 7+ boosts | VPS sandbox access (isolated Docker), 500 req/min, skill analytics dashboard | On-chain gate → VPS provisioning API |
| **L3** (Gold) | 14+ boosts | Dedicated compute (2 vCPU, 4GB RAM), persistent state, custom domain, priority support | On-chain gate → compute provisioning |

### New Contract: `BenefitGate.sol`

```solidity
contract BenefitGate {
    StakeEscrow public escrow;
    SkillRegistry public registry;

    enum BenefitTier { None, Bronze, Silver, Gold }

    struct BenefitAllocation {
        BenefitTier tier;
        uint256 activatedAt;
        uint256 expiresAt;        // 0 = no expiry (while staked)
        bytes32 vpsId;            // L2+: provisioned VPS identifier
        bytes32 computeId;        // L3: dedicated compute identifier
    }

    mapping(uint256 => BenefitAllocation) public allocations;

    event BenefitActivated(uint256 indexed skillId, BenefitTier tier, bytes32 resourceId);
    event BenefitDeactivated(uint256 indexed skillId, BenefitTier oldTier);

    function checkAndActivate(uint256 skillId) external returns (BenefitTier) {
        uint8 level = escrow.getTrustLevel(skillId);
        BenefitTier tier = _levelToTier(level);
        // Update allocation, emit event for off-chain provisioner
        allocations[skillId] = BenefitAllocation({
            tier: tier,
            activatedAt: block.timestamp,
            expiresAt: 0,
            vpsId: bytes32(0),
            computeId: bytes32(0)
        });
        emit BenefitActivated(skillId, tier, bytes32(0));
        return tier;
    }

    function getBenefitTier(uint256 skillId) external view returns (BenefitTier) {
        uint8 level = escrow.getTrustLevel(skillId);
        return _levelToTier(level);
    }

    function isAuthorized(uint256 skillId, BenefitTier requiredTier) external view returns (bool) {
        return getBenefitTier(skillId) >= requiredTier;
    }
}
```

### Off-Chain: Benefit Provisioning System

```typescript
// src/benefits/types.ts
export interface BenefitConfig {
  tier: 'bronze' | 'silver' | 'gold';
  rateLimitPerMin: number;
  vpsAccess: boolean;
  vpsSpec?: { cpu: number; memoryMb: number; diskGb: number };
  dedicatedCompute: boolean;
  computeSpec?: { vcpu: number; memoryGb: number; persistentState: boolean };
  customDomain: boolean;
  prioritySupport: boolean;
  analyticsDashboard: boolean;
}

export const BENEFIT_CONFIGS: Record<string, BenefitConfig> = {
  bronze: {
    tier: 'bronze',
    rateLimitPerMin: 100,
    vpsAccess: false,
    dedicatedCompute: false,
    customDomain: false,
    prioritySupport: false,
    analyticsDashboard: false,
  },
  silver: {
    tier: 'silver',
    rateLimitPerMin: 500,
    vpsAccess: true,
    vpsSpec: { cpu: 1, memoryMb: 2048, diskGb: 20 },
    dedicatedCompute: false,
    customDomain: false,
    prioritySupport: false,
    analyticsDashboard: true,
  },
  gold: {
    tier: 'gold',
    rateLimitPerMin: 2000,
    vpsAccess: true,
    vpsSpec: { cpu: 2, memoryMb: 4096, diskGb: 50 },
    dedicatedCompute: true,
    computeSpec: { vcpu: 2, memoryGb: 4, persistentState: true },
    customDomain: true,
    prioritySupport: true,
    analyticsDashboard: true,
  },
};
```

### API Rate Limiting Middleware

```typescript
// src/benefits/rate-limiter.ts
export function benefitRateLimiter() {
  return async (req, res, next) => {
    const skillId = req.params.skillId;
    const tier = await getBenefitTier(skillId); // reads from BenefitGate
    const config = BENEFIT_CONFIGS[tier] ?? { rateLimitPerMin: 10 };
    // Apply rate limit based on tier
  };
}
```

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `contracts/BenefitGate.sol` | CREATE | On-chain benefit tier gating |
| `src/benefits/types.ts` | CREATE | Benefit tier configs and types |
| `src/benefits/provisioner.ts` | CREATE | VPS/compute provisioning orchestration |
| `src/benefits/rate-limiter.ts` | CREATE | Tier-based API rate limiting middleware |
| `src/benefits/gate-client.ts` | CREATE | Off-chain client for BenefitGate contract |
| `src/server.ts` | MODIFY | Add benefit check middleware + benefit endpoints |
| `test/BenefitGate.test.cjs` | CREATE | Benefit gate contract tests |

### Milestone Test: "Benefit Unlocks"
```
TEST 1: Unstaked skill → BenefitTier.None, 10 req/min
TEST 2: Skill with 2 boost units → BenefitTier.Bronze, 100 req/min
TEST 3: Skill with 7 boost units → BenefitTier.Silver, VPS access flag set
TEST 4: Skill with 14 boost units → BenefitTier.Gold, compute flag set
TEST 5: Slash reduces boost units below L2 → BenefitTier drops to Bronze
TEST 6: BenefitActivated event emitted on tier change (for off-chain provisioner)
TEST 7: isAuthorized(skillId, Gold) returns false for Silver-tier skill
TEST 8: Rate limiter enforces correct limits per tier
```

---

## Phase 7: End-to-End Orchestration & API

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/publish` | Atomic: fetch from ClawHub → register → stake → authorize |
| GET | `/api/skills/:id/benefits` | Current benefit tier + allocation |
| POST | `/api/skills/:id/boost` | Submit boost stake for a skill |
| GET | `/api/skills/:id/feedback/agent` | Agent-submitted feedback for a skill |
| POST | `/api/validators/propose-slash` | Propose a slash (validator only) |
| POST | `/api/validators/vote` | Vote on a slash proposal |
| GET | `/api/validators/proposals` | List active slash proposals |
| GET | `/api/benefits/tiers` | Available benefit tier configs |

### New WebSocket Events

| Event | Trigger | Data |
|-------|---------|------|
| `skill:published` | Skill registered + staked | skillId, publisher, trustLevel |
| `skill:boosted` | New boost stake added | skillId, booster, newLevel |
| `skill:slashed` | Slash executed | skillId, amount, reason |
| `benefit:activated` | Benefit tier changed | skillId, oldTier, newTier |
| `feedback:agent` | Agent submits feedback | agentId, reviewerAgentId, value |

### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `src/server.ts` | MODIFY | Add all new endpoints |
| `src/events/types.ts` | MODIFY | Add new event types |
| `src/publishing/routes.ts` | CREATE | Express router for publish flow |
| `src/benefits/routes.ts` | CREATE | Express router for benefit queries |
| `src/validators/routes.ts` | CREATE | Express router for slash governance |

---

## Phase 8: Integration Tests & Demo Harness

### E2E Test Script: `scripts/test-full-flow.ts`

```
Step 1: Fetch skills from ClawHub (or use cached)
Step 2: Publisher registers + stakes skill → verify trust level L1
Step 3: Verify feedbackAuth is "open" on ERC-8004
Step 4: Agent submits positive feedback → verify score updates
Step 5: Agent submits negative feedback → verify score adjusts
Step 6: Publisher boosts to L2 → verify benefit tier upgrade
Step 7: Validator proposes slash → quorum votes → slash executes
Step 8: Verify benefit tier drops after slash
Step 9: Verify insurance pool received 30% of slashed funds
Step 10: Print summary with all contract addresses and state
```

### Demo Script: `scripts/demo-publisher-flow.ts`

Short (< 2 min) demo showing:
1. "Here's a skill from ClawHub: gmail-integration by @user123"
2. "Publisher stakes 0.5 MON → Trust Level L2, Silver benefits unlocked"
3. "Agent A gives 5-star feedback... Agent B gives 5-star feedback..."
4. "Trust score: 85 (AA tier)"
5. "Malicious behavior detected! Validator proposes slash..."
6. "3/5 validators approve → 50% stake slashed → Trust Level drops to L1"
7. "Benefits downgraded: Silver → Bronze. VPS access revoked."

### Files to Create
| File | Action | Description |
|------|--------|-------------|
| `scripts/test-full-flow.ts` | CREATE | E2E integration test |
| `scripts/demo-publisher-flow.ts` | CREATE | Live demo script |

### Milestone Test: "Full Flow"
```
TEST 1: E2E from ClawHub fetch → register → stake → feedback → slash → benefit change
TEST 2: Concurrent agents submitting feedback don't corrupt state
TEST 3: Slash during unstake cooldown still applies (can't front-run)
TEST 4: Benefit tier correctly reflects current on-chain state after every mutation
```

---

## Implementation Order (Critical Path)

```
Phase 1: Publisher Identity Binding ──→ Phase 2: Feedback Authorization
                                     ╲
Phase 3: Publisher Staking ───────────→ Phase 6: Benefit Unlocks
                                     ╱
Phase 4: Slash Governance ──────────╱
                           ╲
Phase 5: Agent Feedback ────→ Phase 7: API + Orchestration → Phase 8: E2E Tests
```

**Parallelizable:** Phases 1+3 can run in parallel. Phase 4+5 can run in parallel after Phase 1.

---

## Bug Self-Check & Edge Cases

### Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SkillRegistry `registerSkill()` requires `msg.sender` as provider — binder contract would be provider | Add `registerSkillFor(address provider, ...)` to SkillRegistry |
| StakeEscrow `stake()` requires `msg.sender == provider` — binder can't stake on behalf | Add `stakeFor(uint256 skillId, address provider)` or have binder be authorized caller |
| Re-entrancy in BenefitGate during tier check + activate | Use checks-effects-interactions pattern; no external calls in activate |
| Agent feedback spam (agent creates many wallets to self-review) | Self-feedback check + graph analysis already in hardened scorer |
| Slash front-running (publisher sees slash proposal, unstakes) | 7-day unstake cooldown prevents this; slash executes before unstake completes |
| Validator collusion (validators slash honest skills for profit) | Challenge bond: proposer stakes 10% of target's stake; if slash rejected, bond is forfeited |

### Contract Interaction Correctness

| Interaction | Verification |
|-------------|-------------|
| SkillPublisherBinder → SkillRegistry | registerSkillFor() must revert if clawhubSkillId already exists |
| SkillPublisherBinder → StakeEscrow | stakeFor() must verify caller is authorized binder |
| BenefitGate → StakeEscrow | getTrustLevel() is a view function — no state mutation risk |
| SlashingManager → StakeEscrow | slash() properly reduces totalAssets and emits TrustLevelChanged |
| Feedback → ReputationRegistry | giveFeedback() requires open auth — checked via metadata |

---

## Summary of All New Files

### Contracts (Solidity)
1. `contracts/SkillPublisherBinder.sol` — Atomic publish + bind + stake
2. `contracts/BenefitGate.sol` — Benefit tier gating

### Modified Contracts
3. `contracts/SkillRegistry.sol` — Add `registerSkillFor()`
4. `contracts/StakeEscrow.sol` — Add `stakeAsPublisher()` + `boostSkill()` + publisher tracking
5. `contracts/SlashingManager.sol` — Add validator registry + proposal voting

### TypeScript Source
6. `src/publishing/types.ts` — Publish flow types
7. `src/publishing/publisher-binder.ts` — Off-chain publish orchestration
8. `src/publishing/routes.ts` — Express router
9. `src/scoring/feedback-auth-gate.ts` — On-chain auth verification
10. `src/feedback/types.ts` — Agent feedback types
11. `src/feedback/agent-feedback.ts` — Agent feedback submission
12. `src/scoring/agent-weighted.ts` — Agent feedback weighting
13. `src/validators/types.ts` — Validator + proposal types
14. `src/validators/slash-governance.ts` — Off-chain governance tracking
15. `src/validators/routes.ts` — Express router
16. `src/benefits/types.ts` — Benefit tier configs
17. `src/benefits/gate-client.ts` — BenefitGate contract client
18. `src/benefits/provisioner.ts` — VPS/compute provisioning
19. `src/benefits/rate-limiter.ts` — Tier-based rate limiting
20. `src/benefits/routes.ts` — Express router
21. `src/staking/publisher-staking.ts` — Publisher staking orchestration

### Tests
22. `test/SkillPublisherBinder.test.cjs` — Publisher binding tests
23. `test/BenefitGate.test.cjs` — Benefit gate tests
24. `test/SlashingManager.test.cjs` — Validator voting tests (new)
25. `scripts/test-full-flow.ts` — E2E integration test
26. `scripts/demo-publisher-flow.ts` — Demo script

### Modified Files
27. `src/server.ts` — New endpoints + middleware
28. `src/events/types.ts` — New WebSocket event types
29. `test/StakeBoostSlashing.test.cjs` — Publisher vs. booster tests
