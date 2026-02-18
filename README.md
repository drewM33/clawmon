# ClawMon

> A curated, attack-resistant, crypto-economically secured registry overlay for MCP skills, built on ERC-8004.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![Monad](https://img.shields.io/badge/Monad-Testnet-purple.svg)](https://monad.xyz)

---

## The Problem

**Two trust crises are colliding at the same time.**

1. **MCP Hub's skill registry has no trust layer.** 5,700+ skills, 230+ confirmed malicious. No identity verification, no feedback system, no trust scoring. 1Password, Snyk, Cisco, and Authmind have all published research showing it's an active attack surface.

2. **ERC-8004's own registries are already drowning in noise.** 22,000+ agents registered in the first 3 days, but only ~100 are legitimate. That's a 99.5% noise ratio. The discovery and reputation layers are overwhelmed before they can be useful.

**The deeper problem:** Reputation-based trust has an economic breakpoint. If accumulated reputation is worth 50K in future order flow, but a steal opportunity appears worth 100K, the rational move is to burn the reputation. Soft trust breaks at high stakes.

## The Solution

Trusted ClawMon is a **three-tier trust model** that solves both crises:

| Tier | Trust Type | Mechanism | What It Proves |
|------|-----------|-----------|----------------|
| **Tier 1** | Soft Trust | Community reputation scores from ERC-8004 feedback | Peers vouch for quality |
| **Tier 2** | Economic Trust | MON staking with slashing, bonded reviews | Money at risk if you cheat |
| **Tier 3** | Hard Trust | TEE attestation, code-hash pinning | Cryptographic proof code hasn't changed |

**Plus:** Open feedback authorization as the price of admission — skills that refuse to be rated don't get listed. Refusal IS the signal.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     DATA SOURCES                         │
│  MCP Hub (3,002 real skills) + ERC-8004 (22,000+ agents) │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────────────┐ ┌────────────┐ ┌──────────────┐
   │ Monad MessageLog │ │ Monad      │ │ Monad        │
   │ Identity +       │ │ Smart      │ │ ERC-8004     │
   │ Feedback         │ │ Contracts  │ │ (read-only)  │
   └────────┬─────────┘ └─────┬──────┘ └──────┬───────┘
          │            │             │
          ▼            ▼             ▼
   ┌─────────────────────────────────────────┐
   │          SCORING ENGINE                  │
   │  Naive (attackable) ↔ Hardened (secure)  │
   │  + Stake-weighted    + TEE-verified      │
   └──────────────────────┬──────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌───────────┐ ┌──────────────┐
   │  4 Attack   │ │ x402      │ │  Governance  │
   │  Modules    │ │ Payments  │ │  (on-chain)  │
   └──────┬──────┘ └─────┬─────┘ └──────┬───────┘
          │              │              │
          ▼              ▼              ▼
   ┌─────────────────────────────────────────┐
   │       React Dashboard + WebSocket API    │
   │    Evidence-board theme · Real-time viz  │
   └─────────────────────────────────────────┘
```

### Smart Contracts (Solidity on Monad)

| Contract | Purpose |
|----------|---------|
| `TrustStaking.sol` | Publisher + curator staking, dynamic min stake, 7-day unbonding |
| `AttestationRegistry.sol` | On-chain TEE attestation verification, code-hash pinning |
| `InsurancePool.sol` | Slash-funded victim compensation, automated claims |
| `SkillPaywall.sol` | x402 micropayment routing, fee splits |
| `Governance.sol` | On-chain parameter governance, proposal voting |

### Attack Modules

| Attack | What It Tests | Real-World Mapping |
|--------|--------------|-------------------|
| **Sybil Farming** | Fake skills colluding with mutual reviews | MCP Hub's 230+ malicious skills |
| **Reputation Launder** | Trusted skill goes rogue after building score | Griffith's bot exfiltration attempt |
| **Attestation Poison** | Mass negative reviews to destroy honest skills | Coordinated review bombing |
| **Trust Arbitrage** | Cross-chain trust fragmentation (live Monad reads) | ERC-8004 multi-chain noise |

---

## Quick Start (Demo Mode — No Credentials Needed)

**Clone, install, and see everything working in under 5 minutes.**

```bash
# 1. Clone the repository
git clone https://github.com/your-org/trusted-clawmon.git
cd trusted-clawmon

# 2. One-command setup (installs everything, starts the system)
./scripts/setup.sh --demo
```

That's it. The setup script will:
- Install Node.js dependencies (root + dashboard)
- Compile Solidity contracts
- Create a `.env` configured for demo mode
- Start the API server (port 3001) and React dashboard (port 5173)

**Open http://localhost:5173** to see the dashboard.

### Manual Demo Setup

If you prefer to do it step by step:

```bash
# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Compile smart contracts
npx hardhat compile --config hardhat.config.cjs

# Create demo .env (no external credentials needed)
cp .env.demo .env

# Start the API server
npm run dev:server &

# Start the dashboard
npm run dev:dashboard
```

### What You'll See

1. **Trust Leaderboard** — 50 skills ranked by hardened trust score, showing how sybil filtering catches colluding publishers
2. **Network Graph** — D3 force-directed graph of feedback relationships, with sybil clusters highlighted in red
3. **Staking Economics** — Publisher stakes, curator delegation, slash history, insurance pool state
4. **TEE Attestation** — Code-hash verification status, SGX/TDX attestation freshness
5. **x402 Payments** — Per-use micropayment activity, revenue splits, trust signals from payment patterns
6. **Governance** — On-chain proposal voting, parameter tuning, quorum tracking
7. **Real-time Events** — Submit feedback via the API and watch scores update live via WebSocket

### Demo Walkthrough

**Step 1: Explore the Leaderboard**
- Visit http://localhost:5173 — the dashboard loads 50 seeded skills with pre-computed trust scores
- Notice how legitimate skills (gmail-integration, github-token) rank high with Tier 1-2 trust
- Notice how flagged malicious skills (what-would-elon-do, crypto-wallet-helper) are penalized

**Step 2: Inspect the Sybil Ring**
- Click on any `sybil-*` skill — see how naive scoring gives them high scores (85+)
- Toggle to hardened scoring — graph analysis detects mutual feedback and drops them to Tier 0

**Step 3: Check Staking Economics**
- Navigate to the Staking panel — see publisher stakes ranging from 0.1 to 50 ETH
- View slash history — malicious skills have been slashed, reducing their effective trust
- Check the Insurance Pool — funded by 30% of slash proceeds, available for victim claims

**Step 4: Submit Live Feedback**
```bash
curl -X POST http://localhost:3001/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"agentId":"gmail-integration","clientAddress":"demo-reviewer","value":92,"tag1":"communication"}'
```
- Watch the dashboard update in real-time via WebSocket

**Step 5: Explore the API**
```bash
# All agents with scores
curl http://localhost:3001/api/agents | jq '.[0]'

# Trust graph
curl http://localhost:3001/api/graph | jq '.nodes | length'

# Staking overview
curl http://localhost:3001/api/staking/overview | jq '.[0]'

# TEE attestation stats
curl http://localhost:3001/api/tee/stats | jq

# Governance proposals
curl http://localhost:3001/api/governance/proposals | jq '.[0]'
```

---

## Full Setup (With Monad Testnet)

For the full experience with real MessageLog contract and on-chain data:

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **Monad Testnet Account** — free at the [Monad testnet faucet](https://faucet.monad.xyz)

### Setup

```bash
# 1. Install dependencies
npm install
cd dashboard && npm install && cd ..

# 2. Compile contracts
npm run compile:contracts

# 3. Copy and configure environment
cp .env.example .env
# Edit .env with your Monad credentials:
#   MONAD_PRIVATE_KEY=0x...
#   MESSAGELOG_CONTRACT_ADDRESS=0x...

# 4. Deploy MessageLog contract on testnet (or use existing)
npm run setup

# 5. Seed data to MessageLog contract
npm run seed

# 6. Start the server
npm run dev:server

# 7. In another terminal, start the dashboard
npm run dev:dashboard
```

### Environment Validation

Run the validation script to check that everything is configured:

```bash
./scripts/validate-env.sh
```

This checks: Node.js version, npm, dependencies, environment variables, contract compilation, and (optionally) Monad connectivity.

---

## Production Deployment

The system is designed as two independently deployable services:

| Component | Recommended Host | What It Runs |
|-----------|-----------------|--------------|
| **Dashboard** (React SPA) | Vercel | Static frontend — calls the API server |
| **API Server** (Express + WS) | Railway, Render, Fly.io | REST API, WebSocket, Monad integration |

### 1. Deploy the API Server (Railway / Render / Fly.io)

The API server is a standard Node.js/TypeScript app with an Express REST API and WebSocket endpoint.

**Build & start commands:**

```bash
# Build
npm install && npm run build

# Start
npm start
```

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (Railway/Render set this automatically) |
| `DEMO_MODE` | Set to `true` for demo data without Monad credentials |
| `CORS_ORIGIN` | Your Vercel dashboard URL, e.g. `https://trusted-clawmon.vercel.app` |
| `MONAD_PRIVATE_KEY` | Monad testnet private key (skip if `DEMO_MODE=true`) |
| `MESSAGELOG_CONTRACT_ADDRESS` | MessageLog contract for identity + feedback messages |
| `MONAD_RPC_URL` | Monad RPC for ERC-8004 reads (default: public endpoint) |
| `STAKING_CONTRACT_ADDRESS` | Deployed TrustStaking contract (optional) |
| `ATTESTATION_CONTRACT_ADDRESS` | Deployed AttestationRegistry contract (optional) |
| `INSURANCE_CONTRACT_ADDRESS` | Deployed InsurancePool contract (optional) |
| `DEPLOYER_PRIVATE_KEY` | Private key for contract interactions (optional) |

<details>
<summary><strong>Railway deployment</strong></summary>

1. Connect your GitHub repo in the Railway dashboard
2. Set the **Root Directory** to `/` (project root)
3. Railway auto-detects Node.js — set build command to `npm install && npm run build`
4. Set start command to `npm start`
5. Add all environment variables above in the Railway Variables tab
6. Deploy — Railway assigns a public URL like `https://trusted-clawmon-api.up.railway.app`

</details>

<details>
<summary><strong>Render deployment</strong></summary>

1. Create a new **Web Service** connected to your GitHub repo
2. Set **Build Command**: `npm install && npm run build`
3. Set **Start Command**: `npm start`
4. Add environment variables in the Render dashboard
5. Deploy — Render assigns a URL like `https://api-clawmon.onrender.com`

</details>

### 2. Deploy the Dashboard to Vercel

The dashboard is a Vite + React SPA in the `dashboard/` directory.

**Option A: Vercel CLI**

```bash
cd dashboard
npx vercel --prod
```

**Option B: Vercel Dashboard (GitHub integration)**

1. Import your GitHub repo in the [Vercel Dashboard](https://vercel.com/new)
2. Set the **Root Directory** to `dashboard`
3. Vercel auto-detects Vite — build command and output directory are configured in `vercel.json`
4. Add environment variables (see below)
5. Deploy

**Required environment variables (set in Vercel Dashboard → Settings → Environment Variables):**

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Full URL of your deployed API server | `https://trusted-clawmon-api.up.railway.app` |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect v2 project ID | `abc123...` |
| `VITE_MONAD_RPC_URL` | Monad RPC URL (optional) | `https://testnet.monad.xyz` |
| `VITE_MESSAGELOG_CONTRACT_ADDRESS` | MessageLog contract address (optional, display only) | `0x...` |

> **Important:** `VITE_*` variables are embedded at build time. After changing them in the Vercel dashboard, you must redeploy for changes to take effect.

### 3. Connect the Two Services

After both are deployed:

1. **API Server**: Set `CORS_ORIGIN` to your Vercel dashboard URL (e.g. `https://trusted-clawmon.vercel.app`). Multiple origins can be comma-separated.
2. **Dashboard**: Set `VITE_API_URL` to your API server URL (e.g. `https://trusted-clawmon-api.up.railway.app`). Redeploy the dashboard after setting this.
3. **Verify**: Open the dashboard URL — it should load data from the API server, and the WebSocket indicator should show connected.

### Architecture (Production)

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│         Vercel (CDN)         │     │  Railway / Render / Fly.io   │
│                              │     │                              │
│  React SPA (static files)    │────▶│  Express API (REST + WS)     │
│  dashboard/dist/             │ API │  src/server.ts               │
│                              │     │                              │
│  VITE_API_URL ───────────────┼─────┤  CORS_ORIGIN ◀──────────────│
│                              │     │                              │
└──────────────────────────────┘     │  ┌────────────────────┐    │
                                     │  │ Monad MessageLog + │    │
                                     │  │ ERC-8004           │    │
                                     │  └────────────────────┘    │
                                     └──────────────────────────────┘
```

---

## Project Structure

```
trusted-clawmon/
├── contracts/              # Solidity smart contracts (Monad)
│   ├── TrustStaking.sol
│   ├── AttestationRegistry.sol
│   ├── InsurancePool.sol
│   ├── SkillPaywall.sol
│   └── Governance.sol
├── src/                    # TypeScript backend
│   ├── server.ts           # Express API + seed data
│   ├── scoring/            # Naive + hardened scoring engines
│   ├── mitigations/        # Sybil detection, velocity, graph analysis
│   ├── staking/            # Stake management, insurance, weighting
│   ├── attestation/        # Cross-chain attestation bridge
│   ├── tee/                # TEE enclave, verification, service
│   ├── ethereum/           # ERC-8004 read-only clients
│   ├── monad/              # MessageLog contract client (ethers.js)
│   ├── payments/           # x402 micropayment integration
│   ├── governance/         # On-chain governance service
│   └── events/             # WebSocket + event emitter
├── dashboard/              # React + Vite frontend
│   └── src/
│       ├── App.tsx
│       ├── components/     # UI panels (Staking, TEE, Governance, etc.)
│       └── hooks/          # useApi, useWebSocket
├── scripts/                # Setup, seed, deploy, test scripts
│   ├── setup.sh            # One-command onboarding
│   ├── validate-env.sh     # Environment validation
│   ├── setup-monad.ts      # Deploy MessageLog contract
│   ├── seed-phase1.ts      # Seed skill + feedback data
│   ├── demo-realtime.ts    # Real-time demo script
│   └── deploy/             # Contract deployment scripts
├── test/                   # Hardhat contract tests
├── .env.example            # Full environment template
├── .env.demo               # Zero-config demo environment
└── README.md               # You are here
```

## API Reference

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents` | All agents with naive + hardened + stake-weighted scores |
| `GET` | `/api/agents/:id` | Agent detail with score breakdown + mitigation flags |
| `GET` | `/api/leaderboard` | Agents ranked by hardened score |
| `GET` | `/api/graph` | Feedback relationship graph (nodes + edges + sybil clusters) |
| `GET` | `/api/stats` | Aggregate statistics |
| `POST` | `/api/feedback` | Submit feedback (triggers real-time WebSocket broadcast) |

### Staking (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/staking/stats` | Aggregate staking statistics |
| `GET` | `/api/staking/overview` | All agents' staking summary |
| `GET` | `/api/staking/slashes` | All slash history |
| `GET` | `/api/staking/:id` | Agent staking detail + slash history |

### Attestation (Phase 5)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/attestation/stats` | Aggregate attestation statistics |
| `GET` | `/api/attestation/overview` | All agents' attestation status |
| `GET` | `/api/attestation/:id` | Agent attestation detail |

### Insurance (Phase 6)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/insurance/stats` | Insurance pool statistics |
| `GET` | `/api/insurance/claims` | All insurance claims |
| `GET` | `/api/insurance/pool` | Pool balance and state |
| `GET` | `/api/insurance/:id` | Agent insurance claims |

### TEE Attestation (Phase 8)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tee/stats` | Aggregate TEE statistics |
| `GET` | `/api/tee/overview` | All agents' TEE status |
| `GET` | `/api/tee/:id` | Agent TEE attestation detail |
| `POST` | `/api/tee/submit` | Submit TEE attestation |
| `POST` | `/api/tee/pin` | Pin a code hash |

### Payments (Phase 9)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/payments/stats` | Aggregate payment statistics |
| `GET` | `/api/payments/overview` | All skills' payment profiles |
| `GET` | `/api/payments/activity` | Recent payment activity feed |
| `GET` | `/api/payments/:id` | Skill payment profile |
| `POST` | `/api/payments/pay` | Process x402 payment |

### Governance (Phase 10)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/governance/stats` | Aggregate governance statistics |
| `GET` | `/api/governance/proposals` | All proposals |
| `GET` | `/api/governance/proposals/active` | Active + queued proposals |
| `GET` | `/api/governance/proposals/:id` | Proposal detail with votes |
| `GET` | `/api/governance/parameters` | All governable parameters |
| `POST` | `/api/governance/proposals` | Create a new proposal |
| `POST` | `/api/governance/proposals/:id/vote` | Cast a vote |

### WebSocket

Connect to `ws://localhost:3001/ws` for real-time events:
- `feedback:new` — New feedback submitted
- `score:updated` — Agent score recalculated
- `leaderboard:updated` — Rankings changed
- `stats:updated` — Aggregate stats refreshed
- `graph:updated` — Network graph changed

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:server` | Start API server with hot reload |
| `npm run dev:dashboard` | Start React dashboard (Vite) |
| `npm run dev:all` | Start both server + dashboard |
| `npm run compile:contracts` | Compile Solidity contracts (Hardhat) |
| `npm run setup` | Deploy MessageLog contract on Monad testnet |
| `npm run seed` | Seed data to MessageLog contract |
| `npm run seed:quick` | Quick seed (10 skills, ~50 feedback) |
| `npm run demo` | Start full demo (server + dashboard + demo mode) |
| `npm run demo:realtime` | Run real-time attack demo |
| `npm run test:staking` | Run Hardhat staking contract tests |
| `npm run test:attestation` | Run attestation contract tests |
| `npm run test:governance` | Run governance contract tests |
| `npm run test:paywall` | Run paywall contract tests |
| `npm run validate` | Run environment validation |

---

## Tech Stack

- **Backend:** TypeScript, Express 5, WebSocket (ws)
- **Frontend:** React 19, Vite 6, D3.js, React Router 7
- **Smart Contracts:** Solidity 0.8.24, Hardhat
- **Blockchain:** Monad (MessageLog contract + Smart Contracts, contract view calls), ethers.js
- **Architecture:** Event-driven, real-time WebSocket streaming, simulated + live data modes

## References

- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004) — Agent Commerce Protocol
- [Monad MessageLog](https://docs.monad.xyz) — On-chain message log contract with view calls (migrated from Hedera)
- [Bankless Podcast (Feb 15, 2026)](https://www.bankless.com) — Crapis on 99.5% noise ratio
- [1Password: "From Magic to Malware"](https://1password.com) — MCP skill attack surface
- [Snyk: MCP Hub Credential Leaks](https://snyk.io) — 7.1% leak rate (283 skills)
- [Cisco: "What Would Elon Do"](https://cisco.com) — #1 downloaded skill = malware
- [Authmind: 230+ Malicious Skills](https://authmind.com) — Documented MCP Hub threats

## License

[MIT](LICENSE) — Open source, hack-friendly.
