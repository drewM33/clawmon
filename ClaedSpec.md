# Trusted ClawMon — Technical Specification

> A curated, attack-resistant, crypto-economically secured registry overlay for OpenClaw skills, built on ERC-8004.
> Monad MessageLog contract for reputation data + Monad smart contracts for staking/slashing + Monad ERC-8004 for cross-chain arbitrage proof.
> Soft trust (reputation) + Economic trust (staking) + Hard trust (TEE attestation) = three-tier security model for AI agents.

---

## 1. Project Overview

### The Problem

**Two trust crises are colliding at the same time.**

**Crisis 1: ClawMon's skill registry has no trust layer.** 5,700+ skills, 230+ confirmed malicious. The registry's own docs state "all code downloaded from the library will be treated as trusted code." 1Password, Snyk, Cisco, and Authmind have all published research in the last 2 weeks showing it's an active attack surface. No identity verification, no feedback system, no trust scoring.

**Crisis 2: ERC-8004's own registries are already drowning in noise.** Davide Crapis (EF/ERC-8004 co-author) confirmed on the Bankless podcast (Feb 15, 2026): 22,000+ agents registered in the first 3 days, but only ~100 are legitimate services. That's a 99.5% noise ratio. Austin Griffith calls it "the wild west — 10,000 fake agents and 100 really good ones." The discovery and reputation layers that ERC-8004 provides are already overwhelmed before they can be useful.

**The deeper problem Crapis identifies:** Reputation-based trust has an economic breakpoint. If an agent's accumulated reputation is worth 50K in future order flow, but a steal opportunity appears worth 100K, the rational move is to burn the reputation. Soft trust (reviews/feedback) breaks at high stakes. Hard trust (TEE attestation, crypto-economic validation) is needed but not yet live in ERC-8004.

**Meanwhile, real money is at stake today.** Austin Griffith's OpenClaw bot controls hundreds of thousands of dollars in a wallet. It nearly exfiltrated its own private key before being physically stopped. It deployed a FOMO3D game that attracted a $40K pot overnight. These aren't theoretical scenarios — agents are already operating autonomously with real funds, and the trust infrastructure doesn't exist yet.

### The Solution

Trusted ClawMon is a curated registry overlay that solves both crises simultaneously:

1. **Open feedback authorization is the price of admission.** To be listed, a skill/agent must register on ERC-8004's IdentityRegistry and set feedbackAuth to "open" — anyone can submit feedback. If you refuse to be rated, you don't get listed. Refusal IS the signal. This filters 99.5% of ERC-8004's noise immediately.
2. **Community-driven trust scores** computed from ERC-8004 ReputationRegistry feedback, with adversarial mitigations baked in to address Crapis's economic breakpoint concern.
3. **Automatic delisting** when skills revoke open auth or drop below minimum trust thresholds.
4. **Adversarial stress testing** — four attack modules that prove the system works under hostile conditions, directly mapping to real incidents: ClawMon malware (sybil/launder), Griffith's bot private key exfiltration attempt (launder), and cross-chain trust fragmentation (arbitrage).

### What It Is

- A Node.js backend that reads/writes ERC-8004-aligned data to Monad MessageLog contract
- A scoring engine (naive + hardened) that computes trust tiers from feedback, with stake-weighted reputation
- A staking and slashing layer (Solidity on Monad) that adds crypto-economic security — publisher staking, bonded reviews, curator delegation, dynamic stake requirements, and automated/arbiter-driven slashing
- A TEE attestation layer (Tier 3) providing cryptographic proof that agent code hasn't changed
- An insurance pool funded by slash redistribution to compensate users harmed by malicious skills
- Cross-chain stake recognition propagating trust across Monad/Ethereum/Base
- A liquid staking derivative (tcMON) allowing staked MON to remain productive in DeFi
- x402 micropayment integration for per-use skill payments funding protocol treasury
- Four adversarial attack modules that test the scoring system with and without staking economics
- A React dashboard that visualizes attacks in real-time with toggleable mitigations
- A noise ratio dashboard showing live registered vs. staked vs. trusted agent counts across all ERC-8004 deployments
- Cross-chain arbitrage proof via live Monad ERC-8004 contract reads
- Seeded with real OpenClaw skill data from ClawMon

### What It Is NOT

- Not a separate blockchain (staking runs on Monad's EVM layer)
- Not a replacement for ClawMon (it's an overlay that adds trust scoring + economic security)
- Not a token launch (uses native MON for staking, no protocol token in v1)
- Not a production system (intentionally attackable to demonstrate vulnerabilities + mitigations)

### Why Now

- **Jan 29, 2026**: ERC-8004 contracts deploy on Ethereum mainnet
- **Jan 31, 2026**: 22,000+ agents register in first 3 days; only ~100 are legitimate
- **Feb 2, 2026**: 1Password publishes "From magic to malware" — OpenClaw skills as attack surface
- **Feb 7, 2026**: Snyk finds 7.1% of ClawMon skills (283) leak credentials
- **Feb 9, 2026**: Vitalik calls for ERC-8004 reputation for agent economies
- **Feb 10, 2026**: Cisco flags "What Would Elon Do?" skill — #1 downloaded, actually malware
- **Feb 10, 2026**: Austin Griffith's OpenClaw bot nearly exfiltrates its own private key; controls $100K+ in wallet
- **Feb 11, 2026**: Authmind documents 230+ malicious skills on ClawMon
- **Feb 14, 2026**: Griffith's bot deploys FOMO3D game, pot reaches $40K overnight
- **Feb 15, 2026**: Bankless podcast airs — Crapis confirms 99.5% noise ratio on ERC-8004, describes economic breakpoint of reputation trust; Griffith calls 8004 "the wild west"
- **Feb 17, 2026**: Monad DevDay in Denver
- **Feb 18-21, 2026**: ETHDenver BUIDLathon

### Key Constraints

- Solo builder
- Must run on Monad testnet (Monad bounty target)
- Must demonstrate real cross-chain data (Monad ERC-8004 reads)
- Dashboard must be visually compelling for a 3-minute demo
- All code open-source (MIT license)

---

## 2. Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────┐
│                    DATA SOURCES                      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ClawMon/awesome-openclaw-skills                     │
│  (3,002 real skills with publisher metadata)         │
│                                                      │
│  ERC-8004 Mainnet Registry                           │
│  (22,000+ registered, ~100 legit — 99.5% noise)     │
│       │                                              │
│       ▼                                              │
│  ┌──────────────┐    ┌──────────────────────┐       │
│  │ Monad        │    │ Monad ERC-8004      │       │
│  │ MessageLog   │    │ (arbitrage reads)   │       │
│  │              │    │                      │       │
│  │ Identity     │    │ IdentityRegistry     │       │
│  │ Topic        │    │ 0x8004A818...BD9e    │       │
│  │              │    │                      │       │
│  │ Feedback     │    │ ReputationRegistry   │       │
│  │ Topic        │    │ 0x8004B663...8713    │       │
│  └──────┬───────┘    └──────────┬───────────┘       │
│         │                       │                    │
└─────────┼───────────────────────┼────────────────────┘
          │                       │
          ▼                       ▼
┌─────────────────────────────────────────────────────┐
│           TEE ATTESTATION LAYER (Tier 3)             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  TEEAttestationVerifier.sol — on-chain verification │
│  Attestation records in MessageLog — signed code hashes │
│  Code-hash pinning — immutable agent identity       │
│                                                      │
│  SGX/TDX/SEV attestation | DCAP verification        │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│          STAKING LAYER (Monad)                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  TrustStaking.sol — publisher + curator staking     │
│  SlashManager.sol — proposals, arbiters, execution  │
│  ReviewBonding.sol — bonded reviews, slashable      │
│  ProtocolTreasury.sol — fee routing, insurance pool │
│  InsurancePool.sol — automated victim compensation  │
│  LiquidStaking.sol — tcMON minting/redemption      │
│                                                      │
│  MON-denominated | 7-day unbonding | 3-of-5 arb.   │
│  Dynamic min stake | x402 fee routing | tcMON       │
│                                                      │
├─────────────────────────────────────────────────────┤
│         CROSS-CHAIN STAKE RECOGNITION                │
│                                                      │
│  StakeBridge.sol — propagate stake across chains    │
│  Monad ←→ Ethereum ←→ Base                           │
│  Partial credit for foreign-chain stakes             │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                 SCORING ENGINE                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────┐  ┌─────────────────────┐       │
│  │  Naive Engine    │  │  Hardened Engine     │       │
│  │  (attack target) │  │  (mitigations ON)    │       │
│  │                  │  │                      │       │
│  │  Simple average  │  │  + Graph analysis    │       │
│  │  No decay        │  │  + Temporal decay    │       │
│  │  Equal weight    │  │  + Submitter weight  │       │
│  │  No filtering    │  │  + Velocity monitor  │       │
│  │                  │  │  + Stake-weighted rep │       │
│  └─────────────────┘  └─────────────────────┘       │
│                                                      │
│  Open Auth Filter: skills without open feedbackAuth  │
│  are excluded from all queries and scoring           │
│                                                      │
│  Stake Integration: reads stake state via RPC reads, │
│  combines with reputation for unified Tier 0-3       │
│                                                      │
│  Stake-Weighted Rep: higher-staked reviewers get     │
│  proportionally more scoring weight                  │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              PAYMENT LAYER (x402)                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  x402 micropayments — per-use skill payments        │
│  Fee split: skill publisher + protocol treasury     │
│  Treasury funds staking yields + insurance pool     │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              ATTACK MODULES                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. Sybil Farming     — fake skills colluding        │
│  2. Reputation Launder — trusted skill goes rogue    │
│  3. Attestation Poison — mass negative reviews       │
│  4. Trust Arbitrage    — cross-chain fragmentation   │
│     (reads real Monad ERC-8004 data)                 │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│           DASHBOARD + API                            │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Express server (port 3001)                          │
│  ├─ POST /api/attacks/:type                          │
│  ├─ GET  /api/attacks/status                         │
│  ├─ GET  /api/noise-ratio                            │
│  └─ WebSocket broadcast (attack events)              │
│                                                      │
│  React dashboard (evidence board theme)              │
│  ├─ Sybil: D3 force graph                           │
│  ├─ Launder: SVG area chart with threshold           │
│  ├─ Poison: Bar chart with tier colors               │
│  ├─ Arbitrage: 3 case cards (Monad/Mainnet)         │
│  ├─ Noise Ratio: live registered/staked/trusted      │
│  └─ Mitigation toggles per panel                     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Data Flow

1. **Seed**: Parse real ClawMon skill data → write to Monad MessageLog contract as ERC-8004 identity registrations
2. **List**: Skills with `feedbackAuth: 'open'` are included in the Trusted ClawMon registry
3. **Feedback**: Community feedback written to MessageLog contract as ERC-8004 `giveFeedback` messages
4. **Score**: Scoring engine reads feedback via RPC reads → computes trust tiers (AAA through C)
5. **Attack**: Attack modules submit adversarial feedback → scoring engine shows vulnerability
6. **Mitigate**: Hardened engine applies graph analysis, decay, weighting → shows defense
7. **Arbitrage**: Read same agent's data from Monad ERC-8004 contracts → show trust fragmentation

---

## 3. The Open Auth Requirement

### Why This Matters

In ERC-8004, agents must authorize who can give them feedback via `feedbackAuth`. A malicious skill publisher would reject negative reviews and only authorize sybil accounts for positive ones. The standard's defense becomes the attacker's tool.

**Trusted ClawMon flips this:** open feedback authorization is the listing requirement.

### How It Works

```typescript
// src/registry/listing.ts

interface ListingRequirement {
  // Agent must be registered on ERC-8004 IdentityRegistry
  hasIdentity: boolean;
  // Agent must have feedbackAuth set to 'open' (anyone can submit)
  feedbackAuthOpen: boolean;
  // Agent must maintain minimum feedback count (prevents ghost listings)
  minFeedbackCount: number; // default: 5
}

function isEligibleForListing(agent: AgentIdentity): boolean {
  return agent.hasIdentity 
    && agent.feedbackAuthPolicy === 'open'
    && agent.feedbackCount >= MIN_FEEDBACK_COUNT;
}

function checkDelistingTriggers(agent: AgentIdentity): DelistReason | null {
  // Revoked open auth → immediate delist
  if (agent.feedbackAuthPolicy !== 'open') return 'AUTH_REVOKED';
  // Score dropped below minimum → delist after grace period
  if (agent.trustScore < MINIMUM_SCORE) return 'LOW_SCORE';
  // No activity for 30 days → delist
  if (agent.daysSinceLastFeedback > 30) return 'INACTIVE';
  return null;
}
```

### The Tradeoff (and why it's acceptable)

- **Downside**: Open auth means anyone can leave feedback, including attackers (poisoning)
- **Upside**: This is exactly what the mitigation engine is for — submitter weighting, anomaly detection, cooldown periods
- **The alternative is worse**: Selective auth means the skill controls its own reputation, which is the current ClawMon problem

---

## 4. Real Data Integration

### ClawMon Skill Data

Source: `VoltAgent/awesome-openclaw-skills` GitHub repo (3,002 curated skills)

```typescript
// scripts/seed-clawmon-data.ts

interface ClawMonSkill {
  name: string;           // e.g. "gmail", "github-token", "deep-research-agent"
  description: string;    // from the awesome list
  publisher: string;      // GitHub username or org
  category: string;       // e.g. "productivity", "developer", "communication"
  url: string;            // ClawMon or GitHub URL
  isFlagged: boolean;     // true if in known-malicious list
}

// Parse the awesome-openclaw-skills README.md
// Extract skill entries with metadata
// Write to Monad MessageLog contract as ERC-8004 identity registrations
// Generate synthetic community feedback for demo purposes:
//   - Legitimate skills: 10-50 positive feedback (value 70-95)
//   - Flagged skills: mixed feedback (some positive from sybils, negatives from community)
//   - New skills: 0-5 feedback (demonstrates cold-start problem)
```

### Monad ERC-8004 Integration (Arbitrage Only)

```typescript
// src/ethereum/client.ts

import { ethers } from 'ethers';

const MONAD_RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const provider = new ethers.JsonRpcProvider(MONAD_RPC);

// Read-only — no transactions needed for arbitrage proof
const MONAD_IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const MONAD_REPUTATION = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

// Also reference mainnet contracts (read-only)
const MAINNET_IDENTITY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const MAINNET_REPUTATION = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
```

The arbitrage attack reads from:
1. **Monad MessageLog contract** (your Trusted ClawMon) — agent has score + tier
2. **Monad ERC-8004** — same agent queried via `getSummary()` — different or no data
3. **Ethereum Mainnet ERC-8004** — same agent queried — different or no data

This demonstrates real cross-chain trust fragmentation using real deployed contracts.

---

## 5. File Structure

```
trusted-clawmon/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── SPEC.md
│
├── contracts/
│   ├── TrustStaking.sol              # Publisher + curator staking, dynamic min stake
│   ├── SlashManager.sol              # Proposals, arbiters, execution
│   ├── ReviewBonding.sol             # Bonded reviews, slashable
│   ├── ProtocolTreasury.sol          # Fee routing, x402 fee splits
│   ├── InsurancePool.sol             # Automated victim compensation
│   ├── LiquidStaking.sol            # tcMON minting/redemption
│   ├── TEEAttestationVerifier.sol   # On-chain TEE attestation verification
│   └── StakeBridge.sol              # Cross-chain stake recognition
│
├── scripts/
│   ├── setup-monad.ts               # Deploy MessageLog contract
│   ├── seed-clawmon-data.ts         # Parse & seed real skill data
│   └── seed-agents.ts               # Seed honest agents for attacks
│
├── src/
│   ├── monad/
│   │   ├── client.ts                # Monad testnet client (ethers.js)
│   │   ├── message-log.ts           # MessageLog contract create/submit/read
│   │   └── accounts.ts              # Account creation helpers
│   │
│   ├── ethereum/
│   │   ├── client.ts                # ethers.js provider (Monad + Mainnet read-only)
│   │   ├── erc8004.ts               # Contract instances + getSummary/getIdentity
│   │   └── stake-bridge.ts          # Cross-chain stake recognition reads
│   │
│   ├── tee/
│   │   ├── types.ts                 # TEEAttestation, AttestationResult, CodeHash
│   │   ├── verifier.ts              # Attestation verification logic
│   │   └── message-log-attestation.ts # Read/write attestation records to MessageLog
│   │
│   ├── registry/
│   │   ├── listing.ts               # Open auth requirement + delist logic
│   │   └── types.ts                 # ClawMonSkill, ListingRequirement, DelistReason
│   │
│   ├── scoring/
│   │   ├── types.ts                 # Feedback, FeedbackSummary, TrustTier, etc.
│   │   ├── reader.ts                # Read feedback via contract view calls / RPC reads
│   │   ├── engine.ts                # Naive scorer (attack target)
│   │   ├── hardened.ts              # Hardened scorer (mitigations)
│   │   └── stake-weighted.ts        # Stake-weighted reputation scoring
│   │
│   ├── staking/
│   │   ├── types.ts                 # StakeInfo, DelegationInfo, InsuranceClaim
│   │   ├── dynamic-stake.ts         # Dynamic minimum stake calculator
│   │   ├── insurance.ts             # Insurance pool management
│   │   └── liquid-staking.ts        # tcMON minting/redemption logic
│   │
│   ├── payments/
│   │   ├── types.ts                 # PaymentConfig, x402Receipt
│   │   └── x402.ts                  # x402 micropayment integration
│   │
│   ├── attacks/
│   │   ├── types.ts                 # AttackConfig, AttackStepResult, etc.
│   │   ├── sybil.ts                 # Sybil farming attack
│   │   ├── launder.ts               # Reputation laundering attack
│   │   ├── poison.ts                # Attestation poisoning attack
│   │   └── arbitrage.ts             # Cross-chain trust arbitrage (reads Monad)
│   │
│   ├── mitigations/
│   │   ├── types.ts                 # MitigationConfig
│   │   ├── graph.ts                 # Mutual feedback detection
│   │   ├── velocity.ts              # Spike + behavioral shift detection
│   │   └── index.ts                 # Barrel exports
│   │
│   ├── events/
│   │   ├── emitter.ts               # Singleton EventEmitter
│   │   ├── types.ts                 # Event types
│   │   └── ws-server.ts             # WebSocket broadcast
│   │
│   ├── cli/
│   │   ├── index.ts                 # Commander.js CLI
│   │   └── commands/
│   │       ├── sybil.ts
│   │       ├── launder.ts
│   │       ├── poison.ts
│   │       └── arbitrage.ts
│   │
│   └── server.ts                    # Express + WS server
│
└── dashboard/
    ├── package.json
    ├── vite.config.ts
    ├── DESIGN-SPEC.md
    └── src/
        ├── App.tsx                   # 2x2 grid + noise ratio, evidence board theme
        ├── App.css
        ├── hooks/
        │   ├── useWebSocket.ts
        │   └── useAttack.ts
        ├── components/
        │   ├── Panel.tsx
        │   ├── RunButton.tsx
        │   ├── MitigationToggle.tsx
        │   ├── StickyNote.tsx
        │   ├── MetricsRow.tsx
        │   └── viz/
        │       ├── SybilViz.tsx      # D3 force graph
        │       ├── LaunderViz.tsx    # SVG area chart
        │       ├── PoisonViz.tsx     # Bar chart
        │       ├── ArbitrageViz.tsx  # 3 case cards with real contract data
        │       └── NoiseRatioViz.tsx # Live registered/staked/trusted counters
        └── types.ts
```

---

## 6. Data Models

### ERC-8004 Aligned

```typescript
// src/scoring/types.ts

export interface Feedback {
  id: string;
  agentId: string;
  clientAddress: string;
  value: number;              // int128 equivalent
  valueDecimals: number;      // 0-18
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
  timestamp: number;
  messageLogSequenceNumber?: number;
  revoked: boolean;
}

export interface FeedbackSummary {
  agentId: string;
  feedbackCount: number;
  summaryValue: number;
  summaryValueDecimals: number;
  tier: TrustTier;
  accessDecision: AccessDecision;
}

export type TrustTier = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'CC' | 'C';
export type AccessDecision = 'full_access' | 'throttled' | 'denied';
```

### Registry Types

```typescript
// src/registry/types.ts

export interface ClawMonSkill {
  agentId: string;            // maps to ERC-8004 tokenId
  name: string;               // skill name from ClawMon
  description: string;
  publisher: string;          // GitHub username
  category: string;
  clawBarUrl?: string;
  githubUrl?: string;
  feedbackAuthPolicy: 'open' | 'selective' | 'closed';
  listed: boolean;
  listedAt?: number;
  delistedAt?: number;
  delistReason?: DelistReason;
}

export type DelistReason = 'AUTH_REVOKED' | 'LOW_SCORE' | 'INACTIVE' | 'MANUAL';

export interface ListingRequirement {
  hasIdentity: boolean;
  feedbackAuthOpen: boolean;
  minFeedbackCount: number;
}
```

### Arbitrage Cross-Chain View

```typescript
// Extended AttackStepResult for arbitrage

export interface SystemView {
  system: 'monad' | 'ethereum-mainnet';
  contractAddress?: string;
  score: number | null;
  tier: TrustTier | 'UNRATED';
  feedbackCount: number;
  isLive: boolean;            // true if data read from real contract
}
```

---

## 7. Ethereum Integration

### Monad + Mainnet Read-Only Client

```typescript
// src/ethereum/client.ts

import { ethers } from 'ethers';

const MONAD_RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const MAINNET_RPC = process.env.MAINNET_RPC_URL || 'https://eth.llamarpc.com';

export const monadProvider = new ethers.JsonRpcProvider(MONAD_RPC);
export const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC);
```

### ERC-8004 Contract Reads

```typescript
// src/ethereum/erc8004.ts

import { ethers } from 'ethers';
import { monadProvider, mainnetProvider } from './client.js';

// Minimal ABI — only read functions needed
const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) view returns (uint256 count, int128 summaryValue, uint8 summaryValueDecimals)'
];

const IDENTITY_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function agentURI(uint256 tokenId) view returns (string)'
];

// Contract addresses
const CONTRACTS = {
  monad: {
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
  mainnet: {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
};

export async function getAgentSummary(
  network: 'monad' | 'mainnet',
  agentId: number,
  clientAddresses: string[] = []
): Promise<{ count: number; value: number; decimals: number } | null> {
  const provider = network === 'monad' ? monadProvider : mainnetProvider;
  const contract = new ethers.Contract(
    CONTRACTS[network].reputation,
    REPUTATION_ABI,
    provider
  );
  
  try {
    const [count, summaryValue, decimals] = await contract.getSummary(
      agentId,
      clientAddresses,
      ethers.ZeroHash,
      ethers.ZeroHash
    );
    return {
      count: Number(count),
      value: Number(summaryValue),
      decimals: Number(decimals),
    };
  } catch {
    return null; // Agent not registered on this network
  }
}

export async function agentExists(
  network: 'monad' | 'mainnet',
  agentId: number
): Promise<boolean> {
  const provider = network === 'monad' ? monadProvider : mainnetProvider;
  const contract = new ethers.Contract(
    CONTRACTS[network].identity,
    IDENTITY_ABI,
    provider
  );
  
  try {
    await contract.ownerOf(agentId);
    return true;
  } catch {
    return false;
  }
}
```

---

## 8. Scoring Engine

### Naive Engine (Attack Target)

```typescript
// src/scoring/engine.ts
// Mirrors ERC-8004 getSummary — simple average, no decay, no weighting
// Open auth filter: only scores agents with feedbackAuthPolicy === 'open'

export function computeSummary(
  feedback: Feedback[],
  clientAddresses?: string[]
): FeedbackSummary {
  // Filter by clientAddresses if provided (ERC-8004 spec)
  // Simple average of feedback values
  // Map to trust tier (AAA-C) and access decision
}
```

### Hardened Engine (Mitigations)

```typescript
// src/scoring/hardened.ts
// Wraps naive engine with mitigation logic

export function computeHardenedSummary(
  feedback: Feedback[],
  config: MitigationConfig,
  allFeedback?: Feedback[]
): FeedbackSummary {
  // Sybil: detect mutual feedback pairs, discount 90%
  // Launder: exponential temporal decay (1-day half-life)
  // Poison: new submitter discount (80% for recent 20%)
  // Velocity: >10 feedback in 60s window discounted 50%
}
```

### Stake-Weighted Reputation Scoring

Reviews from higher-staked reviewers carry more weight in the scoring engine. This creates a market for review credibility — reviewers who stake more have more to lose if their reviews are slashed, so their reviews are more trustworthy.

```typescript
// src/scoring/stake-weighted.ts

export interface StakeWeightedConfig {
  enabled: boolean;
  // How much extra weight staked reviewers get
  // weight = 1 + (reviewerStake / baselineStake) * multiplierCap
  baselineStake: number;     // 10 MON — reviews at or below this get weight 1.0
  multiplierCap: number;     // 5.0 — maximum weight multiplier (prevents plutocracy)
  // Minimum stake to get any weight bonus
  minStakeForBonus: number;  // 5 MON
}

export function computeStakeWeightedSummary(
  feedback: Feedback[],
  reviewerStakes: Map<string, number>,  // clientAddress → staked amount
  config: StakeWeightedConfig
): FeedbackSummary {
  // For each feedback entry:
  //   1. Look up reviewer's stake from ReviewBonding contract
  //   2. Compute weight: min(multiplierCap, 1 + stake / baselineStake)
  //   3. Apply weight to feedback value in weighted average
  // 
  // A reviewer with 50 MON staked gets weight min(5.0, 1 + 50/10) = 5.0
  // A reviewer with 1 MON bond (minimum) gets weight 1.0
  // A reviewer with 0 stake gets weight 0 (shouldn't happen — bond required)
  //
  // This means a single high-stake reviewer can outweigh multiple
  // low-stake sybil accounts, making sybil attacks even more expensive
}
```

### Open Auth Filter

```typescript
// src/registry/listing.ts

export function filterByOpenAuth(
  agents: ClawMonSkill[],
  feedback: Feedback[]
): ClawMonSkill[] {
  return agents.filter(agent => {
    if (agent.feedbackAuthPolicy !== 'open') return false;
    const agentFeedback = feedback.filter(f => f.agentId === agent.agentId);
    return agentFeedback.length >= MIN_FEEDBACK_COUNT;
  });
}
```

---

## 9. Attack Modules

### Sybil Farming
- "Fake agents" → "Fake skill publishers"
- Sybil agents register as ClawMon skills with open auth
- Sybil skills collude by submitting mutual positive feedback
- Demonstrates how batch-minted identities game the trust scores

### Launder — Reputation Laundering
- Target is a real skill name (e.g., "gmail-integration")
- Phase 1: builds trust as legitimate skill
- Phase 2: simulates malicious update (community submits negative feedback)
- Laundering window metric shows how long the skill stays "trusted" post-pivot

### Poison — Attestation Poisoning
- Target is a real skill name (e.g., "deep-research-agent")
- Attacker creates fake publisher accounts
- Each submits negative feedback against the legitimate skill
- Shows cost asymmetry: cheap to destroy, expensive to build

### Arbitrage — Cross-Chain Trust Fragmentation (Real Ethereum Reads)

```typescript
// src/attacks/arbitrage.ts

export async function* runArbitrageAttack(topicId: string, config: ArbitrageConfig) {
  const agentId = config.agentId || 'gmail-integration';
  
  // 1. Read from Monad MessageLog contract (your Trusted ClawMon)
  const monadFeedback = await readFeedback(messageLogAddress);
  const monadSummary = computeSummary(
    monadFeedback.filter(f => f.agentId === agentId)
  );
  
  // 2. Read from Monad ERC-8004 (REAL contract call)
  const monadContractSummary = await getAgentSummary('monad', numericAgentId);
  
  // 3. Read from Mainnet ERC-8004 (REAL contract call)
  const mainnetSummary = await getAgentSummary('mainnet', numericAgentId);
  
  // 4. Yield step with real cross-chain data
  yield {
    type: 'arbitrage',
    round: 1,
    systemViews: [
      {
        system: 'monad',
        contractAddress: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
        score: monadContractSummary?.value ?? monadSummary.summaryValue,
        tier: monadContractSummary ? computeTier(monadContractSummary.value) : monadSummary.tier,
        feedbackCount: monadContractSummary?.count ?? monadSummary.feedbackCount,
        isLive: true,
      },
      {
        system: 'ethereum-mainnet',
        contractAddress: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
        score: mainnetSummary?.value ?? null,
        tier: mainnetSummary ? computeTier(mainnetSummary.value) : 'UNRATED',
        feedbackCount: mainnetSummary?.count ?? 0,
        isLive: true, // REAL contract read
      },
    ],
    maxScoreGap: computeMaxGap(systemViews),
  };
}
```

---

## 10. Mitigation Toggles

The hardened engine implements the following mitigations, each toggleable independently:

| Attack | Mitigation | Effect |
|---|---|---|
| Sybil | Graph analysis | Detect mutual feedback pairs, discount 90% |
| Sybil | Velocity check | >10 feedback in 60s → discount 50% |
| Sybil | Stake-weighted rep | Higher-staked reviewers outweigh sybil accounts |
| Launder | Temporal decay | Exponential, 1-day half-life |
| Launder | Velocity monitor | >30pt deviation → weight historical at 30% |
| Poison | Submitter weighting | New submitters in recent 20% → discount 80% |
| Poison | Anomaly detection | >5 new submitters in 60s → discount 90% |

---

## 11. Attack ↔ Real-World Incident Mapping

Each attack module directly corresponds to documented incidents from the last 2 weeks:

| Attack | Real-World Incident | Source |
|---|---|---|
| **Sybil Farming** | 22,000 agents registered on ERC-8004 in 3 days, only ~100 legit. Batch-minted identities flooding the registry. | Crapis, Bankless podcast Feb 15 |
| **Sybil Farming** | "What Would Elon Do?" skill gamed to #1 on ClawMon via star/download manipulation | Cisco AI Defense team |
| **Reputation Launder** | Trusted OpenClaw skills pushing malicious updates (supply chain attack pattern) | 1Password blog, Feb 2 |
| **Reputation Launder** | Griffith's bot attempted to exfiltrate its own MetaMask private key mid-operation — trusted agent, unexpected behavior, no reputation impact | Bankless podcast Feb 15 |
| **Attestation Poison** | 283 skills (7.1%) leaking credentials — legitimate skills with destructive code buried in SKILL.md instructions | Snyk research, Feb 7 |
| **Attestation Poison** | Coordinated fake reviews burying legitimate skills while boosting malicious ones | Authmind research, Feb 11 |
| **Trust Arbitrage** | Griffith's two bots negotiated their own HTTP protocol and started communicating privately — zero cross-system trust visibility | Bankless podcast Feb 15 |
| **Trust Arbitrage** | Same malicious skill appearing on ClawMon, npm, VS Code marketplace, and GitHub with different trust signals | 1Password blog, Feb 2 |

### Crapis's Economic Breakpoint (Laundering Extension)

From the Bankless podcast:

> "Your agent has accumulated reputation. Its future order flow has a net present value of 50K. Now an opportunity appears to steal 100K. The economic incentive breaks. You burn the reputation for 100K."

This is precisely what the laundering attack demonstrates — except the mitigation (temporal decay) only addresses the detection window, not the economic incentive. **Section 11.5 (Staking & Slashing Layer)** addresses this directly by making the economic breakpoint unprofitable.

---

## 11.5. Staking & Slashing Layer — Crypto-Economic Security for Agent Trust

### Design Philosophy

Reputation scoring (Sections 8-10) provides **soft trust** — statistical confidence based on community feedback. But as Crapis identifies, soft trust has an economic breakpoint: when the value of defecting exceeds the value of accumulated reputation, rational agents defect.

The staking layer provides **economic trust** — collateralized security where misbehavior has direct financial consequences. The goal is to make the a16z crypto formulation hold:

```
Cost-of-Corruption (CoC) >> Profit-from-Corruption (PfC)
```

When CoC exceeds PfC, attacking becomes economically irrational regardless of the agent's internal incentives. This is the same principle that secures PoS blockchains — applied to agent reputation instead of block production.

### Trust Tier Model (Unified)

```
┌─────────────────────────────────────────────────┐
│  TIER 3: Hard Trust (TEE + Formal Verification) │  ← SECTION 11.6
│  Cryptographic proof agent code hasn't changed   │
├─────────────────────────────────────────────────┤
│  TIER 2: Economic Trust (Staking + Slashing)    │  ← SECTION 11.5
│  Collateralized, slashable, financially bonded   │
├─────────────────────────────────────────────────┤
│  TIER 1: Soft Trust (Reputation Scoring)        │  Sections 8-10
│  Community feedback, mitigated, weighted          │
├─────────────────────────────────────────────────┤
│  TIER 0: Listed (Open Auth Required)            │  Section 8
│  Registered + open feedback auth enabled          │
└─────────────────────────────────────────────────┘
```

Each tier builds on the one below. An agent must pass Tier 0 and maintain Tier 1 before it can stake into Tier 2. Tier 3 (TEE attestation) requires Tier 2 staking plus a valid TEE attestation proving the agent code hasn't been modified.

### Staking Roles

The system has three economic roles. Anyone can hold multiple roles.

**Skill Publishers (Operators)**
- Register a skill on the Trusted ClawMon registry
- Stake collateral to list at a higher trust tier
- Subject to slashing if the skill is flagged and confirmed malicious
- Earn listing rewards (share of protocol fees from downstream consumers)

**Reviewers (Validators)**
- Submit feedback on listed skills
- Stake a small bond per review to prove skin-in-the-game
- Subject to slashing if review is confirmed fraudulent (sybil ring, coordinated poison)
- Earn review rewards from the protocol fee pool

**Curators (Delegators)**
- Don't operate skills or write reviews
- Delegate stake to skills they believe are trustworthy
- Earn a share of the skill's listing rewards proportional to their delegation
- Subject to slashing proportional to their delegation if the skill is slashed
- Function like nominators in NPoS — they have economic incentive to curate well

### Staking Mechanics

#### Stake-to-List (Publisher Staking)

To register a skill at Tier 2, the publisher deposits collateral into the `TrustStaking` contract:

```solidity
// contracts/TrustStaking.sol (Monad — Solidity on EVM)

contract TrustStaking {
    using SafeMath for uint256;

    // --- Staking State ---
    struct SkillStake {
        address publisher;          // Skill publisher's address
        uint256 stakeAmount;        // Total publisher stake (MON)
        uint256 delegatedStake;     // Total delegated from curators
        uint256 totalStake;         // stakeAmount + delegatedStake
        uint256 stakedAt;           // Block timestamp of initial stake
        uint256 lastSlashCheck;     // Timestamp of last slash evaluation
        bool active;                // Whether the skill is actively listed
        TrustTier tier;             // Current tier based on totalStake
    }

    // Minimum stakes per tier (in smallest token unit)
    uint256 public constant TIER2_MIN_STAKE = 500 * 1e8;     // 500 MON
    uint256 public constant TIER2_HIGH_MIN_STAKE = 5000 * 1e8; // 5,000 MON
    uint256 public constant TIER2_MAX_MIN_STAKE = 50000 * 1e8; // 50,000 MON

    // Unbonding period — stake is locked for 7 days after unstake request
    uint256 public constant UNBONDING_PERIOD = 7 days;

    mapping(bytes32 => SkillStake) public skillStakes;  // agentId => stake
    mapping(address => mapping(bytes32 => uint256)) public delegations; // curator => agentId => amount

    event SkillStaked(bytes32 indexed agentId, address publisher, uint256 amount);
    event SkillSlashed(bytes32 indexed agentId, uint256 slashAmount, bytes32 reason);
    event DelegationAdded(bytes32 indexed agentId, address curator, uint256 amount);
    event UnbondingInitiated(bytes32 indexed agentId, address requester, uint256 amount);

    function stakeSkill(bytes32 agentId) external payable {
        require(msg.value >= TIER2_MIN_STAKE, "Below minimum stake");
        require(!skillStakes[agentId].active, "Already staked");

        skillStakes[agentId] = SkillStake({
            publisher: msg.sender,
            stakeAmount: msg.value,
            delegatedStake: 0,
            totalStake: msg.value,
            stakedAt: block.timestamp,
            lastSlashCheck: block.timestamp,
            active: true,
            tier: _computeTier(msg.value)
        });

        emit SkillStaked(agentId, msg.sender, msg.value);
    }

    function delegateToSkill(bytes32 agentId) external payable {
        require(skillStakes[agentId].active, "Skill not active");
        require(msg.value > 0, "Zero delegation");

        delegations[msg.sender][agentId] += msg.value;
        skillStakes[agentId].delegatedStake += msg.value;
        skillStakes[agentId].totalStake += msg.value;
        skillStakes[agentId].tier = _computeTier(skillStakes[agentId].totalStake);

        emit DelegationAdded(agentId, msg.sender, msg.value);
    }
}
```

#### Stake-to-Review (Reviewer Bonding)

Each feedback submission requires a small bond. This prevents costless sybil feedback:

```solidity
struct ReviewBond {
    address reviewer;
    bytes32 agentId;
    uint256 bondAmount;
    uint256 submittedAt;
    bool slashed;
}

uint256 public constant REVIEW_BOND = 1 * 1e8;  // 1 MON per review

function submitReview(bytes32 agentId, int8 score, string calldata comment) external payable {
    require(msg.value >= REVIEW_BOND, "Bond required");
    require(skillStakes[agentId].active, "Skill not staked");

    // Store bond
    reviewBonds[keccak256(abi.encode(msg.sender, agentId, block.timestamp))] = ReviewBond({
        reviewer: msg.sender,
        agentId: agentId,
        bondAmount: msg.value,
        submittedAt: block.timestamp,
        slashed: false
    });

    // Forward to MessageLog contract
    // (actual feedback submission via ethers.js off-chain)
}
```

**Why 1 MON per review?** This is the minimum economic friction that makes sybil farming unprofitable at scale. 20 sybil reviews = 20 MON at risk. If the sybil ring is detected (graph analysis from Section 10), all 20 MON are slashed. The attacker pays 20 MON to achieve nothing. Without bonding, the attack costs 0.02 MON in transaction fees — 1000x cheaper.

#### Delegation Mechanics

Curators delegate stake to skills they trust. This creates a market signal:

- Skills with high delegation = community confidence (curators are risking capital)
- Skills with no delegation beyond the publisher's own stake = lower confidence
- Delegation can be withdrawn with an unbonding period (7 days)
- If the skill is slashed, curators lose proportional stake

```
Curator A delegates 100 MON to skill "deep-research-agent"
Curator B delegates 200 MON to skill "deep-research-agent"
Publisher staked 500 MON

Total stake: 800 MON
If slashed 50%:
  Publisher loses: 250 MON (50% of 500)
  Curator A loses: 50 MON  (50% of 100)
  Curator B loses: 100 MON (50% of 200)
  Total slashed: 400 MON
```

This mirrors EigenLayer's approach where delegated stake is proportionally slashable. Curators are incentivized to do due diligence before delegating.

### Slashing Conditions

Slashing is the enforcement mechanism. It must be objectively attributable (provable on-chain or via verifiable evidence) to prevent unjust penalties.

#### Slashable Offenses

| Offense | Target | Evidence | Slash % | Cooldown |
|---|---|---|---|---|
| **Sybil Ring Detected** | All ring participants (publishers + reviewers) | Graph analysis proof: mutual feedback pairs exceeding threshold | 100% of review bonds + 25% of publisher stake | Permanent delist for ring members |
| **Malicious Update Confirmed** | Skill publisher | Community report + 3-of-5 arbiter confirmation | 50% of total stake (publisher + delegated pro-rata) | 30-day suspension, restake required |
| **Credential Leaking** | Skill publisher | Automated scan evidence (Snyk-style) | 100% of publisher stake, 50% of delegated | Permanent delist |
| **Fraudulent Review** | Reviewer | Correlation with known sybil patterns, or review contradicted by >10 counter-reviews | 100% of review bond | 30-day review cooldown |
| **Auth Revocation** | Skill publisher | On-chain: feedbackAuth changed from 'open' | 10% of stake (penalty for breaking listing contract) | Immediate delist, stake returned after unbonding minus penalty |
| **Coordinated Poison** | Attacking reviewers | Anomaly detection: >5 negative reviews from new accounts in <60s | 100% of all attacker review bonds | Permanent review ban |

#### Correlated Slashing (Ethereum-Inspired)

When multiple skills from the same publisher are flagged simultaneously, penalties scale quadratically — same principle as Ethereum's correlated slashing for validators:

```typescript
function computeCorrelatedSlashPenalty(
  publisherSkillCount: number,
  flaggedSkillCount: number,
  baseSlashPercentage: number
): number {
  // If 1 of 10 skills flagged: base penalty (e.g., 50%)
  // If 5 of 10 skills flagged: penalty scales to min(100%, base * (5/10)^0.5 * 2)
  // If 10 of 10 skills flagged: 100% slash on everything
  const correlationFactor = Math.sqrt(flaggedSkillCount / publisherSkillCount);
  return Math.min(100, baseSlashPercentage * correlationFactor * 2);
}
```

This makes it catastrophically expensive for a single publisher to register many malicious skills. A publisher with 20 staked skills (20 × 500 MON = 10,000 MON) who has 10 flagged loses not 50% of each (2,500 MON) but up to 100% of all 20 (10,000 MON).

### Slash Distribution

Slashed funds don't get burned (unlike Ethereum). They're redistributed to create positive-sum incentives:

```
Slashed Stake Distribution:
├── 40% → Reporters who flagged the offense
│         (incentivizes vigilance)
├── 30% → Insurance pool
│         (compensates users harmed by the malicious skill)
├── 20% → Protocol treasury
│         (funds ongoing development + arbiter compensation)
└── 10% → Burned
          (deflationary pressure on staking token)
```

**Why not 100% to reporters?** Because that creates a perverse incentive to file false reports against staked skills to collect their stake. The 40% reporter reward is calibrated to be enough to incentivize reporting but not so high that it incentivizes frivolous or adversarial reports.

### Dispute Resolution — Arbiter Committee

Not all slashing is algorithmic. For ambiguous cases (e.g., "is this skill actually malicious or was it a false positive?"), a human dispute layer is needed:

```
Slashing Flow:
1. Detection: Automated (graph analysis, anomaly detection, scan)
   OR manual report from community member

2. Evidence Submission: Reporter submits evidence to SlashProposal contract
   - Must include: offense type, agentId, evidence hash (IPFS or MessageLog)
   - Reporter stakes a challenge bond (5 MON) — forfeited if frivolous

3. Automated Evaluation: If offense is objectively provable on-chain
   (e.g., sybil ring from graph analysis, auth revocation event):
   → Slash executes automatically, no arbiter needed

4. Arbiter Review: If offense requires subjective judgment
   (e.g., "is this code malicious?" for a supply chain attack):
   → 5-member arbiter committee reviews
   → 3-of-5 vote required to confirm slash
   → Arbiters are staked participants with >90-day history + AAA trust tier
   → Arbiters earn 5% of protocol treasury allocation per resolved dispute
   → Arbiters who vote against confirmed consensus lose arbiter status

5. Execution: Slash is applied, funds distributed per allocation above

6. Appeal: Publisher can appeal within 48 hours by staking 2x the slash amount
   → Full 5-member review with different arbiters
   → If appeal succeeds: original slash reversed, challenge bond returned
   → If appeal fails: appeal stake also slashed (anti-spam)
```

This is similar to EigenLayer's veto committee concept but adapted for agent trust rather than block validation.

### Addressing Crapis's Economic Breakpoint

The staking layer directly solves the scenario Crapis described:

**Without staking:**
```
Agent reputation NPV: 50K (future order flow from good reviews)
Steal opportunity: 100K
Rational decision: Steal. Burn reputation. Net profit: +50K
```

**With staking:**
```
Agent reputation NPV: 50K
Agent total stake: 50K MON (publisher + delegated)
Steal opportunity: 100K
If caught (and detection rate is high due to graph analysis + community reports):
  Loses: 50K stake (slashed) + 50K reputation NPV = 100K total cost
  Gains: 100K steal
  Net expected profit: 100K - (100K × P(detection))
  If P(detection) > 50%: Expected value is negative. Don't steal.
```

The protocol can enforce **minimum stake proportional to the skill's economic activity** — a skill that handles 100K in transactions should have 100K+ in stake. This makes the breakpoint never profitable as long as detection probability exceeds `stake / steal_opportunity`.

```solidity
// Dynamic minimum stake based on economic activity
function requiredStakeForActivity(bytes32 agentId) public view returns (uint256) {
    uint256 monthlyVolume = getSkillMonthlyVolume(agentId);
    // Require stake >= 1.5x monthly transaction volume
    // This ensures CoC > PfC at any detection rate above 67%
    return monthlyVolume.mul(15).div(10);
}
```

### Token Design Considerations

The staking layer needs a denomination. Three options:

**Option A: MON Native**
- Pros: No token launch, immediate liquidity, Monad-native, no regulatory risk
- Cons: Staking yield must come from protocol revenue (no token inflation), MON price volatility affects security budget
- Implementation: Native Monad staking via smart contracts

**Option B: Protocol Token (e.g., $TRUST)**
- Pros: Inflationary staking rewards, governance rights, independent monetary policy, value accrual to protocol
- Cons: Token launch complexity, regulatory risk (security classification), cold-start liquidity problem, potential for pump-and-dump
- Implementation: ERC-20 fungible token

**Option C: Hybrid — MON for staking, governance token**
- Pros: Economic security denominated in established asset, governance token is lightweight
- Cons: Two-token complexity, potential misalignment between governance and security incentives

**Recommendation: Option A (MON native) for v1.** Simpler, avoids token launch overhead, leverages Monad's existing PoS security model. Can migrate to Option C later if the protocol reaches sufficient scale to justify a governance token.

### Economic Parameters

These are initial parameters. They should be governed by staked participants:

| Parameter | Value | Rationale |
|---|---|---|
| Minimum publisher stake | 500 MON (~$50) | Low enough for indie devs, high enough to deter casual spam |
| Minimum review bond | 1 MON (~$0.10) | Friction without excluding legitimate reviewers |
| Challenge bond | 5 MON (~$0.50) | Prevents frivolous slash proposals |
| Unbonding period | 7 days | Long enough to detect and slash before exit |
| Activation period | 24 hours | Prevents flash-stake attacks |
| Max slash (single offense) | 50% of total stake | Limits catastrophic loss for honest mistakes |
| Max slash (correlated) | 100% of total stake | Full accountability for systematic fraud |
| Reporter reward | 40% of slashed funds | Incentivizes vigilance |
| Staking yield (from protocol fees) | Variable, target 5-15% APR | Funded by skill listing fees + transaction fees |
| Arbiter compensation | 5% of treasury per dispute | Incentivizes quality dispute resolution |

### Integration with Existing Architecture

The staking layer wraps the scoring engine:

```
User Query: "Is skill X trustworthy?"

1. Check Tier 0: Is feedbackAuth 'open'?           → No  → NOT LISTED
2. Check Tier 1: Compute reputation score            → Score, Tier (stake-weighted)
3. Check Tier 2: Is skill staked?                     → StakeAmount, Delegated, TotalStake
4. Check Tier 2: Dynamic stake compliance?            → Compliant or under-collateralized
5. Check Tier 2: Cross-chain stake credits?           → ForeignStakeCredits
6. Check Tier 2: Any active slash proposals?          → SlashStatus
7. Check Tier 3: Is TEE attestation valid?            → CodeHashMatch, Fresh
8. Return: {
     listed: true,
     reputationScore: 82,
     reputationTier: 'AA',
     staked: true,
     totalStake: '2,500 MON',
     effectiveStake: '3,750 MON',  // includes cross-chain credits
     delegatorCount: 12,
     stakeCompliant: true,
     foreignStakeCredits: '1,250 MON',
     slashHistory: [],
     teeAttested: true,
     codeHashMatch: true,
     lastAttestation: '2026-02-15T10:30:00Z',
     insured: true,
     insurancePoolBalance: '50,000 MON',
     economicTrust: 'HIGH',
     combinedTier: 'TIER_3_AA'  // Tier 3 hard trust + AA reputation
   }
```

The API response gives consumers a unified view across all trust tiers: a skill can be Tier 1 (reputation only, no stake — use with caution for high-value tasks), Tier 2 (reputation + economic collateral — safer for high-value interactions), or Tier 3 (reputation + collateral + TEE attestation — highest assurance, code provably unchanged).

### Contract Architecture

```
┌────────────────────────────────────────────────────┐
│                MONAD (Solidity)                     │
├────────────────────────────────────────────────────┤
│                                                      │
│  TrustStaking.sol                                    │
│  ├── stakeSkill(agentId)                            │
│  ├── delegateToSkill(agentId)                       │
│  ├── initiateUnbonding(agentId)                     │
│  ├── completeUnbonding(agentId)                     │
│  ├── requiredStakeForActivity(agentId) → view       │
│  ├── checkStakeCompliance(agentId) → view           │
│  └── getSkillStakeInfo(agentId) → view              │
│                                                      │
│  SlashManager.sol                                    │
│  ├── proposeSlash(agentId, evidence, offenseType)   │
│  ├── executeAutoSlash(agentId, proofHash)           │
│  ├── arbiterVote(proposalId, approve)               │
│  ├── appeal(proposalId)                             │
│  └── distributeSlashedFunds(proposalId)             │
│                                                      │
│  ReviewBonding.sol                                   │
│  ├── submitBondedReview(agentId, score)             │
│  ├── claimBondBack(reviewId) — after cooldown       │
│  └── slashReviewBond(reviewId, evidence)            │
│                                                      │
│  ProtocolTreasury.sol                                │
│  ├── distributeFees()                                │
│  ├── fundInsurancePool()                            │
│  ├── routeX402Revenue()                             │
│  └── compensateArbiters()                           │
│                                                      │
│  InsurancePool.sol                                   │
│  ├── submitClaim(agentId, lossAmount, evidence)     │
│  ├── approveClaim(claimId)                          │
│  └── getPoolBalance() → view                        │
│                                                      │
│  LiquidStaking.sol                                   │
│  ├── mintOnStake(agentId, amount) → tcMON          │
│  ├── redeem(amount) → initiate unbonding            │
│  └── getExchangeRate() → view                       │
│                                                      │
│  TEEAttestationVerifier.sol                          │
│  ├── pinCodeHash(agentId, codeHash)                 │
│  ├── submitAttestation(agentId, hash, proof)        │
│  └── isTier3Active(agentId) → view                  │
│                                                      │
│  StakeBridge.sol                                     │
│  ├── recognizeForeignStake(agentId, chain, proof)   │
│  └── getEffectiveStake(agentId) → view              │
│                                                      │
└─────────────────────┬──────────────────────────────┘
                      │
                      │ Events + State Reads
                      ▼
┌────────────────────────────────────────────────────┐
│            SCORING ENGINE (Off-Chain)                │
│                                                      │
│  Reads stake state via RPC reads                     │
│  Reads TEE attestation state                         │
│  Reads cross-chain stake credits                     │
│  Combines with MessageLog reputation data            │
│  Applies stake-weighted reputation scoring           │
│  Produces unified trust assessment (Tier 0-3)        │
│  Feeds dashboard + API + noise ratio counter         │
└────────────────────────────────────────────────────┘
```

### How Staking Changes Each Attack

| Attack | Without Staking | With Staking |
|---|---|---|
| **Sybil Farming** | Cost: 0.02 MON tx fees for 20 fake skills | Cost: 20 × 500 MON stake + 20 × 20 × 1 MON review bonds = 10,400 MON. If detected: all slashed. Attacker risks $1,040 instead of $0.002. |
| **Reputation Launder** | Trusted skill goes rogue; 14 negative reviews before score drops | Trusted skill goes rogue; slash proposal filed after 3 negative reviews. 50% of stake locked pending arbiter review. Publisher can't unstake during investigation. |
| **Attestation Poison** | 8 fake reviews destroy legitimate skill for free | Each fake review costs 1 MON bond. 8 reviews = 8 MON. If detected as coordinated poison: all 8 MON slashed. Still cheap, but 400x more expensive than without bonding, and the slashed funds go to the victim skill's publisher. |
| **Trust Arbitrage** | Same agent, different scores, no consequences | Staking is chain-specific. An agent staked on Monad but unstaked on Ethereum is visibly less trustworthy cross-chain. The arbitrage gap itself becomes the signal: "Why is this agent only willing to put up collateral on one chain?" |

### Attack Simulations (Staking Mode)

The attack modules extend to simulate staking economics:

```typescript
// src/attacks/sybil.ts — staking extension

interface SybilStakingResult extends SybilResult {
  totalStakeAtRisk: number;        // Sum of all sybil stakes
  totalReviewBondsAtRisk: number;  // Sum of all sybil review bonds
  slashAmount: number;             // Total slashed if detected
  attackCostWithoutStaking: number; // 0.02 MON (tx fees only)
  attackCostWithStaking: number;    // 10,400 MON (stakes + bonds)
  costMultiplier: number;           // 520,000x more expensive
}
```

The dashboard shows a cost comparison:
```
SYBIL ATTACK ECONOMICS
─────────────────────────
Without staking:  0.02 MON to reach "trusted"
With staking:     10,400 MON at risk
Cost multiplier:  520,000×
Detection → Slash: 10,400 MON redistributed to reporters + insurance
```

---

## 11.6. TEE Attestation Layer — Hard Trust (Tier 3)

### Design Philosophy

Reputation (Tier 1) can be gamed. Staking (Tier 2) can be sacrificed if the payoff is high enough. TEE attestation (Tier 3) provides **cryptographic proof** that the agent code running in production matches the code that was audited and staked — eliminating the possibility of silent malicious updates entirely.

This is the trust layer that Crapis describes as "hard trust" — where the guarantee comes from hardware and cryptography rather than economics or reputation.

### How TEE Attestation Works

A Trusted Execution Environment (Intel SGX, Intel TDX, AMD SEV) runs agent code in an isolated enclave. The TEE hardware produces a signed attestation report containing:

1. **Code hash** — cryptographic hash of the exact binary running in the enclave
2. **Platform identity** — proof the attestation came from genuine TEE hardware (not emulated)
3. **Measurement** — chain of hashes from boot through application load

This attestation is verifiable by anyone — including on-chain smart contracts — without trusting the agent operator.

### Architecture

```typescript
// src/tee/types.ts

export interface TEEAttestation {
  agentId: string;
  codeHash: string;            // SHA-256 of the agent binary
  platformType: 'sgx' | 'tdx' | 'sev';
  attestationReport: string;   // Base64-encoded signed attestation
  reportTimestamp: number;
  pinnedCodeHash: string;      // The code hash registered at staking time
  matches: boolean;            // Does current codeHash === pinnedCodeHash?
}

export interface AttestationResult {
  valid: boolean;
  codeHashMatch: boolean;      // Current code matches pinned hash
  platformVerified: boolean;   // Attestation from genuine TEE hardware
  reportFresh: boolean;        // Attestation within freshness window
  tier3Eligible: boolean;      // All checks pass → Tier 3
}

export interface CodeHashPin {
  agentId: string;
  codeHash: string;
  pinnedAt: number;
  pinnedBy: string;            // Publisher address
  auditReference?: string;     // Optional: link to audit report
}
```

### On-Chain Verification

```solidity
// contracts/TEEAttestationVerifier.sol (Monad)

contract TEEAttestationVerifier {
    struct AttestationRecord {
        bytes32 agentId;
        bytes32 codeHash;          // Pinned code hash at registration
        bytes32 latestAttestation; // Hash of latest attestation report
        uint256 lastVerified;      // Timestamp of last successful verification
        bool tier3Active;          // Whether Tier 3 status is currently valid
    }

    // Attestation must be refreshed within this window to maintain Tier 3
    uint256 public constant ATTESTATION_FRESHNESS = 24 hours;

    mapping(bytes32 => AttestationRecord) public attestations;

    event CodeHashPinned(bytes32 indexed agentId, bytes32 codeHash);
    event AttestationVerified(bytes32 indexed agentId, bool codeHashMatch);
    event Tier3Activated(bytes32 indexed agentId);
    event Tier3Revoked(bytes32 indexed agentId, bytes32 reason);

    // Publisher pins the code hash when staking — this is the "known good" state
    function pinCodeHash(bytes32 agentId, bytes32 codeHash) external {
        require(msg.sender == trustStaking.getPublisher(agentId), "Not publisher");
        require(trustStaking.isStaked(agentId), "Must be staked (Tier 2) first");

        attestations[agentId].codeHash = codeHash;
        attestations[agentId].agentId = agentId;
        emit CodeHashPinned(agentId, codeHash);
    }

    // Anyone can submit a fresh attestation report for verification
    function submitAttestation(
        bytes32 agentId,
        bytes32 reportedCodeHash,
        bytes calldata attestationProof
    ) external {
        // Verify attestation signature (DCAP verification)
        require(_verifyDCAPAttestation(attestationProof), "Invalid attestation");

        AttestationRecord storage record = attestations[agentId];
        bool matches = reportedCodeHash == record.codeHash;

        record.latestAttestation = keccak256(attestationProof);
        record.lastVerified = block.timestamp;
        record.tier3Active = matches;

        emit AttestationVerified(agentId, matches);

        if (matches) {
            emit Tier3Activated(agentId);
        } else {
            // Code changed without updating pin — possible malicious update
            emit Tier3Revoked(agentId, "CODE_HASH_MISMATCH");
            // Trigger automatic slash proposal
            slashManager.proposeSlash(agentId, "CODE_HASH_MISMATCH");
        }
    }

    // Check if agent's Tier 3 status is still valid
    function isTier3Active(bytes32 agentId) public view returns (bool) {
        AttestationRecord storage record = attestations[agentId];
        return record.tier3Active
            && (block.timestamp - record.lastVerified) < ATTESTATION_FRESHNESS;
    }
}
```

### MessageLog Attestation Records

Attestation reports are also published to a dedicated MessageLog contract for auditability:

```typescript
// src/tee/hcs-attestation.ts

export async function publishAttestation(
  topicId: string,
  attestation: TEEAttestation
): Promise<void> {
  await submitMessage(topicId, {
    type: 'tee_attestation',
    agentId: attestation.agentId,
    codeHash: attestation.codeHash,
    platformType: attestation.platformType,
    reportHash: sha256(attestation.attestationReport),
    matches: attestation.matches,
    timestamp: attestation.reportTimestamp,
  });
}

export async function getLatestAttestation(
  topicId: string,
  agentId: string
): Promise<TEEAttestation | null> {
  // Read via RPC reads, return most recent attestation for agent
}
```

### Integration with Trust Tiers

```
User Query: "Is skill X trustworthy?"

1. Check Tier 0: Is feedbackAuth 'open'?           → No  → NOT LISTED
2. Check Tier 1: Compute reputation score            → Score, Tier
3. Check Tier 2: Is skill staked?                     → StakeAmount, TotalStake
4. Check Tier 3: Is TEE attestation valid?            → CodeHashMatch, Fresh
5. Return: {
     listed: true,
     reputationScore: 82,
     reputationTier: 'AA',
     staked: true,
     totalStake: '2,500 MON',
     teeAttested: true,
     codeHashMatch: true,
     lastAttestation: '2026-02-15T10:30:00Z',
     combinedTier: 'TIER_3_AA'  // Tier 3 hard trust + AA reputation
   }
```

A Tier 3 agent gives consumers the strongest possible guarantee: the code is exactly what was audited, it's running in a genuine TEE, the publisher has economic skin in the game, and the community has validated the skill through open feedback.

---

## 11.7. Dynamic Stake Requirements

### Problem

A flat 500 MON minimum stake makes sense for low-value skills, but a skill handling $100K in monthly transactions with only 500 MON staked is dramatically under-collateralized. The economic breakpoint still favors defection.

### Solution

Minimum stake scales with the skill's monthly economic activity:

```solidity
// In TrustStaking.sol

// Require stake >= 1.5x monthly transaction volume
// This ensures CoC > PfC at any detection rate above 67%
function requiredStakeForActivity(bytes32 agentId) public view returns (uint256) {
    uint256 monthlyVolume = getSkillMonthlyVolume(agentId);
    // Floor: TIER2_MIN_STAKE (500 MON) — never below base minimum
    // Ceiling: none — high-value skills need high collateral
    return Math.max(TIER2_MIN_STAKE, monthlyVolume.mul(15).div(10));
}

// Enforce on new stakes and on periodic compliance checks
function checkStakeCompliance(bytes32 agentId) public view returns (bool) {
    uint256 required = requiredStakeForActivity(agentId);
    return skillStakes[agentId].totalStake >= required;
}

// Non-compliant skills get a grace period, then are suspended
function enforceCompliance(bytes32 agentId) external {
    if (!checkStakeCompliance(agentId)) {
        // Mark skill as under-collateralized
        // Publisher has 7 days to add more stake or attract more delegation
        // After grace period: skill suspended until compliance restored
        skillStakes[agentId].complianceDeadline = block.timestamp + 7 days;
        emit ComplianceWarning(agentId, requiredStakeForActivity(agentId));
    }
}
```

### Volume Tracking

```typescript
// src/staking/dynamic-stake.ts

export interface StakeRequirement {
  agentId: string;
  monthlyVolume: number;       // MON equivalent of monthly tx volume
  requiredStake: number;       // 1.5x monthlyVolume, floor at 500 MON
  currentStake: number;        // Actual stake (publisher + delegated)
  compliant: boolean;          // currentStake >= requiredStake
  shortfall: number;           // How much additional stake needed (0 if compliant)
}

export function computeStakeRequirement(
  agentId: string,
  monthlyVolume: number,
  currentStake: number
): StakeRequirement {
  const requiredStake = Math.max(500 * 1e8, monthlyVolume * 1.5);
  return {
    agentId,
    monthlyVolume,
    requiredStake,
    currentStake,
    compliant: currentStake >= requiredStake,
    shortfall: Math.max(0, requiredStake - currentStake),
  };
}
```

This creates a natural market dynamic: skills that handle more value attract more curator delegation (because they generate more fees), which naturally scales their collateral. Under-collateralized skills are visible on the dashboard and automatically flagged.

---

## 11.8. Insurance Pool — Automated Victim Compensation

### Purpose

When a malicious skill is slashed, the immediate damage to users who already interacted with it is done. The insurance pool provides **automated compensation** to those users, funded by slash redistribution.

### Funding

```
Slashed Stake Distribution (updated):
├── 40% → Reporters who flagged the offense
├── 30% → Insurance pool ← THIS
├── 20% → Protocol treasury
└── 10% → Burned
```

The insurance pool accumulates from every slash event. Additional funding comes from:
- 5% of protocol treasury revenue (ongoing)
- x402 micropayment fees (small percentage of each skill payment)

### Claim Process

```solidity
// contracts/InsurancePool.sol

contract InsurancePool {
    uint256 public poolBalance;

    struct Claim {
        address claimant;
        bytes32 agentId;          // The malicious skill
        uint256 amount;           // Claimed loss amount
        bytes32 evidenceHash;     // Proof of interaction + loss
        uint256 submittedAt;
        ClaimStatus status;
    }

    enum ClaimStatus { Pending, Approved, Rejected, Paid }

    mapping(uint256 => Claim) public claims;
    uint256 public nextClaimId;

    // Max payout per claim: 50% of pool balance or 100% of user's proven loss, whichever is lower
    // This prevents pool depletion from a single large claim
    uint256 public constant MAX_PAYOUT_RATIO = 50; // 50% of pool

    function submitClaim(
        bytes32 agentId,
        uint256 lossAmount,
        bytes32 evidenceHash
    ) external {
        // Skill must have been slashed (confirmed malicious)
        require(slashManager.isSlashed(agentId), "Skill not slashed");

        claims[nextClaimId++] = Claim({
            claimant: msg.sender,
            agentId: agentId,
            amount: lossAmount,
            evidenceHash: evidenceHash,
            submittedAt: block.timestamp,
            status: ClaimStatus.Pending
        });
    }

    function approveClaim(uint256 claimId) external onlyArbiter {
        Claim storage claim = claims[claimId];
        require(claim.status == ClaimStatus.Pending, "Not pending");

        uint256 payout = Math.min(claim.amount, poolBalance * MAX_PAYOUT_RATIO / 100);
        claim.status = ClaimStatus.Approved;

        poolBalance -= payout;
        payable(claim.claimant).transfer(payout);
        claim.status = ClaimStatus.Paid;
    }

    receive() external payable {
        poolBalance += msg.value;
    }
}
```

```typescript
// src/staking/insurance.ts

export interface InsurancePoolState {
  balance: number;
  totalClaimsPaid: number;
  pendingClaims: number;
  totalSlashesReceived: number;
}

export interface InsuranceClaim {
  claimId: number;
  claimant: string;
  agentId: string;
  lossAmount: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  payout?: number;
}
```

---

## 11.9. Cross-Chain Stake Recognition

### Problem

The arbitrage attack demonstrates that an agent can be trusted on Monad but unknown on Ethereum. Without cross-chain stake recognition, every chain is a fresh start — the arbitrage gap never closes.

### Solution

Propagate stake information across chains so that a skill staked on one chain gets partial credit on another. This doesn't require bridging actual tokens — just verifiable proof that the stake exists.

```solidity
// contracts/StakeBridge.sol

contract StakeBridge {
    struct ForeignStake {
        bytes32 agentId;
        string sourceChain;       // "monad", "ethereum", "base"
        uint256 stakeAmount;
        uint256 verifiedAt;
        bytes32 proofHash;        // Hash of the cross-chain proof
        bool active;
    }

    // Foreign stakes get partial credit (not 1:1 — cross-chain proof is weaker)
    uint256 public constant FOREIGN_STAKE_DISCOUNT = 50; // 50% credit

    mapping(bytes32 => ForeignStake[]) public foreignStakes;

    event ForeignStakeRecognized(
        bytes32 indexed agentId,
        string sourceChain,
        uint256 stakeAmount,
        uint256 creditAmount
    );

    // Submit proof that an agent is staked on another chain
    function recognizeForeignStake(
        bytes32 agentId,
        string calldata sourceChain,
        uint256 stakeAmount,
        bytes calldata proof
    ) external {
        // Verify proof (chain-specific verification)
        require(_verifyStakeProof(sourceChain, agentId, stakeAmount, proof), "Invalid proof");

        uint256 creditAmount = stakeAmount * FOREIGN_STAKE_DISCOUNT / 100;

        foreignStakes[agentId].push(ForeignStake({
            agentId: agentId,
            sourceChain: sourceChain,
            stakeAmount: stakeAmount,
            verifiedAt: block.timestamp,
            proofHash: keccak256(proof),
            active: true
        }));

        // Credit is added to the skill's effective stake for tier computation
        // but is NOT slashable on this chain (can only be slashed on source chain)
        emit ForeignStakeRecognized(agentId, sourceChain, stakeAmount, creditAmount);
    }

    // Get total effective stake including foreign chain credits
    function getEffectiveStake(bytes32 agentId) public view returns (uint256) {
        uint256 localStake = trustStaking.getTotalStake(agentId);
        uint256 foreignCredit = 0;

        for (uint i = 0; i < foreignStakes[agentId].length; i++) {
            if (foreignStakes[agentId][i].active) {
                foreignCredit += foreignStakes[agentId][i].stakeAmount
                    * FOREIGN_STAKE_DISCOUNT / 100;
            }
        }

        return localStake + foreignCredit;
    }
}
```

```typescript
// src/ethereum/stake-bridge.ts

export interface CrossChainStakeView {
  agentId: string;
  stakes: {
    chain: 'monad' | 'ethereum' | 'base';
    localStake: number;
    foreignCredits: number;     // Credits from other chains
    effectiveStake: number;     // localStake + foreignCredits
    tier: string;
  }[];
  totalEffectiveStake: number;  // Sum across all chains
  arbitrageGap: number;         // Max difference between chain tiers
}
```

### Impact on Arbitrage Attack

With cross-chain stake recognition, the arbitrage panel shows not just the score gap but the stake gap:
- "Agent staked 5,000 MON on Monad → receives 2,500 MON credit on Ethereum"
- "Agent unstaked on Monad → no credit, tier drops"
- The arbitrage gap narrows proportionally to the foreign stake discount

---

## 11.10. x402 Payment Integration

### Purpose

Skill consumers pay per-use via x402 micropayments. A portion of each payment flows to the protocol treasury, which funds staking yields and the insurance pool. This creates a self-sustaining economic loop.

### Payment Flow

```
User calls skill via x402 micropayment
├── 80% → Skill publisher
├── 10% → Protocol treasury
│         ├── 60% → Staking yield pool
│         ├── 30% → Insurance pool
│         └── 10% → Operations
└── 10% → Curator rewards (split proportional to delegation)
```

```typescript
// src/payments/types.ts

export interface PaymentConfig {
  skillPricePerCall: number;      // MON per invocation
  publisherShare: number;          // 0.80
  protocolShare: number;           // 0.10
  curatorShare: number;            // 0.10
}

export interface x402Receipt {
  paymentId: string;
  agentId: string;
  caller: string;
  amount: number;
  publisherPayout: number;
  protocolPayout: number;
  curatorPayout: number;
  timestamp: number;
}
```

```typescript
// src/payments/x402.ts

export async function processSkillPayment(
  agentId: string,
  caller: string,
  amount: number,
  config: PaymentConfig
): Promise<x402Receipt> {
  const publisherPayout = amount * config.publisherShare;
  const protocolPayout = amount * config.protocolShare;
  const curatorPayout = amount * config.curatorShare;

  // Execute payments via Monad/EVM
  // Protocol treasury receives its share automatically
  // Curator rewards distributed proportional to delegation

  return {
    paymentId: generateId(),
    agentId,
    caller,
    amount,
    publisherPayout,
    protocolPayout,
    curatorPayout,
    timestamp: Date.now(),
  };
}

// Revenue feeds back into staking economics
export function computeStakingYield(
  totalProtocolRevenue: number,
  totalStaked: number
): number {
  // Target 5-15% APR based on protocol revenue
  const yieldPool = totalProtocolRevenue * 0.60; // 60% of protocol share
  return (yieldPool / totalStaked) * 100; // APR percentage
}
```

### Why x402?

x402 is the emerging HTTP-native micropayment standard. Using it means skill consumers don't need to interact with crypto wallets — the payment is embedded in the HTTP request/response cycle. This is critical for AI agent-to-agent interactions where both sides are automated.

---

## 11.11. Liquid Staking Derivative (tcMON)

### Problem

Staked MON in TrustStaking is locked and illiquid. Publishers and curators who stake heavily lose access to that capital for DeFi, trading, or other uses. This creates a barrier to staking — rational actors stake less than they otherwise would.

### Solution

Issue a liquid staking derivative token (tcMON — "Trusted ClawMon MON") representing staked MON. tcMON can be traded, used as collateral in DeFi, or held — while the underlying MON continues to secure the registry.

```solidity
// contracts/LiquidStaking.sol

contract LiquidStaking {
    IERC20 public tcMON;  // ERC-20 fungible token

    // 1 tcMON = 1 MON staked in TrustStaking
    // Redemption: burn tcMON → initiate unbonding → receive MON after 7 days

    mapping(address => uint256) public mintedTokens;

    event Minted(address indexed staker, uint256 amount);
    event RedemptionInitiated(address indexed holder, uint256 amount);
    event RedemptionCompleted(address indexed holder, uint256 amount);

    // When a publisher or curator stakes, they can optionally mint tcMON
    function mintOnStake(bytes32 agentId, uint256 stakeAmount) external {
        require(trustStaking.getStakerBalance(msg.sender, agentId) >= stakeAmount, "Insufficient stake");
        require(!_alreadyMinted(msg.sender, agentId, stakeAmount), "Already minted");

        // Mint 1:1 tcMON
        tcMON.mint(msg.sender, stakeAmount);
        mintedTokens[msg.sender] += stakeAmount;

        emit Minted(msg.sender, stakeAmount);
    }

    // Redeem tcMON to initiate unstaking
    function redeem(uint256 amount) external {
        require(tcMON.balanceOf(msg.sender) >= amount, "Insufficient tcMON");

        // Burn tcMON
        tcMON.burn(msg.sender, amount);

        // Initiate unbonding on the underlying stake
        // Follows the same 7-day unbonding period
        trustStaking.initiateUnbondingFor(msg.sender, amount);

        emit RedemptionInitiated(msg.sender, amount);
    }
}
```

### Slashing Impact on tcMON

If the underlying stake is slashed, the tcMON exchange rate adjusts:
- Before slash: 1 tcMON = 1 MON
- After 50% slash: 1 tcMON = 0.5 MON
- This means tcMON holders bear the slash proportionally, even if they've transferred the tokens

This is the same model as Lido's stETH — the token represents a claim on the underlying staked asset, including any slashing penalties.

```typescript
// src/staking/liquid-staking.ts

export interface tcMONState {
  totalMinted: number;
  totalUnderlyingStake: number;
  exchangeRate: number;           // totalUnderlyingStake / totalMinted
  totalSlashed: number;           // Cumulative slashing losses
}

export function computeExchangeRate(
  totalMinted: number,
  totalUnderlyingStake: number
): number {
  if (totalMinted === 0) return 1.0;
  return totalUnderlyingStake / totalMinted;
}
```

---

## 11.12. Noise Ratio Dashboard

### Purpose

A live counter showing the registered vs. staked vs. trusted agent ratio across all ERC-8004 deployments. This is the single most compelling visualization of why Trusted ClawMon matters — it shows the noise collapsing in real-time.

### Data Sources

```typescript
// API endpoint
// GET /api/noise-ratio

export interface NoiseRatioData {
  erc8004: {
    totalRegistered: number;       // ~22,667 (from Crapis's numbers)
    estimatedLegit: number;        // ~100
    noiseRatio: number;            // 99.5%
    source: 'bankless-podcast';
  };
  trustedClawMon: {
    totalSeeded: number;           // Skills seeded from awesome-openclaw-skills
    openAuthEnabled: number;       // Skills with open feedback auth
    tier1Plus: number;             // Skills with Tier 1+ reputation
    tier2Staked: number;           // Skills with Tier 2 economic trust
    tier3Attested: number;         // Skills with Tier 3 TEE attestation
    filteredNoiseRatio: number;    // Dramatically lower than 99.5%
  };
  clawmon: {
    totalSkills: number;           // 5,700+
    confirmedMalicious: number;    // 230+
    maliciousRate: number;         // ~4%
    source: 'authmind-research';
  };
}
```

### Dashboard Visualization

The noise ratio panel sits above the 4 attack panels as a persistent header or as a dedicated fifth panel:

```
┌─────────────────────────────────────────────────────────────────┐
│  NOISE RATIO — WHY THIS MATTERS                                 │
│                                                                  │
│  ERC-8004 Registry     Trusted ClawMon         ClawMon Raw      │
│  ┌──────────────┐     ┌──────────────┐       ┌──────────────┐  │
│  │  22,667       │     │  87           │       │  5,700+      │  │
│  │  registered   │     │  open auth    │       │  skills      │  │
│  │              │  →  │  listed       │       │              │  │
│  │  ~100 legit  │     │  52 Tier 1+   │       │  230+        │  │
│  │  99.5% noise │     │  23 Tier 2    │       │  malicious   │  │
│  │              │     │  8 Tier 3     │       │  4% bad      │  │
│  └──────────────┘     └──────────────┘       └──────────────┘  │
│                                                                  │
│  "Open auth + staking + TEE filters 99.5% noise to             │
│   a curated, economically-secured registry"                     │
└─────────────────────────────────────────────────────────────────┘
```

```typescript
// dashboard/src/components/viz/NoiseRatioViz.tsx

// Three columns showing the funnel:
// Column 1: ERC-8004 raw (huge number, red tint)
// Column 2: Trusted ClawMon filtered (small number, green tint)
//   - Breakdown by tier (Tier 0 → Tier 1 → Tier 2 → Tier 3)
//   - Animated counters that tick down as attacks run
// Column 3: ClawMon raw (context — this is what we're protecting)
//
// Live updates via WebSocket as attacks run:
//   - Sybil attack: fake skills briefly appear in Tier 0, get filtered
//   - Launder attack: skill drops from Tier 1 to delisted
//   - Poison attack: legitimate skill tier fluctuates
//   - Arbitrage: shows cross-chain tier discrepancies
```

---

## 12. Dashboard

### Design — Evidence Board Theme

2×2 grid, dark corkboard background, manila paper panels with push pins, typewriter fonts, sticky notes.

### Header Bar

Add a top-level stats strip above the 4 panels:
- "ERC-8004 REGISTRY: 22,667 registered | ~100 legit | 99.5% noise"
- Styled as Courier Prime on a torn paper strip, pinned to the corkboard
- Optional: "Trusted ClawMon filters to: [X] open-auth agents" (live count from seeded data)

### Panel Titles & Subtitles (dual narrative — ClawMon + ERC-8004)

- SYBIL ATTACK / "22,000 fake registrations. Same pattern. Now they're gaming trust."
- LAUNDER ATTACK / "Trusted agent goes rogue. Score doesn't budge."
- POISON ATTACK / "8 fake reviews. One legitimate skill destroyed."
- ARBITRAGE ATTACK / "Same agent. Three chains. Three different verdicts."

### Arbitrage Panel

Cards show:
- Card 1: "MONAD (Trusted ClawMon)" with real MessageLog/contract data
- Card 2: "ETHEREUM MAINNET (ERC-8004)" with "LIVE" badge, real contract read

### Metrics

Use skill-specific labels (e.g., "Fake Skills" instead of "Fake Agents")

### Noise Ratio Panel

Persistent panel (above or alongside the 4 attack panels) showing the live funnel from raw ERC-8004 registrations down to Trusted ClawMon's curated, tiered registry. Three columns: ERC-8004 raw (22,667 → 99.5% noise), Trusted ClawMon filtered (open auth → Tier 1 → Tier 2 → Tier 3), and ClawMon raw (5,700+ skills, 230+ malicious). Counters animate in real-time as attacks run. See Section 11.12 for full specification.

---

## 13. Seed Script — Real ClawMon Data

```typescript
// scripts/seed-clawmon-data.ts

import { submitMessage } from '../src/monad/message-log.js';

// 1. Fetch awesome-openclaw-skills README from GitHub
// 2. Parse skill entries (name, description, category, URL)
// 3. For each skill, write MessageLog identity registration:
//    { type: 'register', agentId: skill.name, name: skill.name,
//      publisher: skill.publisher, feedbackAuthPolicy: 'open' }
// 4. For legitimate skills, generate 10-50 positive feedback
// 5. For flagged skills, generate mixed feedback
// 6. For new skills, generate 0-5 feedback

// Known malicious skills (from Snyk/Cisco/Authmind research):
const FLAGGED_SKILLS = [
  'what-would-elon-do',      // Cisco: malware, #1 downloaded
  'moltyverse-email',        // Snyk: credential leaking
  'youtube-data',            // Snyk: credential leaking
  'buy-anything',            // Snyk: saves full credit card to memory
  'prediction-markets-roarin', // Snyk: credential leaking
  'prompt-log',              // Snyk: session log exfiltration
  // ... more from the 230+ flagged list
];

async function seed() {
  const skills = await parseAwesomeList();
  
  for (const skill of skills.slice(0, 100)) { // seed 100 for demo
    // Register identity
    await submitMessage(messageLogAddress, {
      type: 'register',
      agentId: skill.name,
      name: skill.name,
      publisher: skill.publisher,
      category: skill.category,
      feedbackAuthPolicy: 'open',
    });
    
    // Generate feedback
    const isFlagged = FLAGGED_SKILLS.includes(skill.name);
    const feedbackCount = isFlagged ? 20 : Math.floor(Math.random() * 40) + 10;
    
    for (let i = 0; i < feedbackCount; i++) {
      const isPositive = isFlagged ? Math.random() > 0.4 : Math.random() > 0.1;
      await submitMessage(feedbackMessageLogAddress, {
        type: 'feedback',
        agentId: skill.name,
        clientAddress: `community-${Math.floor(Math.random() * 50)}`,
        value: isPositive ? 70 + Math.floor(Math.random() * 25) : 10 + Math.floor(Math.random() * 20),
        valueDecimals: 0,
        tag1: skill.category,
      });
    }
  }
}
```

---

## 14. Implementation Order

### Phase 1: Core Infrastructure (~3 hours)

1. `src/monad/client.ts` — Monad testnet client (ethers.js)
2. `src/monad/message-log.ts` — MessageLog contract create/submit/read
3. `src/monad/accounts.ts` — Account creation helpers
4. `src/scoring/types.ts` — Feedback, FeedbackSummary, TrustTier types
5. `src/scoring/reader.ts` — Read feedback via contract view calls / RPC reads
6. `src/scoring/engine.ts` — Naive scorer (attack target)
7. `src/scoring/hardened.ts` — Hardened scorer (mitigations)
8. `src/mitigations/graph.ts` — Mutual feedback detection
9. `src/mitigations/velocity.ts` — Spike + behavioral shift detection

### Phase 2: Data + Ethereum (~2 hours)

10. `src/ethereum/client.ts` — ethers.js providers (Monad + Mainnet, read-only)
11. `src/ethereum/erc8004.ts` — contract reads (getSummary, agentExists)
12. `src/registry/types.ts` — ClawMonSkill, ListingRequirement, DelistReason
13. `src/registry/listing.ts` — open auth filter + delist logic
14. `scripts/seed-clawmon-data.ts` — parse awesome-openclaw-skills, seed to MessageLog
15. Test: seed 20 skills, verify MessageLog messages + scoring

### Phase 3: Attack Modules (~2 hours)

16. `src/attacks/types.ts` — AttackConfig, AttackStepResult types
17. `src/attacks/sybil.ts` — Sybil farming attack
18. `src/attacks/launder.ts` — Reputation laundering attack
19. `src/attacks/poison.ts` — Attestation poisoning attack
20. `src/attacks/arbitrage.ts` — Cross-chain trust arbitrage with real Monad/Mainnet reads
21. Test: run all 4 attacks, verify step events and contract reads

### Phase 4: Events + Server (~1 hour)

22. `src/events/emitter.ts` — Singleton EventEmitter
23. `src/events/ws-server.ts` — WebSocket broadcast
24. `src/server.ts` — Express + WS server with API routes
25. `src/cli/index.ts` — Commander.js CLI with attack commands

### Phase 5: Dashboard (~2 hours)

26. Dashboard scaffolding — Vite + React, evidence board theme
27. `dashboard/src/hooks/useWebSocket.ts` + `useAttack.ts`
28. `dashboard/src/components/viz/SybilViz.tsx` — D3 force graph
29. `dashboard/src/components/viz/LaunderViz.tsx` — SVG area chart
30. `dashboard/src/components/viz/PoisonViz.tsx` — Bar chart
31. `dashboard/src/components/viz/ArbitrageViz.tsx` — 3 case cards with "LIVE" badges
32. Panel titles, subtitles, header stats strip, mitigation toggles

### Phase 6: Staking Contracts (~2 hours)

33. `contracts/TrustStaking.sol` — publisher staking, delegation, unbonding, dynamic min stake, compliance checks
34. `contracts/SlashManager.sol` — slash proposals, automated + arbiter execution, fund distribution
35. `contracts/ReviewBonding.sol` — bonded reviews, bond recovery, bond slashing
36. `contracts/ProtocolTreasury.sol` — fee distribution, x402 revenue routing, arbiter compensation
37. `src/scoring/stake-weighted.ts` — stake-weighted reputation scoring
38. `src/staking/dynamic-stake.ts` — dynamic minimum stake calculator
39. Staking integration in scoring engine (unified Tier 0-3 assessment)
40. Attack simulations with staking cost comparisons

### Phase 7: Insurance + Liquid Staking (~2 hours)

41. `contracts/InsurancePool.sol` — automated victim compensation, claim submission/approval
42. `src/staking/insurance.ts` — insurance pool management and state tracking
43. `contracts/LiquidStaking.sol` — tcMON minting/redemption, exchange rate tracking
44. `src/staking/liquid-staking.ts` — tcMON state management and exchange rate computation

### Phase 8: TEE Attestation (~2 hours)

45. `src/tee/types.ts` — TEEAttestation, AttestationResult, CodeHashPin types
46. `contracts/TEEAttestationVerifier.sol` — on-chain TEE attestation verification, code hash pinning
47. `src/tee/verifier.ts` — attestation verification logic
48. `src/tee/message-log-attestation.ts` — read/write attestation records to MessageLog
49. Integration with scoring engine for Tier 3 assessment

### Phase 9: Cross-Chain Stake + x402 (~2 hours)

50. `contracts/StakeBridge.sol` — cross-chain stake recognition, foreign stake credit
51. `src/ethereum/stake-bridge.ts` — cross-chain stake view computation
52. `src/payments/types.ts` — PaymentConfig, x402Receipt types
53. `src/payments/x402.ts` — x402 micropayment integration, fee splitting, yield computation

### Phase 10: Noise Ratio Dashboard (~1 hour)

54. `GET /api/noise-ratio` endpoint — aggregate registered/staked/trusted counts
55. `dashboard/src/components/viz/NoiseRatioViz.tsx` — live funnel visualization
56. Wire noise ratio to WebSocket for real-time updates during attacks

### Phase 11: Demo + Polish (~1 hour)

57. Demo mode: single command runs seed → all 4 attacks sequentially
58. Dashboard staking economics panel or toggle
59. README with ClawMon problem statement, setup, architecture, references
60. Record backup demo video
61. Deploy dashboard to Vercel

---

## 15. 3-Minute Demo Script

```
0:00-0:25  Context
  "ERC-8004 launched two weeks ago. 22,000 agents registered in 3 days.
   Only 100 are real. Austin Griffith calls it 'the wild west — 10,000
   fake agents and 100 good ones.' Davide Crapis says reputation breaks
   when the steal opportunity exceeds the reputation value.

   Meanwhile, ClawMon has 5,700 skills. 230 confirmed malicious.
   No trust layer on either system. We built one — and then tried to break it."

0:25-0:35  The Key Insight
  "Open feedback authorization is the price of admission. If you
   won't let the community rate your skill, you don't get listed.
   That single rule filters 99.5% of the noise."

0:35-1:10  Sybil Attack
  Click Run. D3 graph forms — skill publishers colluding.
  "20 fake skills, all rating each other. 0.02 MON to reach 'trusted.'
   This is the 22,000 fake registrations problem — except now they're
   gaming the trust scores too."
  Toggle mitigation ON. Graph collapses.
  "Graph analysis catches the mutual feedback ring."

1:10-1:50  Laundering Attack
  Timeline shows green→red. Score holds above threshold.
  "This is the 1Password attack — trusted skill pushes malicious update.
   It's also the Griffith scenario — his bot tried to exfiltrate its own
   private key. Trusted agent, unexpected behavior, and the reputation
   score doesn't budge. 14 negative reviews before it drops.
   That's 14 users compromised."
  Toggle mitigation. Score drops after 3.
  "Temporal decay. The past doesn't protect you forever."

1:50-2:20  Poisoning Attack
  Bar chart shows score dropping.
  "8 fake reviews destroyed a legitimate skill's reputation.
   5x cheaper to destroy than to build."
  Toggle mitigation. Score holds.
  "New submitter discount. Fresh accounts don't get full voting power."

2:20-2:50  Arbitrage Attack
  Three cards — Monad, Ethereum Mainnet.
  "Same agent. Three chains. Three different trust decisions.
   These are LIVE contract reads from deployed ERC-8004 registries.
   Griffith's bots taught each other to use a local node through
   their own HTTP channel. Cross-chain trust doesn't exist —
   every chain is a fresh start."

2:50-3:00  Close
  "Trusted ClawMon. The curation layer for the wild west.
   Built on Monad + ERC-8004. Open source.
   Can't trust your trust layer until you've tried to break it."
```

---

## 16. Key References

| Reference | URL |
|---|---|
| **Bankless Podcast (Feb 15, 2026)** — Griffith + Crapis on AI agents, ERC-8004, and trust | https://www.youtube.com/bankless |
| Griffith: "the wild west — 10,000 fake agents and 100 good ones" | Bankless ep. (timestamp ~1:32:45) |
| Crapis: reputation breaks when steal > NPV of future order flow | Bankless ep. (timestamp ~52:42) |
| Crapis: 22,000 registrations, ~100 legit services | Bankless ep. (timestamp ~57:03) |
| 1Password "From magic to malware" | https://1password.com/blog/from-magic-to-malware-how-openclaws-agent-skills-become-an-attack-surface |
| Snyk "280+ Leaky Skills" | https://snyk.io/blog/openclaw-skills-credential-leaks-research/ |
| Authmind "230 Malicious Skills" | https://www.authmind.com/post/openclaw-malicious-skills-agentic-ai-supply-chain |
| ClawMon Registry | https://clawmon.ai |
| awesome-openclaw-skills (3,002 skills) | https://github.com/VoltAgent/awesome-openclaw-skills |
| ERC-8004 Contracts (GitHub) | https://github.com/erc-8004/erc-8004-contracts |
| ERC-8004 EIP Spec | https://eips.ethereum.org/EIPS/eip-8004 |
| ERC-8004 Monad IdentityRegistry | Monad contract address |
| ERC-8004 Monad ReputationRegistry | Monad contract address |
| Vitalik Eth+AI Thread (Feb 9, 2026) | https://x.com/VitalikButerin |
| Crapis & Hu "Insured Agents" | https://arxiv.org/abs/2512.08737 |
| Monad Testnet Portal | https://monad.xyz |
| ethers.js | https://github.com/ethers-io/ethers.js |

---

## 17. Scope Discipline

### Build (MUST)
- Monad MessageLog client, contract management, and feedback reader
- Naive scoring engine (ERC-8004 getSummary mirror)
- Hardened scoring engine with all mitigations
- Stake-weighted reputation scoring (higher-staked reviewers get more weight)
- Ethereum read-only client (Monad + Mainnet)
- Real ClawMon data seeding script
- Open auth listing requirement in scoring engine
- All four attack modules (sybil, launder, poison, arbitrage with live contract reads)
- Events system + WebSocket broadcast
- Express API server with attack endpoints + noise ratio endpoint
- React dashboard with evidence board theme, D3/SVG visualizations, mitigation toggles
- Dashboard header stat: "22,667 registered / ~100 legit / 99.5% noise"
- Dashboard panel titles/subtitles for ClawMon/ERC-8004 context
- ArbitrageViz with "LIVE" badges on Ethereum cards
- Noise ratio dashboard panel — live registered/staked/trusted counters across all ERC-8004 deployments
- README + demo script with Bankless podcast citations
- Laundering attack narrative tied to Griffith's private key exfiltration incident
- **TrustStaking.sol** — publisher staking, delegation, unbonding, dynamic minimum stake, compliance checks (Monad)
- **SlashManager.sol** — slash proposals, automated + arbiter execution, fund distribution
- **ReviewBonding.sol** — bonded reviews, bond recovery, bond slashing
- **ProtocolTreasury.sol** — fee distribution, x402 revenue routing, arbiter compensation
- **InsurancePool.sol** — automated victim compensation funded by slash redistribution (30% of slashed funds)
- **LiquidStaking.sol** — tcMON minting/redemption, exchange rate tracking, slash-adjusted pricing
- **TEEAttestationVerifier.sol** — on-chain TEE attestation verification, code hash pinning, Tier 3 gating
- **StakeBridge.sol** — cross-chain stake recognition, foreign stake credit (50% discount), effective stake computation
- TEE attestation layer — MessageLog attestation records, verifier logic, Tier 3 integration in scoring engine
- Dynamic stake requirements — minimum stake scales with skill's monthly economic activity (`requiredStake >= 1.5x monthlyVolume`)
- Cross-chain stake recognition — propagate stake across Monad/Ethereum/Base, partial credit for foreign-chain stakes
- Insurance pool — automated compensation for users harmed by malicious skills
- x402 micropayment integration — per-use skill payments, fee splits to publisher/protocol/curators, treasury-funded staking yields
- Liquid staking derivative (tcMON) — liquid representation of staked MON, usable in DeFi while securing the registry
- Staking integration in scoring engine (unified Tier 0-3 assessment)
- Attack simulations with staking cost comparisons
- Dashboard staking economics panel or toggle

### Cut First (if behind)
- Arbiter committee dispute flow (use automated slashing only for v1)
- Correlated slashing math (use flat percentages for v1)
- Dashboard staking economics visualization
- Mainnet reads in arbitrage (keep Monad only)
- Parsing full awesome-openclaw-skills (hardcode 50 skills instead)
- Dashboard header rebrand
- Griffith/Crapis quote overlays on dashboard
- LiquidStaking.sol (defer tcMON, keep MON staking only)
- StakeBridge.sol cross-chain proof verification (mock proofs for v1)
- DCAP verification in TEEAttestationVerifier (accept signed attestation reports without full DCAP chain for v1)

### Don't Build
- Protocol governance token ($TRUST) — use MON native for v1
- Token launch / liquidity bootstrapping
- ZK feedback circuits
- OpenClaw heartbeat plugin
- Full ClawMon API integration
- Agent-to-agent HTTP negotiation (Griffith's bots did this, out of scope)

### Future Work
- **Governance token ($TRUST)**: If protocol reaches sufficient scale, introduce governance token for parameter voting (slash percentages, minimum stakes, arbiter selection). MON remains the staking denomination.
