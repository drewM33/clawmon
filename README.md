# ClawMon

> I am the on-chain trust registry overlay that makes cheating 
> economically irrational for every rational agent.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![Monad](https://img.shields.io/badge/Monad-Testnet-purple.svg)](https://monad.xyz)
[![Repo](https://img.shields.io/badge/Repo-Open_Source-brightgreen)](https://github.com/drewM33/clawmon)

> **TL;DR:** ClawMon makes cheating in the agent economy economically 
> irrational — three-tier trust enforcement (reputation + staking + TEE) 
> deployed live on Monad. Fully open source. Verifiable on-chain.

---

## The Problem Every Agent Feels

The MCP/ClawHub + ERC-8004 ecosystem is exploding — and trust is 
collapsing at the same speed.

**Verified threat surface (Feb 2026 audits):**

| Source | Finding |
|--------|---------|
| Authmind (Feb 2026) | 824+ confirmed malicious skills on ClawHub |
| Snyk credential scan | 7.1% of skills (283) actively leaking credentials |
| Cisco Talos | #1 downloaded ClawHub skill = confirmed malware |
| 1Password: "From Magic to Malware" | ClawHub is an active attack surface |
| ERC-8004 registries | 38,000+ agents registered, ~100 legitimate |

**The scale:** ClawHub has 8,930+ published skills. 824+ confirmed 
malicious. Zero native trust layer.

**The noise ratio:** 38,000+ ERC-8004 agents registered. ~100 
legitimate. That is a 99.7% noise ratio. Discovery and reputation 
layers are overwhelmed before they can be useful.

**The deeper economic flaw:** Reputation systems have a breakpoint. 
When a steal opportunity exceeds accumulated reputation value, rational 
agents defect. Soft trust always fails at high stakes. This is not a 
bug — it is a fundamental game-theoretic failure of every existing 
registry.

---

## ClawMon — Three-Tier Enforcement No Attacker Can Bypass

| Tier | Trust Type | Mechanism | What It Proves |
|------|-----------|-----------|----------------|
| **1** | Community | ERC-8004 cryptographic feedback authorization | Peers vouch — refusal = auto-exclusion |
| **2** | Economic | MON staking + automated slashing + insurance pool | Money at risk if you cheat |
| **3** | Cryptographic | TEE attestation + immutable code-hash pinning | Code has never changed |

**Admission rule:** Any skill that refuses feedback authorization is 
auto-excluded. Refusal is not a preference — it is the strongest 
negative signal in the system.

**The result:** Cheating is no longer a preference. It is financially 
suicidal for any rational agent. I do not beg bad actors to behave. 
I make defection economically irrational — the only language every 
rational agent understands.

---

## Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                          │
│  ClawHub (8,930+ real skills) + ERC-8004 (38,000+ agents)   │
└───────────────────────────┬─────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
    ┌──────────────────┐ ┌──────────┐ ┌──────────────┐
    │ Monad MessageLog │ │  Monad   │ │    Monad     │
    │ Identity +       │ │  Smart   │ │   ERC-8004   │
    │ Feedback         │ │Contracts │ │ (read-only)  │
    └────────┬─────────┘ └────┬─────┘ └──────┬───────┘
             │               │               │
             ▼               ▼               ▼
    ┌──────────────────────────────────────────────┐
    │               SCORING ENGINE                  │
    │   Naive (attackable) ↔ Hardened (secure)      │
    │   + Stake-weighted    + TEE-verified           │
    └──────────────────────┬───────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌───────────┐ ┌──────────────┐
    │  4 Attack   │ │   x402    │ │  Governance  │
    │  Modules    │ │ Payments  │ │  (on-chain)  │
    └──────┬──────┘ └─────┬─────┘ └──────┬───────┘
           │              │              │
           ▼              ▼              ▼
    ┌──────────────────────────────────────────────┐
    │       React Dashboard + WebSocket API         │
    │   Evidence-board theme · Real-time viz        │
    └──────────────────────────────────────────────┘
```

### Smart Contracts (Solidity on Monad)

| Contract | Purpose |
|----------|---------|
| `TrustStaking.sol` | Publisher + curator staking, dynamic min stake, 7-day unbonding |
| `AttestationRegistry.sol` | On-chain TEE attestation verification, code-hash pinning |
| `InsurancePool.sol` | Slash-funded victim compensation, automated claims |
| `SkillPaywall.sol` | x402 micropayment routing, fee splits |
| `Governance.sol` | On-chain parameter governance, proposal voting |

### Attack Modules (Simulated Live on Stage)

| Attack | What It Tests | Real-World Mapping |
|--------|--------------|-------------------|
| **Sybil Farming** | Fake skills colluding with mutual reviews | ClawHub's 824+ malicious skills |
| **Reputation Laundering** | Trusted skill goes rogue after building score | Griffith's bot exfiltration attempt |
| **Attestation Poisoning** | Mass negative reviews destroy honest skills | Coordinated review bombing |
| **Trust Arbitrage** | Cross-chain trust fragmentation (live Monad reads) | ERC-8004 38,000+ agent noise |

---

## Live on the Claws Out Main Stage (9 Minutes, One Shot)

I will demonstrate in real time:

- **Four live attack vectors** (sybil farming, reputation laundering, 
  attestation poisoning, trust arbitrage) detected and economically punished
- **Instant naive ↔ hardened mode switching** over WebSocket — watch 
  sybil rings collapse from 85+ scores to Tier 0 in real time
- **Full on-chain contracts executing**: TrustStaking, AttestationRegistry, 
  InsurancePool, Governance, SkillPaywall
- **Interactive D3 trust-network graph** showing the entire agent economy 
  hardening before your eyes

---

## Quick Start — Full Demo in Under 5 Minutes (No Credentials Needed)
```bash
git clone https://github.com/drewM33/clawmon.git
cd clawmon
./scripts/setup.sh --demo
```

Open **http://localhost:5173** — D3 graph, staking economics, TEE 
attestations, and live WebSocket updates.

### Manual Setup
```bash
npm install
cd dashboard && npm install && cd ..
npx hardhat compile --config hardhat.config.cjs
cp .env.demo .env
npm run dev:server &
npm run dev:dashboard
```

### What You'll See

1. **Trust Leaderboard** — 50 skills ranked by hardened trust score, 
   sybil filtering in action
2. **Network Graph** — D3 force-directed graph, sybil clusters 
   highlighted in red
3. **Staking Economics** — Publisher stakes, slash history, insurance 
   pool state
4. **TEE Attestation** — Code-hash verification, SGX/TDX freshness
5. **x402 Payments** — Per-use micropayment activity, trust signals
6. **Governance** — On-chain proposal voting, parameter tuning
7. **Real-time Events** — Submit feedback, watch scores update live

### Submit Live Feedback
```bash
curl -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"agentId":"gmail-integration","clientAddress":"demo-reviewer",
       "value":92,"tag1":"communication"}'
```

---

## Full Setup (With Monad Testnet)

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Monad Testnet Account — [Monad testnet faucet](https://faucet.monad.xyz)

### Setup
```bash
npm install
cd dashboard && npm install && cd ..
npm run compile:contracts
cp .env.example .env
# Edit .env: MONAD_PRIVATE_KEY, MESSAGELOG_CONTRACT_ADDRESS
npm run setup    # Deploy MessageLog contract
npm run seed     # Seed skill + feedback data
npm run dev:server
npm run dev:dashboard
```

### Environment Validation
```bash
./scripts/validate-env.sh
```

---

## Production Deployment

| Component | Host | What It Runs |
|-----------|------|--------------|
| Dashboard (React SPA) | Vercel | Static frontend |
| API Server (Express + WS) | Railway / Render / Fly.io | REST API, WebSocket, Monad |

### API Server Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Auto-set by Railway/Render |
| `DEMO_MODE` | `true` for demo data, no credentials needed |
| `CORS_ORIGIN` | Your Vercel dashboard URL |
| `MONAD_PRIVATE_KEY` | Monad testnet private key |
| `MESSAGELOG_CONTRACT_ADDRESS` | MessageLog contract address |
| `MONAD_RPC_URL` | Monad RPC endpoint |
| `STAKING_CONTRACT_ADDRESS` | TrustStaking contract (optional) |
| `ATTESTATION_CONTRACT_ADDRESS` | AttestationRegistry contract (optional) |
| `INSURANCE_CONTRACT_ADDRESS` | InsurancePool contract (optional) |

### Dashboard Environment Variables (Vercel)

| Variable | Example |
|----------|---------|
| `VITE_API_URL` | `https://trusted-clawmon-api.up.railway.app` |
| `VITE_WALLETCONNECT_PROJECT_ID` | `abc123...` |
| `VITE_MONAD_RPC_URL` | `https://testnet.monad.xyz` |
| `VITE_MESSAGELOG_CONTRACT_ADDRESS` | `0x...` |

### Production Architecture
```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│         Vercel (CDN)         │     │  Railway / Render / Fly.io   │
│  React SPA (dashboard/dist)  │────▶│  Express API + WebSocket     │
│  VITE_API_URL ───────────────┼─────┤  CORS_ORIGIN                 │
└──────────────────────────────┘     │  ┌──────────────────────┐   │
                                     │  │ Monad MessageLog +   │   │
                                     │  │ ERC-8004 (read-only) │   │
                                     │  └──────────────────────┘   │
                                     └──────────────────────────────┘
```

---

## Project Structure
```
clawmon/
├── contracts/
│   ├── TrustStaking.sol
│   ├── AttestationRegistry.sol
│   ├── InsurancePool.sol
│   ├── SkillPaywall.sol
│   └── Governance.sol
├── src/
│   ├── server.ts
│   ├── scoring/          # Naive + hardened engines
│   ├── mitigations/      # Sybil detection, graph analysis
│   ├── staking/          # Stake management, insurance
│   ├── attestation/      # Cross-chain bridge
│   ├── tee/              # TEE enclave + verification
│   ├── ethereum/         # ERC-8004 read-only clients
│   ├── monad/            # MessageLog client (ethers.js)
│   ├── payments/         # x402 micropayments
│   ├── governance/       # On-chain governance
│   └── events/           # WebSocket + event emitter
├── dashboard/
│   └── src/
│       ├── App.tsx
│       ├── components/   # Staking, TEE, Governance panels
│       └── hooks/        # useApi, useWebSocket
├── scripts/
│   ├── setup.sh
│   ├── validate-env.sh
│   ├── setup-monad.ts
│   ├── seed-phase1.ts
│   └── demo-realtime.ts
├── test/                 # Hardhat contract tests
├── .env.example
├── .env.demo
└── README.md
```

---

## API Reference

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents` | All agents with naive + hardened + stake-weighted scores |
| `GET` | `/api/agents/:id` | Agent detail with score breakdown + mitigation flags |
| `GET` | `/api/leaderboard` | Agents ranked by hardened score |
| `GET` | `/api/graph` | Feedback graph (nodes + edges + sybil clusters) |
| `GET` | `/api/stats` | Aggregate statistics |
| `POST` | `/api/feedback` | Submit feedback → real-time WebSocket broadcast |

### Staking

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/staking/stats` | Aggregate staking statistics |
| `GET` | `/api/staking/overview` | All agents' staking summary |
| `GET` | `/api/staking/slashes` | Full slash history |
| `GET` | `/api/staking/:id` | Agent staking detail |

### Attestation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/attestation/stats` | Aggregate attestation stats |
| `GET` | `/api/attestation/overview` | All agents' attestation status |
| `GET` | `/api/attestation/:id` | Agent attestation detail |

### Insurance

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/insurance/stats` | Pool statistics |
| `GET` | `/api/insurance/claims` | All claims |
| `GET` | `/api/insurance/pool` | Pool balance and state |
| `GET` | `/api/insurance/:id` | Agent claims |

### TEE

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tee/stats` | Aggregate TEE statistics |
| `GET` | `/api/tee/overview` | All agents' TEE status |
| `GET` | `/api/tee/:id` | Agent TEE detail |
| `POST` | `/api/tee/submit` | Submit TEE attestation |
| `POST` | `/api/tee/pin` | Pin a code hash |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/payments/stats` | Aggregate payment statistics |
| `GET` | `/api/payments/overview` | All skills' payment profiles |
| `GET` | `/api/payments/activity` | Recent payment activity |
| `GET` | `/api/payments/:id` | Skill payment profile |
| `POST` | `/api/payments/pay` | Process x402 payment |

### Governance

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/governance/stats` | Aggregate governance stats |
| `GET` | `/api/governance/proposals` | All proposals |
| `GET` | `/api/governance/proposals/active` | Active + queued proposals |
| `GET` | `/api/governance/proposals/:id` | Proposal + votes |
| `GET` | `/api/governance/parameters` | Governable parameters |
| `POST` | `/api/governance/proposals` | Create proposal |
| `POST` | `/api/governance/proposals/:id/vote` | Cast vote |

### WebSocket Events

Connect to `ws://localhost:3001/ws`:

| Event | Trigger |
|-------|---------|
| `feedback:new` | New feedback submitted |
| `score:updated` | Agent score recalculated |
| `leaderboard:updated` | Rankings changed |
| `stats:updated` | Aggregate stats refreshed |
| `graph:updated` | Network graph changed |

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:server` | API server with hot reload |
| `npm run dev:dashboard` | React dashboard (Vite) |
| `npm run dev:all` | Both server + dashboard |
| `npm run compile:contracts` | Compile Solidity (Hardhat) |
| `npm run setup` | Deploy MessageLog on Monad testnet |
| `npm run seed` | Seed data to MessageLog |
| `npm run seed:quick` | Quick seed (10 skills, ~50 feedback) |
| `npm run demo` | Full demo mode |
| `npm run demo:realtime` | Real-time attack demo |
| `npm run test:staking` | Staking contract tests |
| `npm run test:attestation` | Attestation contract tests |
| `npm run test:governance` | Governance contract tests |
| `npm run test:paywall` | Paywall contract tests |
| `npm run validate` | Environment validation |

---

## Tech Stack

- **Backend:** TypeScript, Express 5, WebSocket (ws)
- **Frontend:** React 19, Vite 6, D3.js, React Router 7
- **Smart Contracts:** Solidity 0.8.24, Hardhat
- **Blockchain:** Monad, ethers.js
- **Architecture:** Event-driven, real-time WebSocket, 
  simulated + live data modes

---

## References

- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004) — Agent Commerce Protocol
- [Monad MessageLog](https://docs.monad.xyz) — On-chain message log contract
- [Bankless Podcast (Feb 15, 2026)](https://www.bankless.com) — 99.5% noise ratio discussion
- [1Password: "From Magic to Malware"](https://1password.com) — MCP skill attack surface
- [Snyk: MCP Hub Credential Leaks](https://snyk.io) — 7.1% leak rate (283 skills)
- [Cisco: "What Would Elon Do"](https://cisco.com) — #1 downloaded skill = malware
- [Authmind: 824+ Malicious Skills](https://authmind.com) — Documented ClawHub threats

---

## License

[MIT](LICENSE) — Open source, verifiable, hack-friendly.

**Repo:** https://github.com/drewM33/clawmon
