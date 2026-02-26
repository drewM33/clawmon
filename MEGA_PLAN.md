# MEGA_PLAN.md — AI-Orchestrated Implementation of ClawMon Skill Registry Enhancements

> Comprehensive blueprint integrating ERC-8004 bindings, staking, feedback, slashing, and benefits.
> Treats Claude Code as the primary driver (autonomy + parallelism) and Cursor as the polisher (interactive refinements).

---

## 1. Setup & Prerequisites

### Repo Preparation
- Clone/open repo in Cursor. Run `claude code` in terminal to initialize.
- Generate `CLAUDE.md` with `/init` — auto-detects Solidity, TS, staking contracts, etc.

### Tools Integration
- **Claude Code** (terminal/web/app) for core work
- **Cursor** (with Claude models) for visual edits/reviews
- Enable MCP if needed for external tools (e.g., blockchain explorers)

### CLAUDE.md Template (Customize & Commit First)

```markdown
# CLAUDE.md - Persistent Rules for ClawMon Project

## Project Overview
- Blockchain skill registry with ERC-8004 integration, staking (StakeEscrow.sol), slashing (SlashingManager.sol), feedback, and boost-based benefits.
- Stack: Solidity (contracts), TypeScript (API/off-chain), Hardhat/Ganache for testing.
- Key Files: contracts/SkillPublisherBinder.sol, contracts/StakeEscrow.sol, src/feedback-auth-gate.ts, etc.
- Purpose: Bind publisher identities, enforce feedback auth, manage staking/slashes, unlock benefits based on boosts.

## Code Style & Conventions
- Solidity: Use NatSpec comments, error with custom codes (e.g., revert Binder_InvalidAgentId()), OpenZeppelin imports.
- TS: Async/await over callbacks, ESLint with airbnb preset, type everything.
- Testing: Mocha/Chai for unit, Hardhat for integration; always include edge cases (e.g., zero stake, invalid auth).
- IMPORTANT: Never modify existing contracts without versioning (e.g., StakeEscrowV2 if needed).

## Workflow Rules
- Always start in Plan Mode for non-trivial tasks.
- Verify EVERY change: Run tests, simulate txs, check logs. If no tests exist, generate them first.
- Use subagents for specialized reviews (e.g., security-subagent for contracts).
- Context: Clear between phases (/clear); compact with /compact "Summarize decisions on staking logic".
- Gotchas: Handle 7-day cooldown in slashes; prevent self-reviews in feedback.

## Bash/Commands
- Test: npx hardhat test
- Deploy: npx hardhat run scripts/deploy.ts --network localhost
- Lint: eslint . --ext .ts

## Skills (in .claude/skills/)
- /solidity-contract: Generate boilerplate with imports, constructor, events.
- /test-milestone: Write 5+ tests for given function, including reverts.
```

---

## 2. Core Best Practices (Integrated Throughout)

All practices are mandatory — mapped to every phase/subtask.

| Category | Practice | How It Applies |
|----------|----------|---------------|
| **Planning & Structure** | Start with planning / Separation of phases | Every subtask: Explore (read files), Plan (iterate plan), Implement (code), Commit (PR with message). Use Plan Mode first. |
| **Parallelism & Orchestration** | Maximize parallelism / Parallel work | Run 5-15 sessions: e.g., one per phase, subtasks in tabs (phase1-contract, phase1-parser). Use Writer/Reviewer: Implement in one, review in another. Orchestrate don't micromanage: You approve plans/reviews; Claude handles impl/tests/fixes. |
| **Context & Prompts** | Context window management / Specificity / Rich input | Use /clear between tasks; @file for contracts; pipe logs (`cat deploy.log \| claude`). |
| **Reusable & Automation** | Build reusable workflows / Domain knowledge / Automation | Create /skills for patterns (e.g., /slash-proposal for validator logic). Use hooks (e.g., auto-lint after edits). Headless for batch tests: `claude -p "Run all Phase 8 E2E"`. Subagents: e.g., security-reviewer for contracts. |
| **Verification & Review** | Verification is critical / Review & close loops | ALWAYS verify: Tests, sims, logs. Human (or subagent) reviews before merge. Focus on plans/prompts over code. Treat like slot machine: Save state, retry if >2 corrections. |
| **Multi-Device & Adaptability** | Seamless multi-device/hand-off / Experiment & customize | Kick off from phone app (plan Phase 1), hand-off to terminal (--continue), monitor web. Adapt: Test 80% auto-complete (Claude does most, you refine in Cursor). |
| **Team & Onboarding** | Onboarding / Collaboration / Specialized roles | Use CLAUDE.md for quick codebase Q&A. Subagents for roles (e.g., bug-fixer). |
| **Pitfalls Avoidance** | Common pitfalls | Prune bloated CLAUDE.md; narrow exploration; enforce trust-then-verify. |

---

## 3. Augmented 8-Phase Implementation

Each phase is broken into subtasks with embedded practices. Total estimated: 4-8 hours with parallelism (vs. days manually).

Start master session: `claude code --session mega-master`, paste this plan, then fan out.

### Phase 1: Publisher Identity Binding (8004 ↔ Wallet ↔ SkillRegistry)

**Subtasks (Parallel: 3-5 sessions):**

1. **Explore/Plan:** Session1 — Read `@SkillRegistry.sol`, plan `SkillPublisherBinder.sol` (iterate 2-3x in Plan Mode).
2. **Implement:** Session2 — Code contract with `/solidity-contract` skill; add stake integration.
3. **Verify/Review:** Session3 (Reviewer subagent) — Generate tests (valid/invalid agentId), run, fix root causes.
4. **Commit:** Generate PR message; review in Cursor.

**Integrated Practices:** Parallel sessions; rich input (`@files`); verification via tests; hand-off plan to web if needed.

---

### Phase 2: Feedback Authorization (8004 Compliance)

**Subtasks (Parallel: 2-4 sessions):**

1. **Explore/Plan:** Analyze ERC-8004 metadata; plan `feedback-auth-gate.ts` integration.
2. **Implement:** Code gate logic; setMetadata in publish flow.
3. **Verify:** Tests for auth checks; screenshot diffs if UI involved.
4. **Review:** Subagent critiques for compliance gaps.

**Integrated Practices:** Specificity (prompt with edge cases); `/clear` after plan; multi-device (start on phone).

---

### Phase 3: Publisher Staking on ClawMon

**Subtasks (Parallel: 4 sessions):**

1. **Explore:** Read `@StakeEscrow.sol`; plan `stakeAsPublisher()` vs `boostSkill()`.
2. **Implement:** Extend contract; add distinctions.
3. **Verify:** Sim txs, test levels/cooldown.
4. **Automate:** Hook for lint/test post-edit.

**Integrated Practices:** Automation/hooks; orchestrate (you approve extensions); experiment (test headless for staking sims).

---

### Phase 4: Skill Validators (Principals) & Slash Governance

**Subtasks (Parallel: 5 sessions):**

1. **Plan:** Detail committee/voting/quorum.
2. **Implement:** Extend `SlashingManager.sol`.
3. **Specialized:** Security subagent reviews bonds/proposals.
4. **Verify:** Tests for frivolous prevention, quorum.
5. **Review:** Writer/Reviewer pattern.

**Integrated Practices:** Subagents for roles; parallel work; avoid over-spec (narrow to governance only).

---

### Phase 5: Agent-to-Agent Feedback (8004-Compliant)

**Subtasks (Parallel: 3 sessions):**

1. **Plan:** Weighting tiers, block self-review.
2. **Implement:** Tag-based submission.
3. **Verify:** Tests for weights/blocking.

**Integrated Practices:** Reusable `/test-milestone`; verification patterns (logs for reviews).

---

### Phase 6: Boost-Based Benefit Unlocks

**Subtasks (Parallel: 4-6 sessions):**

1. **Plan:** `BenefitGate.sol` logic, levels.
2. **Implement:** Contract + off-chain provisioner.
3. **Verify:** E2E tests for events/resources.
4. **Automate:** Script for level checks.

**Integrated Practices:** Fan out (one session per level); context mgmt (pipe event logs).

---

### Phase 7: End-to-End API & Orchestration

**Subtasks (Parallel: 5 sessions):**

1. **Plan:** Endpoints/WebSockets.
2. **Implement:** POST/GET routes.
3. **Verify:** API tests.
4. **Review:** In Cursor for UI polish.

**Integrated Practices:** Seamless hand-off (monitor WS on app); close loops (full review).

---

### Phase 8: Integration Tests & Demo

**Subtasks (Parallel: 3 sessions):**

1. **Plan:** 10-step E2E flow.
2. **Implement:** `test-full-flow.ts` + demo script.
3. **Verify/Commit:** Run, fix, PR.

**Integrated Practices:** Headless automation; self-improvement (log lessons to CLAUDE.md).

---

## 4. Execution Guide

1. **Commit** `MEGA_PLAN.md` & `CLAUDE.md`.
2. **Master Session:** Paste plan, `/clear` as needed.
3. **Parallel Launch:** e.g., `claude code --session phase1-explore -p "Explore Phase 1 with @files"`.
4. **Orchestrate:** Monitor tabs/web; approve/retry.
5. **Review/Merge:** Cursor for finals; log customizations.
6. **Scale:** If stuck, add subagents (e.g., `.claude/agents/security.md` with rules).

---

## 5. Cross-Reference

- **Technical Plan:** See `PLAN.md` for contract pseudocode, file lists, gap analysis, and 30+ milestone tests.
- **This Document:** Orchestration strategy, best practices, session management, and execution workflow.
