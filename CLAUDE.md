# CLAUDE.md - Persistent Rules for ClawMon Project

## Project Overview
- Blockchain skill registry with ERC-8004 integration, staking (StakeEscrow.sol), slashing (SlashingManager.sol), feedback, and boost-based benefits.
- Stack: Solidity ^0.8.24 (contracts/), TypeScript ESM (src/), Hardhat for testing (test/*.cjs).
- Target chain: Monad (testnet + mainnet).
- Key contracts: SkillPublisherBinder.sol, SkillRegistry.sol, StakeEscrow.sol, SlashingManager.sol, SkillPaywall.sol, BenefitGate.sol.

## Code Style & Conventions
- Solidity: NatSpec comments, custom revert strings (e.g., "NOT_OWNER"), pragma ^0.8.24.
- TypeScript: ESM imports with .js extensions, async/await, ethers v6, types in separate files.
- Testing: Mocha/Chai via Hardhat (CommonJS .cjs files), use `@nomicfoundation/hardhat-network-helpers` for time manipulation.
- All contract state reads use ethers.Contract with provider; writes use signer.

## Build & Test
- Compile contracts: `node -e "..."` via solcjs (no network needed) or `npx hardhat compile --config hardhat.config.cjs`
- Run tests: `npx hardhat test --config hardhat.config.cjs`
- TypeScript check: `./node_modules/.bin/tsc --noEmit --skipLibCheck`
- Dev server: `npm run dev:server`

## Workflow Rules
- **AUTO-CONTINUE**: After completing each phase, immediately proceed to the next phase without asking for permission. Mark completed phases in PLAN.md and continue through all 8 phases sequentially.
- Verify EVERY change: compile Solidity (solcjs) + TypeScript (tsc --noEmit) before committing.
- Commit after each phase with detailed messages.
- Push to the feature branch after each commit.

## Phase Progress
- [x] Phase 1: Publisher Identity Binding
- [x] Phase 2: Feedback Authorization (8004 Compliance)
- [x] Phase 3: Publisher Staking on ClawMon
- [x] Phase 4: Skill Validators (Principals) & Slash Governance
- [x] Phase 5: Agent-to-Agent Feedback (8004-Compliant)
- [ ] Phase 6: Boost-Based Benefit Unlocks
- [ ] Phase 7: End-to-End API & Orchestration
- [ ] Phase 8: Integration Tests & Demo
