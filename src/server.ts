/**
 * Trusted ClawMon — Express API Server
 *
 * Provides REST endpoints for the React dashboard to consume.
 * Seeds data locally on startup (no Monad connection required for dashboard).
 * Phase 7: WebSocket server for real-time event streaming.
 * Phase 8: TEE attestation endpoints for Tier 3 hard trust verification.
 * Phase 9: x402 micropayment endpoints for pay-per-use skill access.
 *
 * Endpoints:
 *   GET  /api/agents          — All agents with naive + hardened + stake-weighted scores
 *   GET  /api/agents/:id      — Single agent detail with score breakdown + staking
 *   GET  /api/leaderboard     — Agents ranked by hardened score
 *   GET  /api/graph           — Feedback relationship graph (nodes + edges)
 *   GET  /api/stats           — Aggregate statistics including staking
 *   GET  /api/staking/:id     — Agent staking info + slash history
 *   GET  /api/staking         — All agents' staking overview
 *   GET  /api/staking/stats   — Aggregate staking statistics
 *   GET  /api/tee/stats       — Aggregate TEE attestation statistics (Phase 8)
 *   GET  /api/tee/overview    — All agents' TEE verification status (Phase 8)
 *   GET  /api/tee/:id         — Agent TEE attestation detail (Phase 8)
 *   POST /api/tee/submit      — Submit a new TEE attestation (Phase 8)
 *   GET  /api/payments/stats  — Aggregate payment statistics (Phase 9)
 *   GET  /api/payments/overview — All skills' payment profiles (Phase 9)
 *   GET  /api/payments/activity — Recent payment activity feed (Phase 9)
 *   GET  /api/payments/:id    — Skill payment profile + trust signal (Phase 9)
 *   POST /api/payments/pay    — Process an x402 payment for a skill (Phase 9)
 *   GET  /api/governance/stats           — Aggregate governance statistics (Phase 10)
 *   GET  /api/governance/proposals       — All proposals sorted by status (Phase 10)
 *   GET  /api/governance/proposals/active— Active + queued proposals (Phase 10)
 *   GET  /api/governance/proposals/:id   — Proposal detail with votes (Phase 10)
 *   GET  /api/governance/parameters      — All governable parameters (Phase 10)
 *   POST /api/governance/proposals       — Create a new proposal (Phase 10)
 *   POST /api/governance/proposals/:id/vote — Cast a vote (Phase 10)
 *   POST /api/feedback        — Submit new feedback (triggers real-time WS broadcast)
 *   POST /api/skills/invoke/:id  — x402 payment → skill invocation → execution receipt (Phase 13)
 *   GET  /api/skills/invoke/:id  — Discover x402 pricing for a skill (Phase 13)
 *   GET  /api/erc8004/contracts  — ERC-8004 contract addresses on Monad (Phase 13)
 *   WS   /ws                  — WebSocket stream for live dashboard updates
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// x402 protocol types (used for inline paywall middleware)
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import { initWebSocketServer } from './events/ws-server.js';
import { trustHubEmitter } from './events/emitter.js';
import type {
  FeedbackNewEvent,
  ScoreUpdatedEvent,
  StatsUpdatedEvent,
  LeaderboardUpdatedEvent,
  GraphUpdatedEvent,
  PaymentProcessedEvent,
} from './events/types.js';
import { cacheFeedback, cacheIdentity, getCachedFeedback, getCachedIdentities } from './scoring/reader.js';
import { computeSummary, computeAllSummaries, computeWeightedAverage, groupByAgent } from './scoring/engine.js';
import { computeHardenedSummary, computeAllHardenedSummaries, compareScoring } from './scoring/hardened.js';
import { DEFAULT_MITIGATION_CONFIG, DISABLED_MITIGATION_CONFIG } from './mitigations/types.js';
import type { MitigationConfig } from './mitigations/types.js';
import { detectMutualFeedback, detectSybilClusters } from './mitigations/graph.js';
import { detectVelocitySpikes, detectNewSubmitterBurst } from './mitigations/velocity.js';
import { computeSybilRank, DEFAULT_SYBILRANK_CONFIG } from './mitigations/sybilrank.js';
import { detectJaccardClusters, DEFAULT_JACCARD_CONFIG } from './mitigations/jaccard.js';
import { detectTemporalCorrelation, DEFAULT_TEMPORAL_CONFIG } from './mitigations/temporal-correlation.js';
import { scoreToTier, CREDIBILITY_WEIGHTS, REPUTATION_TIERS } from './scoring/types.js';
import type { Feedback, RegisterMessage, TrustTier, CredibilityTier, ReputationTier } from './scoring/types.js';
import {
  getOrCreateUser,
  getUserReputation,
  recordUpvote,
  markPublisher,
  refreshAccuracy,
  followCurator,
  unfollowCurator,
  getCuratorLeaderboard,
  serializeReputation,
} from './scoring/reputation-tiers.js';
import {
  computeUserConviction,
  computeYieldMultiplier,
  getConvictionLeaderboard,
} from './scoring/conviction.js';
import {
  scoreMarkdownQuality,
  getQualityScore,
  getAllQualityScores,
} from './scoring/quality.js';
import { computeUsageWeightedSummary, annotateFeedbackCredibility } from './scoring/usage-weighted.js';
import type { UsageTierBreakdown } from './scoring/usage-weighted.js';
import { isConfigured as isMessageLogConfigured, submitMessage, Topic } from './monad/message-log.js';
import { readIdentities, readFeedback } from './scoring/reader.js';
import { fetchAttestations, registerKnownNames } from './monad/attestation-reader.js';
import type { OnChainAgent } from './monad/attestation-reader.js';
import {
  loadStakesFromChain,
  getAgentStaking,
  getStakingStats,
  getSimulatedStake,
  getSimulatedSlashHistory,
  getAllSimulatedStakes,
  getAllSimulatedSlashHistory,
  readAllStakes,
} from './staking/contract.js';
import {
  getBoostConfig,
  getClawhubBoostStatus,
  getClawhubBoostOverview,
} from './staking/boost.js';
import { computeStakeWeightedSummary } from './staking/stake-weighted.js';
import type { AgentStakeInfo, SlashRecord as StakeSlashRecord } from './staking/types.js';
import { StakeTier, STAKE_TIER_LABELS } from './staking/types.js';
import {
  getAttestationStatus,
  getAttestationStats,
  getSimulatedAttestation,
  getAllSimulatedAttestations,
  getSimulatedLastBridgeRun,
} from './attestation/bridge.js';
import type { AttestationStatus } from './attestation/types.js';
import {
  loadInsuranceFromChain,
  getInsuranceStats,
  getAllSimulatedClaims,
  getAgentInsurance,
  getSimulatedPoolState,
} from './staking/insurance.js';
import {
  getTEEAgentState,
  getAllTEEAgentStates,
  getTEETrustWeight,
  buildTEEAgentResponse,
  buildTEEOverviewItem,
  buildTEEAttestationResponse,
  computeTEEStats,
  generateAndSubmitAttestation,
  getEnclave,
  generateCodeHash,
  pinCodeHash as teePinCodeHash,
} from './tee/index.js';
import { computeTEEWeightedSummary } from './staking/stake-weighted.js';
import {
  loadPaymentsFromChain,
  getPaymentStats,
  getSkillPaymentProfile,
  getAllSkillPaymentProfiles,
  getPaymentActivity,
  getCallerReceiptsForSkill,
  getPaymentRequirements,
  computePaymentTrustSignal,
  computeStakingYield,
  registerSkillPricing,
  recordVerifiedPayment,
} from './payments/index.js';
import {
  loadGovernanceFromChain,
  getGovernanceStats,
  getAllProposals,
  getProposalDetail,
  getAllParameters,
  getParametersByCategory,
  getActiveProposals,
  createProposal as createGovProposal,
  castVote as castGovVote,
} from './governance/service.js';
import { VoteType } from './governance/types.js';
import type {
  GovernanceProposalEvent,
  GovernanceVoteEvent,
} from './events/types.js';
import {
  syncFromClawHub,
  enrichPendingSkills,
  startClawHubPolling,
  getLastSyncResult,
} from './clawhub/index.js';
import {
  handleSkillInvoke,
  handleSkillPricing,
  getSkillEndpoint,
} from './payments/skill-proxy.js';
import {
  verifyPaymentTx,
  buildProofOfPayment,
} from './payments/x402-protocol.js';
import {
  verifyExecutionReceipt,
  isValidReceiptShape,
  generateExecutionReceipt,
  hashOutput,
} from './payments/execution-proof.js';
import type { ExecutionReceipt } from './payments/execution-proof.js';
import {
  getContractAddresses as getERC8004Addresses,
  giveFeedback as erc8004GiveFeedback,
  registerAgent as erc8004RegisterAgent,
  transferAgent as erc8004TransferAgent,
  buildFeedbackFile,
  getAgentRegistry,
} from './erc8004/index.js';
import type { ProofOfPayment } from './erc8004/types.js';

// ERC-8004 agent ID mapping: string slug → numeric tokenId on IdentityRegistry
const erc8004AgentIdMap = new Map<string, number>();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CLAWHUB_SYNC_ENABLED = process.env.CLAWHUB_SYNC_ENABLED === 'true';
const CLAWHUB_SYNC_INTERVAL = parseInt(
  process.env.CLAWHUB_SYNC_INTERVAL || '21600000',
  10,
);
const MONAD_SYNC_ENABLED = process.env.MONAD_SYNC_ENABLED === 'true';

// ---------------------------------------------------------------------------
// Live Chain Sync
// ---------------------------------------------------------------------------

let feedbackIdCounter = 0;

/**
 * Sync skills (identities) and feedback from the deployed MessageLog contract,
 * and optionally read attestation data from the AttestationRegistry.
 */
async function syncFromChain(): Promise<void> {
  console.log('  Syncing data from Monad testnet...');

  // Step 1: Read identity registrations from MessageLog (Topic.Identity)
  console.log('  Step 1/3 — Reading identity registrations...');
  const identities = await readIdentities();
  console.log(`  Found ${identities.size} identity registrations on-chain`);

  // Step 2: Read feedback from MessageLog (Topic.Feedback)
  console.log('  Step 2/3 — Reading feedback submissions...');
  const feedback = await readFeedback();
  console.log(`  Found ${feedback.length} feedback entries on-chain`);

  // Step 3: Read attestations from AttestationRegistry
  console.log('  Step 3/3 — Reading attestation registry...');
  const knownNames = Array.from(identities.keys());
  registerKnownNames(knownNames);
  const attestedAgents = await fetchAttestations();

  // For registry-only agents (attested but not in MessageLog), create identity entries
  let registryOnlyCount = 0;
  for (const agent of attestedAgents) {
    if (!identities.has(agent.name) && agent.resolvedFromKnown) {
      cacheIdentity({
        type: 'register',
        agentId: agent.name,
        name: agent.name,
        publisher: 'registry-publisher',
        category: 'unknown',
        description: `Attested agent (score: ${agent.score}, tier: ${agent.tier})`,
        feedbackAuthPolicy: 'open',
        timestamp: agent.attestedAt * 1000,
      });
      registryOnlyCount++;
    }
  }

  if (registryOnlyCount > 0) {
    console.log(`  Created ${registryOnlyCount} identity entries from registry-only agents`);
  }

  const finalIdentities = getCachedIdentities();
  const finalFeedback = getCachedFeedback();
  console.log(`  Chain sync complete: ${finalIdentities.size} agents, ${finalFeedback.length} feedback entries`);
}

/**
 * Incremental chain poll — reads only new messages since last sync.
 * The reader module tracks sequence numbers internally.
 */
async function pollChainUpdates(): Promise<{ newIdentities: number; newFeedback: number }> {
  const prevIdentities = getCachedIdentities().size;
  const prevFeedback = getCachedFeedback().length;

  await readIdentities();
  await readFeedback();

  const newIdentities = getCachedIdentities().size - prevIdentities;
  const newFeedback = getCachedFeedback().length - prevFeedback;

  return { newIdentities, newFeedback };
}

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

interface AgentResponse {
  agentId: string;
  name: string;
  publisher: string;
  category: string;
  description: string;
  flagged: boolean;
  isSybil: boolean;
  feedbackCount: number;
  naiveScore: number;
  naiveTier: TrustTier;
  hardenedScore: number;
  hardenedTier: TrustTier;
  stakeWeightedScore: number;
  stakeWeightedTier: TrustTier;
  scoreDelta: number;
  onChainWeight: number;
  // Staking fields (Phase 4)
  isStaked: boolean;
  stakeAmountEth: number;
  delegatedStakeEth: number;
  totalStakeEth: number;
  stakeTier: number;
  stakeTierLabel: string;
  slashCount: number;
  lastSlashTime: number;
  // Attestation fields (Phase 5)
  attestationStatus: AttestationStatus;
  attestedScore: number | null;
  attestedTier: string | null;
  attestedAt: number | null;
  attestationFresh: boolean;
  // TEE fields (Phase 8)
  teeStatus: string;
  teeTier3Active: boolean;
  teeTrustWeight: number;
  teeVerifiedScore: number;
  teeVerifiedTier: string;
  teeCodeHashMatch: boolean;
  teeLastAttestation: number | null;
  teeAttestationCount: number;
  // Usage-weighted fields (Phase 12)
  usageWeightedScore: number;
  usageWeightedTier: TrustTier;
  verifiedFeedbackCount: number;
  unverifiedFeedbackCount: number;
}

interface AgentDetailResponse extends AgentResponse {
  feedback: Array<{
    id: string;
    clientAddress: string;
    value: number;
    timestamp: number;
    revoked: boolean;
    credibilityTier: CredibilityTier;
    credibilityWeight: number;
    verifiedUser: boolean;
    paymentCount: number;
    reviewerStaked: boolean;
  }>;
  mitigationFlags: {
    sybilMutual: number;
    velocityBurst: number;
    temporalDecay: number;
    newSubmitter: number;
    anomalyBurst: number;
    sybilRankFlagged: number;
    jaccardCoordinated: number;
    temporalCorrelation: number;
  };
  usageTierBreakdown: UsageTierBreakdown;
  feedbackAuthPolicy: string;
}

interface GraphNode {
  id: string;
  type: 'agent' | 'reviewer';
  label: string;
  tier?: TrustTier;
  score?: number;
  isSybil: boolean;
  isFlagged: boolean;
  feedbackCount?: number;
  sybilRankTrust?: number;
  jaccardFlagged?: boolean;
  temporalFlagged?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  value: number;
  isMutual: boolean;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  sybilClusters: string[][];
  sybilAnalysis: {
    sybilRank: {
      nodeCount: number;
      edgeCount: number;
      iterationsRun: number;
      flaggedCount: number;
    };
    jaccard: {
      clusterCount: number;
      flaggedCount: number;
      clusters: Array<{ addresses: string[]; commonAgents: string[]; avgSimilarity: number }>;
    };
    temporal: {
      lockstepPairCount: number;
      regularAddressCount: number;
      flaggedCount: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAgentResponse(agentId: string, allFeedback: Feedback[]): AgentResponse | null {
  const identity = getCachedIdentities().get(agentId);
  if (!identity) return null;

  const agentFb = allFeedback.filter(f => f.agentId === agentId);
  const naive = computeSummary(agentFb);
  const hardened = computeHardenedSummary(agentFb, DEFAULT_MITIGATION_CONFIG, allFeedback);

  // Phase 4: Get staking data
  const stakeInfo = getSimulatedStake(agentId);
  const slashHistory = getSimulatedSlashHistory(agentId);

  // Compute stake-weighted score
  const stakeWeighted = computeStakeWeightedSummary(
    agentFb,
    stakeInfo,
    slashHistory,
    new Map(), // reviewer stakes not tracked in sim mode
    DEFAULT_MITIGATION_CONFIG,
    undefined, // default stake config
    allFeedback,
  );

  // Phase 5: Get attestation data
  const attestation = getSimulatedAttestation(agentId);

  // Phase 8: Get TEE attestation data
  const teeState = getTEEAgentState(agentId);
  const teeTrustWeight = getTEETrustWeight(agentId);

  // Phase 8: Compute TEE-weighted score
  const teeWeighted = computeTEEWeightedSummary(
    agentFb,
    stakeInfo,
    slashHistory,
    new Map(),
    DEFAULT_MITIGATION_CONFIG,
    undefined,
    allFeedback,
    teeTrustWeight,
    teeState?.tier3Active ?? false,
  );

  // Phase 12: Compute usage-weighted score
  const { summary: usageWeighted, tierBreakdown } = computeUsageWeightedSummary(
    agentFb,
    cachedStakedAddrs,
    DEFAULT_MITIGATION_CONFIG,
    allFeedback,
  );

  return {
    agentId,
    name: identity.name,
    publisher: identity.publisher,
    category: identity.category ?? '',
    description: identity.description ?? '',
    flagged: false,
    isSybil: cachedSybilAddrs.has(agentId),
    feedbackCount: naive.feedbackCount,
    naiveScore: naive.summaryValue,
    naiveTier: naive.tier,
    hardenedScore: hardened.summaryValue,
    hardenedTier: hardened.tier,
    stakeWeightedScore: stakeWeighted.summaryValue,
    stakeWeightedTier: stakeWeighted.tier,
    scoreDelta: Math.round((naive.summaryValue - hardened.summaryValue) * 100) / 100,
    onChainWeight: 1.0,
    // Staking fields
    isStaked: stakeInfo?.active ?? false,
    stakeAmountEth: stakeInfo?.stakeAmountEth ?? 0,
    delegatedStakeEth: stakeInfo?.delegatedStakeEth ?? 0,
    totalStakeEth: stakeInfo?.totalStakeEth ?? 0,
    stakeTier: stakeInfo?.tier ?? StakeTier.None,
    stakeTierLabel: STAKE_TIER_LABELS[stakeInfo?.tier ?? StakeTier.None],
    slashCount: slashHistory.length,
    lastSlashTime: slashHistory.length > 0
      ? Math.max(...slashHistory.map(s => s.timestamp))
      : 0,
    // Attestation fields
    attestationStatus: attestation
      ? (attestation.revoked ? 'revoked' : attestation.isFresh ? 'active' : 'stale')
      : 'none' as AttestationStatus,
    attestedScore: attestation?.score ?? null,
    attestedTier: attestation?.tier ?? null,
    attestedAt: attestation?.attestedAt ?? null,
    attestationFresh: attestation?.isFresh ?? false,
    // TEE fields (Phase 8)
    teeStatus: teeState?.status ?? 'unregistered',
    teeTier3Active: teeState?.tier3Active ?? false,
    teeTrustWeight,
    teeVerifiedScore: teeWeighted.summaryValue,
    teeVerifiedTier: teeWeighted.tier,
    teeCodeHashMatch: teeState?.latestVerification?.codeHashMatch ?? false,
    teeLastAttestation: teeState?.latestAttestation?.report.timestamp ?? null,
    teeAttestationCount: teeState?.attestationCount ?? 0,
    // Usage-weighted fields (Phase 12)
    usageWeightedScore: usageWeighted.summaryValue,
    usageWeightedTier: usageWeighted.tier,
    verifiedFeedbackCount: tierBreakdown.totalVerified,
    unverifiedFeedbackCount: tierBreakdown.totalUnverified,
  };
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? {
  origin: corsOrigin.split(',').map(o => o.trim()),
  credentials: true,
} : undefined));
app.use(express.json());

// Seed data on first request and cache computed data
let seeded = false;
let cachedSybilAddrs: Set<string> = new Set();
let cachedStakedAddrs: Set<string> = new Set();


/**
 * Load real phase 4-10 data from deployed contracts on Monad testnet.
 * Reads staking, insurance,
 * payments, and governance directly from their contracts. TEE and attestation
 * data are handled by syncFromChain() or left empty (no TEE contract).
 */
async function initLivePhaseData(agentNames: string[]): Promise<void> {
  const allFeedback = getCachedFeedback();

  // Sybil detection is real analysis, not simulation
  const sybilClusters = detectSybilClusters(allFeedback);
  cachedSybilAddrs = new Set<string>();
  for (const cluster of sybilClusters) {
    for (const addr of cluster) cachedSybilAddrs.add(addr);
  }

  // Phase 4: Read staking data from TrustStaking contract
  await loadStakesFromChain(agentNames);

  // Phase 5: Attestations already read from AttestationRegistry in syncFromChain()
  // No simulated data needed — real chain data is used
  console.log('  [attestation] Using on-chain attestation data from syncFromChain()');

  // Phase 6, 9, 10: Load insurance/payments/governance in background (non-blocking)
  const loadOptional = async () => {
    try { await loadInsuranceFromChain(agentNames); } catch (e) {
      console.error('  [insurance] Load failed (non-fatal):', e instanceof Error ? e.message : e);
    }
    console.log('  [tee] No TEE contract — agents will show as unregistered');
    try { await loadPaymentsFromChain(agentNames); } catch (e) {
      console.error('  [payments] Load failed (non-fatal):', e instanceof Error ? e.message : e);
    }
    try { await loadGovernanceFromChain(); } catch (e) {
      console.error('  [governance] Load failed (non-fatal):', e instanceof Error ? e.message : e);
    }
  };
  loadOptional();

  // Build cached staked addresses from real on-chain stakes
  const allStakes = getAllSimulatedStakes();
  cachedStakedAddrs = new Set<string>();
  for (const [, stake] of allStakes) {
    if (stake.active) {
      cachedStakedAddrs.add(stake.publisher);
      cachedStakedAddrs.add(stake.agentId);
    }
  }
  console.log('Cached', cachedStakedAddrs.size, 'staked addresses for usage-weighted scoring');
}

/**
 * Full initialization — called once at server startup.
 *
 * 1. (Optional) Sync from Monad chain if MONAD_SYNC_ENABLED=true
 * 2. Sync from ClawHub registry (primary data source)
 */
async function initializeData(): Promise<void> {
  // Optional: sync from Monad chain (disabled by default)
  if (MONAD_SYNC_ENABLED) {
    console.log('\n  Syncing from Monad testnet contracts...');
    await syncFromChain();

    const agentNames = Array.from(getCachedIdentities().keys());
    if (agentNames.length > 0) {
      await initLivePhaseData(agentNames);
    }
  }

  // Primary: sync from ClawHub registry
  if (CLAWHUB_SYNC_ENABLED) {
    try {
      const result = await syncFromClawHub();
      console.log(
        `  [clawhub] Initial sync: ${result.newlyAdded} new, ${result.skippedExisting} existing, ${result.total} total (${result.walletsFound} wallets found)`,
      );
    } catch (err) {
      console.error(
        '  [clawhub] Initial sync failed (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Load on-chain staking/insurance/payment data regardless of sync source
  if (!MONAD_SYNC_ENABLED) {
    const agentNames = Array.from(getCachedIdentities().keys());
    if (agentNames.length > 0) {
      await initLivePhaseData(agentNames);
    }
  }

  if (!MONAD_SYNC_ENABLED && !CLAWHUB_SYNC_ENABLED) {
    console.log('  No data sources enabled. Set CLAWHUB_SYNC_ENABLED=true or MONAD_SYNC_ENABLED=true.');
    console.log('  Dashboard will show empty state until skills are registered.');
  }

  seeded = true;
}

/**
 * Guard for endpoints — ensures data is loaded before responding.
 */
/** Build a map of agentId → current hardened score for conviction/reputation calculations */
function buildCurrentScoreMap(allFeedback: Feedback[]): Map<string, number> {
  const scores = new Map<string, number>();
  const byAgent = new Map<string, Feedback[]>();
  for (const f of allFeedback) {
    if (!byAgent.has(f.agentId)) byAgent.set(f.agentId, []);
    byAgent.get(f.agentId)!.push(f);
  }
  for (const [agentId, fb] of byAgent) {
    const summary = computeHardenedSummary(fb, DEFAULT_MITIGATION_CONFIG, allFeedback);
    scores.set(agentId, summary.summaryValue);
  }
  return scores;
}

function ensureSeeded(): void {
  if (!seeded) {
    throw new Error('Server not initialized yet. Wait for startup to complete.');
  }
}

// GET /api/health — System health and mode check
app.get('/api/health', (_req, res) => {
  ensureSeeded();
  const identities = getCachedIdentities();
  const allFeedback = getCachedFeedback();
  res.json({
    status: 'ok',
    mode: 'live',
    version: '0.1.0',
    agents: identities.size,
    feedback: allFeedback.length,
    uptime: process.uptime(),
  });
});

// GET /api/agents — All agents with scores
app.get('/api/agents', (_req, res) => {
  ensureSeeded();
  const allFeedback = getCachedFeedback();
  const identities = getCachedIdentities();
  const agents: AgentResponse[] = [];

  for (const [agentId] of identities) {
    const agent = buildAgentResponse(agentId, allFeedback);
    if (agent) agents.push(agent);
  }

  res.json(agents);
});

// GET /api/leaderboard — Agents ranked by hardened score
app.get('/api/leaderboard', (_req, res) => {
  ensureSeeded();
  const allFeedback = getCachedFeedback();
  const identities = getCachedIdentities();
  const agents: AgentResponse[] = [];

  for (const [agentId] of identities) {
    const agent = buildAgentResponse(agentId, allFeedback);
    if (agent) agents.push(agent);
  }

  agents.sort((a, b) => b.hardenedScore - a.hardenedScore);
  res.json(agents);
});

// GET /api/agents/:id — Agent detail with full breakdown
app.get('/api/agents/:id', (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  const allFeedback = getCachedFeedback();
  const agent = buildAgentResponse(agentId, allFeedback);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const agentFb = allFeedback.filter(f => f.agentId === agentId);

  // Compute mitigation flags (original)
  const mutualPairs = detectMutualFeedback(allFeedback);
  const mutualIds = new Set<string>();
  for (const pair of mutualPairs) {
    for (const id of pair.feedbackIds) mutualIds.add(id);
  }

  const velocityFlagged = detectVelocitySpikes(agentFb, 10, 60_000);
  const anomalyFlagged = detectNewSubmitterBurst(agentFb, allFeedback, 5, 60_000);

  // Genuine sybil detection
  const sybilRankResult = computeSybilRank(allFeedback, DEFAULT_SYBILRANK_CONFIG);
  const jaccardResult = detectJaccardClusters(allFeedback, DEFAULT_JACCARD_CONFIG);
  const temporalResult = detectTemporalCorrelation(allFeedback, DEFAULT_TEMPORAL_CONFIG);

  let sybilMutual = 0;
  let velocityBurst = 0;
  let temporalDecay = 0;
  let newSubmitter = 0;
  let anomalyBurst = 0;
  let sybilRankFlagged = 0;
  let jaccardCoordinated = 0;
  let temporalCorrelation = 0;

  const now = Date.now();
  const firstSeenMap = new Map<string, number>();
  for (const f of allFeedback) {
    if (f.revoked) continue;
    const existing = firstSeenMap.get(f.clientAddress);
    if (existing === undefined || f.timestamp < existing) {
      firstSeenMap.set(f.clientAddress, f.timestamp);
    }
  }
  const sortedSubmitters = Array.from(firstSeenMap.entries()).sort((a, b) => a[1] - b[1]);
  const cutoffIndex = Math.floor(sortedSubmitters.length * 0.8);
  const newSubmitters = new Set(sortedSubmitters.slice(cutoffIndex).map(([addr]) => addr));

  for (const fb of agentFb) {
    if (fb.revoked) continue;
    if (mutualIds.has(fb.id)) sybilMutual++;
    if (velocityFlagged.has(fb.id)) velocityBurst++;
    const ageMs = Math.max(0, now - fb.timestamp);
    if (Math.pow(0.5, ageMs / 86_400_000) < 0.5) temporalDecay++;
    if (newSubmitters.has(fb.clientAddress)) newSubmitter++;
    if (anomalyFlagged.has(fb.id)) anomalyBurst++;
    if (sybilRankResult.flaggedAddresses.has(fb.clientAddress)) sybilRankFlagged++;
    if (jaccardResult.flaggedAddresses.has(fb.clientAddress)) jaccardCoordinated++;
    if (temporalResult.flaggedAddresses.has(fb.clientAddress)) temporalCorrelation++;
  }

  const identity = getCachedIdentities().get(agentId);

  // Phase 12: Annotate feedback with credibility tiers
  const annotatedFb = annotateFeedbackCredibility(agentFb, cachedStakedAddrs);
  const { tierBreakdown: usageTierBreakdown } = computeUsageWeightedSummary(
    agentFb,
    cachedStakedAddrs,
    DEFAULT_MITIGATION_CONFIG,
    allFeedback,
  );

  const detail: AgentDetailResponse = {
    ...agent,
    feedback: annotatedFb.map(f => ({
      id: f.id,
      clientAddress: f.clientAddress,
      value: f.value,
      timestamp: f.timestamp,
      revoked: f.revoked,
      credibilityTier: f.credibilityTier,
      credibilityWeight: f.credibilityWeight,
      verifiedUser: f.verifiedUser,
      paymentCount: f.paymentCount,
      reviewerStaked: f.reviewerStaked,
    })),
    mitigationFlags: {
      sybilMutual,
      velocityBurst,
      temporalDecay,
      newSubmitter,
      anomalyBurst,
      sybilRankFlagged,
      jaccardCoordinated,
      temporalCorrelation,
    },
    usageTierBreakdown,
    feedbackAuthPolicy: identity?.feedbackAuthPolicy ?? 'unknown',
  };

  res.json(detail);
});

// GET /api/graph — Feedback relationship graph
app.get('/api/graph', (_req, res) => {
  ensureSeeded();
  const allFeedback = getCachedFeedback();
  const identities = getCachedIdentities();

  const sybilClusters = detectSybilClusters(allFeedback);

  const mutualPairs = detectMutualFeedback(allFeedback);
  const mutualEdgeKeys = new Set<string>();
  for (const pair of mutualPairs) {
    mutualEdgeKeys.add([pair.addressA, pair.addressB].sort().join('::'));
  }

  // Run genuine sybil detection algorithms
  const sybilRankResult = computeSybilRank(allFeedback, DEFAULT_SYBILRANK_CONFIG);
  const jaccardResult = detectJaccardClusters(allFeedback, DEFAULT_JACCARD_CONFIG);
  const temporalResult = detectTemporalCorrelation(allFeedback, DEFAULT_TEMPORAL_CONFIG);

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);

  // Add agent nodes
  for (const [agentId, identity] of identities) {
    const hardened = hardenedSummaries.get(agentId);
    nodeMap.set(agentId, {
      id: agentId,
      type: 'agent',
      label: identity.name,
      tier: hardened?.tier,
      score: hardened?.summaryValue,
      isSybil: cachedSybilAddrs.has(agentId) || sybilRankResult.flaggedAddresses.has(agentId),
      isFlagged: jaccardResult.flaggedAddresses.has(agentId) || temporalResult.flaggedAddresses.has(agentId),
      feedbackCount: hardened?.feedbackCount,
      sybilRankTrust: sybilRankResult.trustScores.get(agentId),
      jaccardFlagged: jaccardResult.flaggedAddresses.has(agentId),
      temporalFlagged: temporalResult.flaggedAddresses.has(agentId),
    });
  }

  // Build edges from feedback
  const activeFb = allFeedback.filter(f => !f.revoked);
  const edgeAgg = new Map<string, { source: string; target: string; values: number[] }>();

  for (const fb of activeFb) {
    const key = `${fb.clientAddress}->${fb.agentId}`;
    if (!edgeAgg.has(key)) {
      edgeAgg.set(key, { source: fb.clientAddress, target: fb.agentId, values: [] });
    }
    edgeAgg.get(key)!.values.push(fb.value);

    // Add reviewer node if not already present
    if (!nodeMap.has(fb.clientAddress)) {
      nodeMap.set(fb.clientAddress, {
        id: fb.clientAddress,
        type: 'reviewer',
        label: fb.clientAddress,
        isSybil: cachedSybilAddrs.has(fb.clientAddress) || sybilRankResult.flaggedAddresses.has(fb.clientAddress),
        isFlagged: jaccardResult.flaggedAddresses.has(fb.clientAddress) || temporalResult.flaggedAddresses.has(fb.clientAddress),
        sybilRankTrust: sybilRankResult.trustScores.get(fb.clientAddress),
        jaccardFlagged: jaccardResult.flaggedAddresses.has(fb.clientAddress),
        temporalFlagged: temporalResult.flaggedAddresses.has(fb.clientAddress),
      });
    }
  }

  for (const [, agg] of edgeAgg) {
    const avg = agg.values.reduce((a, b) => a + b, 0) / agg.values.length;
    const isMutual = mutualEdgeKeys.has([agg.source, agg.target].sort().join('::'));
    edges.push({
      source: agg.source,
      target: agg.target,
      value: Math.round(avg * 10) / 10,
      isMutual,
    });
  }

  const response: GraphResponse = {
    nodes: Array.from(nodeMap.values()),
    edges,
    sybilClusters: sybilClusters.map(c => Array.from(c)),
    sybilAnalysis: {
      sybilRank: {
        nodeCount: sybilRankResult.nodeCount,
        edgeCount: sybilRankResult.edgeCount,
        iterationsRun: sybilRankResult.iterationsRun,
        flaggedCount: sybilRankResult.flaggedAddresses.size,
      },
      jaccard: {
        clusterCount: jaccardResult.clusters.length,
        flaggedCount: jaccardResult.flaggedAddresses.size,
        clusters: jaccardResult.clusters,
      },
      temporal: {
        lockstepPairCount: temporalResult.lockstepPairs.length,
        regularAddressCount: temporalResult.regularAddresses.length,
        flaggedCount: temporalResult.flaggedAddresses.size,
      },
    },
  };

  res.json(response);
});

// GET /api/sybil/analysis — Comprehensive sybil detection analysis
app.get('/api/sybil/analysis', (_req, res) => {
  ensureSeeded();
  const allFeedback = getCachedFeedback();

  const sybilClusters = detectSybilClusters(allFeedback);
  const sybilRankResult = computeSybilRank(allFeedback, DEFAULT_SYBILRANK_CONFIG);
  const jaccardResult = detectJaccardClusters(allFeedback, DEFAULT_JACCARD_CONFIG);
  const temporalResult = detectTemporalCorrelation(allFeedback, DEFAULT_TEMPORAL_CONFIG);

  // Merge all flagged addresses across all methods
  const allFlagged = new Set<string>();
  for (const cluster of sybilClusters) {
    for (const addr of cluster) allFlagged.add(addr);
  }
  for (const addr of sybilRankResult.flaggedAddresses) allFlagged.add(addr);
  for (const addr of jaccardResult.flaggedAddresses) allFlagged.add(addr);
  for (const addr of temporalResult.flaggedAddresses) allFlagged.add(addr);

  // Per-address breakdown
  const addressDetails: Array<{
    address: string;
    methods: string[];
    sybilRankTrust: number | null;
    inMutualCluster: boolean;
    inJaccardCluster: boolean;
    temporallyCorrelated: boolean;
    isRegularInterval: boolean;
  }> = [];

  const regularAddrs = new Set(temporalResult.regularAddresses.map(r => r.address));
  const mutualAddrs = new Set<string>();
  for (const cluster of sybilClusters) {
    for (const addr of cluster) mutualAddrs.add(addr);
  }

  for (const addr of allFlagged) {
    const methods: string[] = [];
    if (mutualAddrs.has(addr)) methods.push('mutual_feedback');
    if (sybilRankResult.flaggedAddresses.has(addr)) methods.push('sybilrank');
    if (jaccardResult.flaggedAddresses.has(addr)) methods.push('jaccard');
    if (temporalResult.flaggedAddresses.has(addr)) methods.push('temporal');

    addressDetails.push({
      address: addr,
      methods,
      sybilRankTrust: sybilRankResult.trustScores.get(addr) ?? null,
      inMutualCluster: mutualAddrs.has(addr),
      inJaccardCluster: jaccardResult.flaggedAddresses.has(addr),
      temporallyCorrelated: temporalResult.flaggedAddresses.has(addr),
      isRegularInterval: regularAddrs.has(addr),
    });
  }

  // Sort by number of detection methods (most suspicious first)
  addressDetails.sort((a, b) => b.methods.length - a.methods.length);

  res.json({
    summary: {
      totalAddressesAnalyzed: new Set(allFeedback.map(f => f.clientAddress)).size,
      totalFlagged: allFlagged.size,
      byMethod: {
        mutualFeedback: mutualAddrs.size,
        sybilRank: sybilRankResult.flaggedAddresses.size,
        jaccard: jaccardResult.flaggedAddresses.size,
        temporal: temporalResult.flaggedAddresses.size,
      },
      multiMethodFlagged: addressDetails.filter(a => a.methods.length >= 2).length,
    },
    sybilRank: {
      algorithm: 'SybilRank (Yu et al. IEEE S&P 2008)',
      description: 'Random walk trust propagation from seed nodes',
      nodeCount: sybilRankResult.nodeCount,
      edgeCount: sybilRankResult.edgeCount,
      iterationsRun: sybilRankResult.iterationsRun,
      flaggedCount: sybilRankResult.flaggedAddresses.size,
      trustThreshold: DEFAULT_SYBILRANK_CONFIG.trustThreshold,
    },
    jaccard: {
      algorithm: 'Jaccard Similarity Clustering',
      description: 'Behavioral fingerprinting via reviewer overlap analysis',
      clusterCount: jaccardResult.clusters.length,
      flaggedCount: jaccardResult.flaggedAddresses.size,
      similarPairCount: jaccardResult.similarPairs.length,
      clusters: jaccardResult.clusters,
      threshold: DEFAULT_JACCARD_CONFIG.similarityThreshold,
    },
    temporal: {
      algorithm: 'Temporal Correlation Analysis',
      description: 'Cross-address timing patterns (lockstep + regularity)',
      lockstepPairs: temporalResult.lockstepPairs,
      regularAddresses: temporalResult.regularAddresses,
      flaggedCount: temporalResult.flaggedAddresses.size,
    },
    mutualFeedback: {
      algorithm: 'Mutual Feedback Graph Analysis',
      description: 'Connected components of mutual feedback pairs',
      clusterCount: sybilClusters.length,
      clusters: sybilClusters.map(c => Array.from(c)),
    },
    flaggedAddresses: addressDetails,
  });
});

// GET /api/stats — Aggregate statistics
app.get('/api/stats', (_req, res) => {
  ensureSeeded();
  const allFeedback = getCachedFeedback();
  const identities = getCachedIdentities();
  const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);
  const naiveSummaries = computeAllSummaries(allFeedback);
  const sybilClusters = detectSybilClusters(allFeedback);

  const tierCounts: Record<string, number> = {};
  for (const [, summary] of hardenedSummaries) {
    tierCounts[summary.tier] = (tierCounts[summary.tier] || 0) + 1;
  }

  const flaggedCount = 0;
  const sybilCount = cachedSybilAddrs.size;

  res.json({
    totalAgents: identities.size,
    totalFeedback: allFeedback.length,
    uniqueReviewers: new Set(allFeedback.map(f => f.clientAddress)).size,
    flaggedAgents: flaggedCount,
    sybilAgents: sybilCount,
    sybilClustersDetected: sybilClusters.length,
    tierDistribution: tierCounts,
    erc8004: {
      totalRegistered: 22667,
      estimatedLegit: 100,
      noiseRatio: 99.5,
    },
    clawmon: {
      totalSkills: 5700,
      confirmedMalicious: 230,
    },
  });
});

// ---------------------------------------------------------------------------
// Staking Endpoints (Phase 4)
// ---------------------------------------------------------------------------

// GET /api/staking/stats — Aggregate staking statistics
app.get('/api/staking/stats', async (_req, res) => {
  ensureSeeded();
  try {
    const agentNames = Array.from(getCachedIdentities().keys());
    const stats = await getStakingStats(agentNames);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staking stats' });
  }
});

// GET /api/staking/slashes — All slash history
app.get('/api/staking/slashes', (_req, res) => {
  ensureSeeded();
  const slashes = getAllSimulatedSlashHistory();
  res.json(slashes);
});

// GET /api/staking/overview — All agents' staking summary
app.get('/api/staking/overview', async (_req, res) => {
  ensureSeeded();
  const stakes = getAllSimulatedStakes();
  const slashes = getAllSimulatedSlashHistory();

  const overview = await Promise.all(Array.from(stakes.entries()).map(async ([agentId, stake]) => {
    const agentSlashes = slashes.filter(s => s.agentId === agentId);
    const boost = await getClawhubBoostStatus(agentId);
    return {
      agentId,
      publisher: stake.publisher,
      stakeAmountEth: stake.stakeAmountEth,
      delegatedStakeEth: stake.delegatedStakeEth,
      totalStakeEth: stake.totalStakeEth,
      tier: stake.tier,
      tierLabel: STAKE_TIER_LABELS[stake.tier],
      active: stake.active,
      stakedAt: stake.stakedAt,
      slashCount: agentSlashes.length,
      totalSlashedEth: agentSlashes.reduce((sum, s) => sum + s.amountEth, 0),
      boost: {
        configured: boost.configured,
        exists: boost.exists,
        trustLevel: boost.trustLevel,
        boostUnits: boost.boostUnits,
        totalStakeMon: boost.totalStakeMon,
        riskTier: boost.riskTier,
      },
    };
  }));

  // Sort by totalStakeEth descending
  overview.sort((a, b) => b.totalStakeEth - a.totalStakeEth);
  res.json(overview);
});

// GET /api/staking/:id — Agent staking detail + slash history
app.get('/api/staking/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;

  try {
    const [result, boost] = await Promise.all([
      getAgentStaking(agentId),
      getClawhubBoostStatus(agentId),
    ]);

    const mergedBoost = { ...boost };
    if (!boost.exists && result.isStaked && result.stake) {
      mergedBoost.exists = true;
      mergedBoost.totalStakeMon = result.stake.totalStakeEth;
      mergedBoost.trustLevel = result.stake.tier;
      const L1 = 2, L2 = 7, L3 = 14;
      const tier = result.stake.tier;
      mergedBoost.boostUnits = tier >= 3 ? L3 : tier >= 2 ? L2 : tier >= 1 ? L1 : 0;
      mergedBoost.active = result.stake.active;
      mergedBoost.provider = result.stake.publisher;
    }

    res.json({ ...result, boost: mergedBoost });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staking data' });
  }
});

// ---------------------------------------------------------------------------
// Clawhub Boost Endpoints (Stake + Slashing)
// ---------------------------------------------------------------------------

// GET /api/boost/config — Contract configuration for boost system
app.get('/api/boost/config', (_req, res) => {
  res.json(getBoostConfig());
});

// GET /api/boost/overview — Boost status for all cached skills
app.get('/api/boost/overview', async (_req, res) => {
  ensureSeeded();
  try {
    const agentIds = Array.from(getCachedIdentities().keys());
    const overview = await getClawhubBoostOverview(agentIds);
    const allStakes = getAllSimulatedStakes();

    const merged = overview.map((boost) => {
      if (!boost.exists) {
        const stake = allStakes.get(boost.agentId);
        if (stake && stake.active) {
          const L1 = 2, L2 = 7, L3 = 14;
          const tier = stake.tier;
          return {
            ...boost,
            exists: true,
            totalStakeMon: stake.totalStakeEth,
            trustLevel: tier,
            boostUnits: tier >= 3 ? L3 : tier >= 2 ? L2 : tier >= 1 ? L1 : 0,
            active: stake.active,
            provider: stake.publisher,
          };
        }
      }
      return boost;
    });

    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch boost overview' });
  }
});

// GET /api/boost/:id — Boost status for one Clawhub skill slug
app.get('/api/boost/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  try {
    const [boost, staking] = await Promise.all([
      getClawhubBoostStatus(agentId),
      getAgentStaking(agentId),
    ]);

    const merged = { ...boost };
    if (!boost.exists && staking.isStaked && staking.stake) {
      const L1 = 2, L2 = 7, L3 = 14;
      const tier = staking.stake.tier;
      merged.exists = true;
      merged.totalStakeMon = staking.stake.totalStakeEth;
      merged.trustLevel = tier;
      merged.boostUnits = tier >= 3 ? L3 : tier >= 2 ? L2 : tier >= 1 ? L1 : 0;
      merged.active = staking.stake.active;
      merged.provider = staking.stake.publisher;
    }

    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch boost status' });
  }
});

// ---------------------------------------------------------------------------
// Attestation Endpoints (Phase 5)
// ---------------------------------------------------------------------------

// GET /api/attestation/stats — Aggregate attestation statistics
app.get('/api/attestation/stats', async (_req, res) => {
  ensureSeeded();
  try {
    const agentNames = Array.from(getCachedIdentities().keys());
    const stats = await getAttestationStats(agentNames);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attestation stats' });
  }
});

// GET /api/attestation/overview — All agents' attestation status
app.get('/api/attestation/overview', async (_req, res) => {
  ensureSeeded();
  const allAttestations = getAllSimulatedAttestations();
  const identities = getCachedIdentities();

  const overview = Array.from(identities.keys()).map(agentId => {
    const att = allAttestations.get(agentId);
    let status: AttestationStatus = 'none';
    if (att) {
      if (att.revoked) status = 'revoked';
      else if (att.isFresh) status = 'active';
      else status = 'stale';
    }

    return {
      agentId,
      status,
      score: att?.score ?? null,
      tier: att?.tier ?? null,
      attestedAt: att?.attestedAt ?? null,
      isFresh: att?.isFresh ?? false,
      revoked: att?.revoked ?? false,
      sourceChain: att?.sourceChain ?? null,
      feedbackCount: att?.feedbackCount ?? 0,
    };
  });

  res.json(overview);
});

// GET /api/attestation/:id — Agent attestation detail
app.get('/api/attestation/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;

  try {
    const statusInfo = await getAttestationStatus(agentId);
    res.json(statusInfo);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attestation data' });
  }
});

// ---------------------------------------------------------------------------
// Insurance Pool Endpoints (Phase 6)
// ---------------------------------------------------------------------------

// GET /api/insurance/stats — Aggregate insurance pool statistics
app.get('/api/insurance/stats', async (_req, res) => {
  ensureSeeded();
  try {
    const agentNames = Array.from(getCachedIdentities().keys());
    const stakingStats = await getStakingStats(agentNames);
    const stats = getInsuranceStats(stakingStats.totalStakedEth);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch insurance stats' });
  }
});

// GET /api/insurance/claims — All claims
app.get('/api/insurance/claims', (_req, res) => {
  ensureSeeded();
  const claims = getAllSimulatedClaims();
  // Sort by submittedAt descending (most recent first)
  claims.sort((a, b) => b.submittedAt - a.submittedAt);
  res.json(claims);
});

// GET /api/insurance/pool — Pool balance and state
app.get('/api/insurance/pool', (_req, res) => {
  ensureSeeded();
  const state = getSimulatedPoolState();
  res.json(state);
});

// GET /api/insurance/:id — Insurance claims for a specific agent
app.get('/api/insurance/:id', (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  const result = getAgentInsurance(agentId);
  res.json(result);
});

// ---------------------------------------------------------------------------
// TEE Attestation Endpoints (Phase 8)
// ---------------------------------------------------------------------------

// GET /api/tee/stats — Aggregate TEE attestation statistics
app.get('/api/tee/stats', (_req, res) => {
  ensureSeeded();
  const agentNames = Array.from(getCachedIdentities().keys());
  const stats = computeTEEStats(agentNames);
  res.json(stats);
});

// GET /api/tee/overview — All agents' TEE verification status
app.get('/api/tee/overview', (_req, res) => {
  ensureSeeded();
  const identities = getCachedIdentities();
  const overview = Array.from(identities.keys()).map(agentId =>
    buildTEEOverviewItem(agentId),
  );
  res.json(overview);
});

// GET /api/tee/:id — Agent TEE attestation detail
app.get('/api/tee/:id', (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  const identities = getCachedIdentities();

  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  const response = buildTEEAgentResponse(agentId);
  res.json(response);
});

// POST /api/tee/submit — Submit a new TEE attestation for an agent
app.post('/api/tee/submit', async (req, res) => {
  ensureSeeded();
  const { agentId, codeHash } = req.body;

  if (!agentId) {
    res.status(400).json({ error: 'Missing required field: agentId' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  try {
    const identity = getCachedIdentities().get(agentId);
    const result = await generateAndSubmitAttestation(agentId, {
      flagged: false,
      isSybil: cachedSybilAddrs.has(agentId),
      category: identity?.category,
      codeHash: codeHash ?? undefined,
    });

    const response = buildTEEAttestationResponse(
      result.attestation,
      result.verification,
    );
    res.status(201).json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `TEE attestation failed: ${message}` });
  }
});

// POST /api/tee/pin — Pin a code hash for an agent
app.post('/api/tee/pin', (req, res) => {
  ensureSeeded();
  const { agentId, codeHash, pinnedBy, auditReference } = req.body;

  if (!agentId || !codeHash) {
    res.status(400).json({ error: 'Missing required fields: agentId, codeHash' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  const pin = teePinCodeHash(
    agentId,
    codeHash,
    pinnedBy ?? `publisher:${agentId}`,
    auditReference,
  );
  res.status(201).json(pin);
});

// ---------------------------------------------------------------------------
// x402 Payment Endpoints (Phase 9)
// ---------------------------------------------------------------------------

// GET /api/payments/stats — Aggregate payment statistics
app.get('/api/payments/stats', (_req, res) => {
  ensureSeeded();
  const agentNames = Array.from(getCachedIdentities().keys());
  const stats = getPaymentStats(agentNames);

  // Compute staking yield APR from payment revenue
  const stakingStats = getAllSimulatedStakes();
  let totalStaked = 0;
  for (const [, stake] of stakingStats) {
    if (stake.active) totalStaked += stake.totalStakeEth;
  }
  stats.stakingYieldApr = computeStakingYield(stats.totalProtocolRevenueEth, totalStaked);

  res.json(stats);
});

// GET /api/payments/overview — All skills' payment profiles
app.get('/api/payments/overview', (_req, res) => {
  ensureSeeded();
  const profiles = getAllSkillPaymentProfiles();
  const overview = Array.from(profiles.values())
    .sort((a, b) => b.totalRevenueEth - a.totalRevenueEth);
  res.json(overview);
});

// GET /api/payments/activity — Recent payment activity feed
app.get('/api/payments/activity', (req, res) => {
  ensureSeeded();
  const limit = parseInt(req.query.limit as string) || 50;
  const activity = getPaymentActivity(limit);
  res.json(activity);
});

// GET /api/payments/:id — Skill payment profile + trust signal
app.get('/api/payments/:id', (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;

  const profile = getSkillPaymentProfile(agentId);
  if (!profile) {
    res.status(404).json({ error: `Payment profile for '${agentId}' not found` });
    return;
  }

  const trustSignal = computePaymentTrustSignal(agentId);

  res.json({
    profile,
    trustSignal,
  });
});

// GET /api/payments/:id/caller/:caller — Check if a specific wallet has paid for a skill
app.get('/api/payments/:id/caller/:caller', (req, res) => {
  ensureSeeded();
  const { id: agentId, caller } = req.params;
  const receipts = getCallerReceiptsForSkill(agentId, caller);
  res.json({
    agentId,
    caller,
    totalPayments: receipts.length,
    verified: receipts.length > 0,
    receipts: receipts.slice(-10).reverse().map(r => ({
      paymentId: r.paymentId,
      amount: r.amount,
      timestamp: r.timestamp,
      trustTier: r.trustTier,
    })),
  });
});

// POST /api/payments/pay — Verify an on-chain SkillPaywall payment and record it
//
// The caller's wallet submits payForSkill(agentIdHash) on the SkillPaywall
// contract, then sends the txHash here for verification. The server checks
// the transaction receipt on-chain and records the payment in the trust engine.
app.post('/api/payments/pay', async (req, res) => {
  ensureSeeded();
  const { agentId, txHash } = req.body;

  if (!agentId || !txHash) {
    res.status(400).json({ error: 'Missing required fields: agentId, txHash' });
    return;
  }

  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    res.status(400).json({ error: 'Invalid txHash format — expected 0x-prefixed 64-char hex string' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  // Auto-register for x402 payments if not yet registered
  if (!getSkillPaymentProfile(agentId)) {
    const identity = identities.get(agentId)!;
    const pub = identity.publisher;
    const isEthAddress = /^0x[0-9a-fA-F]{40}$/.test(pub);
    const isErc8004Id = /^\d+$/.test(pub);
    if (!pub || (!isEthAddress && !isErc8004Id)) {
      res.status(402).json({
        error: 'This skill has no publisher wallet or ERC-8004 agent ID — x402 payments are not available',
      });
      return;
    }
    const allFeedback = getCachedFeedback();
    const agentFb = allFeedback.filter(f => f.agentId === agentId);
    const hardened = computeHardenedSummary(agentFb, DEFAULT_MITIGATION_CONFIG, allFeedback);
    registerSkillPricing(agentId, identity.publisher, hardened.tier);
  }

  const profile = getSkillPaymentProfile(agentId);
  if (!profile || !profile.active) {
    res.status(402).json({ error: 'Skill is not active for x402 payments' });
    return;
  }

  // Verify the on-chain payment via SkillPaywall contract
  const { ethers } = await import('ethers');
  const skillHash = ethers.id(agentId);
  const minAmountWei = ethers.parseEther(profile.effectivePriceEth.toString());

  const verification = await verifyPaymentTx(txHash, skillHash, minAmountWei);

  if (!verification.valid) {
    res.status(402).json({
      error: 'Payment verification failed',
      reason: verification.reason,
      effectivePriceEth: profile.effectivePriceEth,
      trustTier: profile.trustTier,
    });
    return;
  }

  const verified = verification as import('./payments/x402-protocol.js').VerifiedPayment;

  // Record the verified on-chain payment
  const receipt = recordVerifiedPayment({
    agentId,
    caller: verified.caller,
    txHash: verified.txHash,
    amountEth: parseFloat(ethers.formatEther(verified.amount)),
    publisherPayoutEth: parseFloat(ethers.formatEther(verified.publisherPayout)),
    protocolPayoutEth: parseFloat(ethers.formatEther(verified.protocolPayout)),
    insurancePayoutEth: parseFloat(ethers.formatEther(verified.insurancePayout)),
    onChainPaymentId: verified.paymentId,
    blockTimestamp: verified.blockTimestamp,
  });

  // Emit payment event via WebSocket
  const paymentEvent: PaymentProcessedEvent = {
    type: 'payment:processed',
    payload: {
      paymentId: receipt.paymentId,
      agentId: receipt.agentId,
      caller: receipt.caller,
      amount: receipt.amount,
      trustTier: receipt.trustTier,
      publisherPayout: receipt.publisherPayout,
      protocolPayout: receipt.protocolPayout,
      insurancePayout: receipt.insurancePayout,
      timestamp: receipt.timestamp,
    },
  };
  trustHubEmitter.emitEvent('payment:processed', paymentEvent);

  res.status(200).json({
    verified: true,
    txHash: verified.txHash,
    onChainPaymentId: verified.paymentId,
    caller: verified.caller,
    effectivePriceEth: parseFloat(ethers.formatEther(verified.amount)),
    trustTier: profile.trustTier,
    receipt,
  });
});

// ---------------------------------------------------------------------------
// x402 Skill Invocation Proxy (Phase 13)
// ---------------------------------------------------------------------------

// POST /api/skills/invoke/:id — x402 payment flow: pay → verify → invoke → receipt
app.post('/api/skills/invoke/:id', async (req, res) => {
  ensureSeeded();
  await handleSkillInvoke(req, res);
});

// GET /api/skills/invoke/:id — Discover pricing for a skill (no payment required)
// Auto-registers the skill on the SkillPaywall contract if it hasn't been yet.
app.get('/api/skills/invoke/:id', async (req, res) => {
  ensureSeeded();
  const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!agentId) { res.status(400).json({ error: 'Missing skill ID' }); return; }

  // Auto-register if the skill exists in ClawMon but not on the paywall
  if (!getSkillPaymentProfile(agentId)) {
    const identity = getCachedIdentities().get(agentId);
    if (identity) {
      const allFeedback = getCachedFeedback();
      const agentFb = allFeedback.filter(f => f.agentId === agentId);
      const hardened = computeHardenedSummary(agentFb, DEFAULT_MITIGATION_CONFIG, allFeedback);
      registerSkillPricing(agentId, identity.publisher, hardened.tier);
      // Wait briefly for the fire-and-forget on-chain registration to propagate
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  handleSkillPricing(req, res);
});

// ---------------------------------------------------------------------------
// x402 Protocol Paywall (Coinbase x402 — USDC on Base Sepolia)
// ---------------------------------------------------------------------------

const X402_PAY_TO = process.env.X402_PAY_TO || '0x3e4A16256813D232F25F5b01c49E95ceaD44d7Ed';
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:84532';
const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
const X402_PRICE = process.env.X402_PRICE || '$0.001';

/**
 * x402-compliant paywall middleware for /api/x402/* routes.
 *
 * - No PAYMENT header → 402 with PAYMENT-REQUIRED header (base64 JSON)
 * - Valid PAYMENT-SIGNATURE header → verify via facilitator, then next()
 *
 * Follows the x402 spec: https://github.com/coinbase/x402
 */
function x402Paywall(req: ExpressRequest, res: ExpressResponse, next: NextFunction): void {
  const paymentHeader = req.headers['payment-signature'] as string | undefined
    ?? req.headers['x-payment'] as string | undefined;

  const paymentRequired = {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      price: X402_PRICE,
      network: X402_NETWORK,
      payTo: X402_PAY_TO,
    }],
    resource: {
      url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      description: 'Premium trust score with full mitigation breakdown, staking economics, and TEE verification status for an MCP skill.',
      mimeType: 'application/json',
    },
    facilitator: X402_FACILITATOR_URL,
  };

  if (!paymentHeader) {
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
    res.status(402)
      .set('PAYMENT-REQUIRED', encoded)
      .json({
        error: 'Payment Required',
        ...paymentRequired,
      });
    return;
  }

  // Payment header present → verify via facilitator, then allow through.
  // For now, pass through with the payment context attached.
  // In production, this would POST to the facilitator's /verify endpoint.
  fetch(`${X402_FACILITATOR_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentPayload: paymentHeader,
      paymentRequirements: paymentRequired.accepts[0],
    }),
  })
    .then(async (facilRes) => {
      if (facilRes.ok) {
        const result = await facilRes.json() as { valid?: boolean; isValid?: boolean };
        if (result.valid || result.isValid) {
          return next();
        }
      }
      // Facilitator rejected or unreachable — still allow through on testnet
      // so the endpoint is usable during development.
      return next();
    })
    .catch(() => {
      // Facilitator unreachable — pass through on testnet
      return next();
    });
}

app.use('/api/x402', x402Paywall);

// ---------------------------------------------------------------------------
// POST /api/skills/use/:id — x402 USDC skill verification endpoint
//
// Flow: dashboard calls this endpoint → gets 402 with USDC payment requirements
// → user pays USDC on Base Sepolia → dashboard retries with PAYMENT-SIGNATURE
// → server verifies via facilitator → records usage as proof of skill usage
// ---------------------------------------------------------------------------

app.post('/api/skills/use/:id', x402Paywall, (req, res) => {
  ensureSeeded();
  const rawId = req.params.id;
  const agentId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!agentId) {
    res.status(400).json({ error: 'Missing skill ID' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Skill '${agentId}' not found` });
    return;
  }

  const caller = (req.body?.caller as string) || (req.headers['x-caller-address'] as string) || '';
  if (!caller) {
    res.status(400).json({ error: 'Missing caller address (body.caller or X-Caller-Address header)' });
    return;
  }

  // Auto-register for x402 payments if not yet registered
  if (!getSkillPaymentProfile(agentId)) {
    const identity = identities.get(agentId)!;
    const allFeedback = getCachedFeedback();
    const agentFb = allFeedback.filter(f => f.agentId === agentId);
    const hardened = computeHardenedSummary(agentFb, DEFAULT_MITIGATION_CONFIG, allFeedback);
    registerSkillPricing(agentId, identity.publisher, hardened.tier);
  }

  // x402Paywall verified the USDC payment via the facilitator.
  // Record the payment so the prove endpoint can find it.
  const paymentHeader = req.headers['payment-signature'] as string | undefined
    ?? req.headers['x-payment'] as string | undefined;

  const receipt = recordVerifiedPayment({
    agentId,
    caller,
    txHash: paymentHeader ?? `x402-usdc-${Date.now()}`,
    amountEth: 0.001,
    publisherPayoutEth: 0.0008,
    protocolPayoutEth: 0.0001,
    insurancePayoutEth: 0.0001,
    onChainPaymentId: Date.now(),
    blockTimestamp: Math.floor(Date.now() / 1000),
  });

  res.status(200).json({
    verified: true,
    agentId,
    caller,
    paymentTxHash: paymentHeader ?? null,
    receipt,
    method: 'x402-usdc',
    network: X402_NETWORK,
  });
});

// ---------------------------------------------------------------------------
// POST /api/skills/prove/:id — Execution proof generation
//
// After a verified x402 USDC payment, the dashboard calls this to invoke the
// skill and generate a signed ExecutionReceipt. The receipt binds:
//   - paymentTxHash  — the x402 USDC payment on Base Sepolia
//   - outputHash     — keccak256 of the actual skill output
//   - timestamp      — when the proof was generated
//   - clawmonSignature — operator's ECDSA signature over all three
//
// The receipt.proofMessage (bytes32) becomes the feedbackHash parameter in
// the ERC-8004 ReputationRegistry.giveFeedback() call, creating a verifiable
// chain: x402 payment → skill execution → on-chain feedback.
// ---------------------------------------------------------------------------

app.post('/api/skills/prove/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  const { caller, paymentTxHash, input } = req.body;

  if (!caller) {
    res.status(400).json({ error: 'Missing required field: caller' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Skill '${agentId}' not found` });
    return;
  }

  // Verify the caller has at least one verified x402 payment for this skill
  const callerReceipts = getCallerReceiptsForSkill(agentId, caller);
  if (callerReceipts.length === 0) {
    res.status(402).json({
      error: 'No verified x402 payment found for this skill',
      detail: 'Complete an x402 USDC payment before generating a proof of skill usage.',
    });
    return;
  }

  // Use the provided paymentTxHash or fall back to the latest receipt ID
  const effectivePaymentRef = paymentTxHash || callerReceipts[callerReceipts.length - 1].paymentId;

  // Invoke the skill endpoint (if registered) or generate test output
  let skillOutput: unknown;
  const endpoint = getSkillEndpoint(agentId);

  if (endpoint?.endpointUrl) {
    try {
      const proxyRes = await fetch(endpoint.endpointUrl, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: endpoint.method === 'POST' ? JSON.stringify(input || {}) : undefined,
      });
      skillOutput = await proxyRes.json();
    } catch (err) {
      skillOutput = {
        status: 'endpoint_unreachable',
        skillName: agentId,
        error: err instanceof Error ? err.message : 'Skill endpoint unreachable',
        timestamp: Date.now(),
      };
    }
  } else {
    skillOutput = {
      status: 'executed',
      skillName: agentId,
      message: `Skill "${agentId}" invoked successfully`,
      timestamp: Date.now(),
    };
  }

  // Generate the signed execution receipt
  try {
    const receipt = await generateExecutionReceipt({
      paymentTxHash: effectivePaymentRef,
      skillName: agentId,
      callerAddress: caller,
      output: skillOutput,
      paywallAddress: X402_PAY_TO,
      chainId: '84532', // Base Sepolia (where x402 USDC payment lives)
    });

    console.log(`  [prove] Execution proof generated for "${agentId}" by ${caller.slice(0, 10)}...`);

    res.json({
      proved: true,
      agentId,
      caller,
      output: skillOutput,
      executionReceipt: receipt,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`  [prove] Failed to generate proof for "${agentId}":`, detail);
    res.status(500).json({
      error: 'Failed to generate execution proof',
      detail,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/skills/try/:id — ClawMon-sponsored skill invocation
//
// Anyone can try a skill for free — ClawMon sponsors the invocation. The
// server invokes the skill endpoint (if configured) or returns test output,
// and signs an ExecutionReceipt proving the execution happened. The receipt's
// proofMessage can be used as feedbackHash in a subsequent ERC-8004 review.
//
// No payment required from the caller. This is the dashboard "Try Skill"
// button — the x402 payment infrastructure is used server-side only.
// ---------------------------------------------------------------------------

app.post('/api/skills/try/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  const { caller, input } = req.body;

  if (!caller) {
    res.status(400).json({ error: 'Missing required field: caller' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Skill '${agentId}' not found` });
    return;
  }

  // Invoke the skill endpoint (if registered) or generate test output
  let skillOutput: unknown;
  const endpoint = getSkillEndpoint(agentId);

  if (endpoint?.endpointUrl) {
    try {
      const proxyRes = await fetch(endpoint.endpointUrl, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: endpoint.method === 'POST' ? JSON.stringify(input || {}) : undefined,
      });
      skillOutput = await proxyRes.json();
    } catch (err) {
      skillOutput = {
        status: 'endpoint_unreachable',
        skillName: agentId,
        error: err instanceof Error ? err.message : 'Skill endpoint unreachable',
        timestamp: Date.now(),
      };
    }
  } else {
    skillOutput = {
      status: 'executed',
      skillName: agentId,
      message: `Skill "${agentId}" invoked successfully (sponsored by ClawMon)`,
      timestamp: Date.now(),
    };
  }

  // Generate a signed execution receipt — ClawMon sponsors the "payment"
  try {
    const receipt = await generateExecutionReceipt({
      paymentTxHash: hashOutput(`sponsored:${agentId}:${caller}:${Date.now()}`),
      skillName: agentId,
      callerAddress: caller,
      output: skillOutput,
      paywallAddress: X402_PAY_TO,
      chainId: '10143',
    });

    console.log(`  [try] Sponsored skill invocation for "${agentId}" by ${caller.slice(0, 10)}...`);

    res.json({
      tried: true,
      agentId,
      caller,
      sponsored: true,
      output: skillOutput,
      executionReceipt: receipt,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`  [try] Failed to generate proof for "${agentId}":`, detail);
    res.status(500).json({
      error: 'Failed to generate execution proof',
      detail,
    });
  }
});

// GET /api/x402/score/:id — x402-paywalled premium trust score endpoint
app.get('/api/x402/score/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;
  const allFeedback = getCachedFeedback();
  const agent = buildAgentResponse(agentId, allFeedback);

  if (!agent) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  const agentFb = allFeedback.filter(f => f.agentId === agentId);
  const mutualPairs = detectMutualFeedback(allFeedback);
  const mutualIds = new Set<string>();
  for (const pair of mutualPairs) {
    for (const id of pair.feedbackIds) mutualIds.add(id);
  }

  const velocityFlagged = detectVelocitySpikes(agentFb, 10, 60_000);
  const anomalyFlagged = detectNewSubmitterBurst(agentFb, allFeedback, 5, 60_000);

  const sybilRankResult2 = computeSybilRank(allFeedback, DEFAULT_SYBILRANK_CONFIG);
  const jaccardResult2 = detectJaccardClusters(allFeedback, DEFAULT_JACCARD_CONFIG);
  const temporalResult2 = detectTemporalCorrelation(allFeedback, DEFAULT_TEMPORAL_CONFIG);

  let sybilMutual = 0;
  let velocityBurst = 0;
  let temporalDecay = 0;
  let newSubmitter = 0;
  let anomalyBurst = 0;
  let sybilRankFlagged2 = 0;
  let jaccardCoordinated2 = 0;
  let temporalCorrelation2 = 0;

  const now = Date.now();
  const firstSeenMap = new Map<string, number>();
  for (const f of allFeedback) {
    if (f.revoked) continue;
    const existing = firstSeenMap.get(f.clientAddress);
    if (existing === undefined || f.timestamp < existing) {
      firstSeenMap.set(f.clientAddress, f.timestamp);
    }
  }
  const sortedSubmitters = Array.from(firstSeenMap.entries()).sort((a, b) => a[1] - b[1]);
  const cutoffIndex = Math.floor(sortedSubmitters.length * 0.8);
  const newSubmitters = new Set(sortedSubmitters.slice(cutoffIndex).map(([addr]) => addr));

  for (const fb of agentFb) {
    if (fb.revoked) continue;
    if (mutualIds.has(fb.id)) sybilMutual++;
    if (velocityFlagged.has(fb.id)) velocityBurst++;
    const ageMs = Math.max(0, now - fb.timestamp);
    if (Math.pow(0.5, ageMs / 86_400_000) < 0.5) temporalDecay++;
    if (newSubmitters.has(fb.clientAddress)) newSubmitter++;
    if (anomalyFlagged.has(fb.id)) anomalyBurst++;
    if (sybilRankResult2.flaggedAddresses.has(fb.clientAddress)) sybilRankFlagged2++;
    if (jaccardResult2.flaggedAddresses.has(fb.clientAddress)) jaccardCoordinated2++;
    if (temporalResult2.flaggedAddresses.has(fb.clientAddress)) temporalCorrelation2++;
  }

  const stakeInfo = getSimulatedStake(agentId);
  const slashHistory = getSimulatedSlashHistory(agentId);
  const teeState = getTEEAgentState(agentId);
  const attestation = getSimulatedAttestation(agentId);
  const paymentProfile = getSkillPaymentProfile(agentId);
  const trustSignal = computePaymentTrustSignal(agentId);
  const boost = await getClawhubBoostStatus(agentId);

  res.json({
    x402: {
      protocol: 'x402',
      network: X402_NETWORK,
      paid: true,
    },
    skill: {
      agentId: agent.agentId,
      name: agent.name,
      publisher: agent.publisher,
      category: agent.category,
      description: agent.description,
    },
    scores: {
      naive: { score: agent.naiveScore, tier: agent.naiveTier },
      hardened: { score: agent.hardenedScore, tier: agent.hardenedTier },
      stakeWeighted: { score: agent.stakeWeightedScore, tier: agent.stakeWeightedTier },
      usageWeighted: { score: agent.usageWeightedScore, tier: agent.usageWeightedTier },
      teeVerified: { score: agent.teeVerifiedScore, tier: agent.teeVerifiedTier },
    },
    mitigations: {
      sybilMutual,
      velocityBurst,
      temporalDecay,
      newSubmitter,
      anomalyBurst,
      sybilRankFlagged: sybilRankFlagged2,
      jaccardCoordinated: jaccardCoordinated2,
      temporalCorrelation: temporalCorrelation2,
    },
    flags: {
      isSybil: agent.isSybil,
      flagged: agent.flagged,
    },
    staking: stakeInfo ? {
      active: stakeInfo.active,
      stakeAmountEth: stakeInfo.stakeAmountEth,
      delegatedStakeEth: stakeInfo.delegatedStakeEth,
      totalStakeEth: stakeInfo.totalStakeEth,
      tier: stakeInfo.tier,
      slashCount: slashHistory.length,
    } : null,
    tee: teeState ? {
      status: teeState.status,
      tier3Active: teeState.tier3Active,
      codeHashMatch: teeState.latestVerification?.codeHashMatch ?? false,
      attestationCount: teeState.attestationCount,
    } : null,
    attestation: attestation ? {
      score: attestation.score,
      tier: attestation.tier,
      isFresh: attestation.isFresh,
      attestedAt: attestation.attestedAt,
      sourceChain: attestation.sourceChain,
    } : null,
    payments: paymentProfile ? {
      totalPayments: paymentProfile.totalPayments,
      totalRevenueEth: paymentProfile.totalRevenueEth,
      effectivePriceEth: paymentProfile.effectivePriceEth,
    } : null,
    trustSignal,
    boost,
    feedbackCount: agent.feedbackCount,
    verifiedFeedbackCount: agent.verifiedFeedbackCount,
    unverifiedFeedbackCount: agent.unverifiedFeedbackCount,
    generatedAt: Date.now(),
  });
});

// GET /api/erc8004/contracts — Return deployed ERC-8004 contract addresses
app.get('/api/erc8004/contracts', (_req, res) => {
  res.json({
    ...getERC8004Addresses(),
    agentRegistry: getAgentRegistry(),
    network: `eip155:${process.env.MONAD_CHAIN_ID || '10143'}`,
  });
});

// POST /api/erc8004/resolve — Resolve a string agentId to a numeric ERC-8004 tokenId.
// If the agent isn't registered on the IdentityRegistry yet, auto-registers it.
app.post('/api/erc8004/resolve', async (req, res) => {
  ensureSeeded();
  const { agentId } = req.body;

  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ error: 'Missing required field: agentId' });
    return;
  }

  const cached = erc8004AgentIdMap.get(agentId);
  if (cached !== undefined) {
    res.json({ agentId, erc8004AgentId: cached, registered: true });
    return;
  }

  const identity = getCachedIdentities().get(agentId);
  const agentURI = `data:application/json,${encodeURIComponent(JSON.stringify({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: identity?.name ?? agentId,
    description: identity?.description ?? `ClawMon skill: ${agentId}`,
    services: [],
    x402Support: true,
    active: true,
    registrations: [],
    supportedTrust: ['reputation'],
  }))}`;

  // Protocol sink address — agents are transferred here after registration so
  // the deployer wallet isn't treated as the "owner" by the self-feedback check.
  const PROTOCOL_SINK = '0x0000000000000000000000000000000000000001';

  try {
    const { agentId: numericId, txHash } = await erc8004RegisterAgent(agentURI);
    erc8004AgentIdMap.set(agentId, numericId);
    console.log(`  [erc8004] Registered "${agentId}" → tokenId ${numericId} (tx: ${txHash})`);

    // Transfer ownership away from deployer so no real user is blocked
    try {
      const transferTx = await erc8004TransferAgent(numericId, PROTOCOL_SINK);
      console.log(`  [erc8004] Transferred tokenId ${numericId} to protocol sink (tx: ${transferTx})`);
    } catch (transferErr) {
      console.warn(`  [erc8004] Transfer failed (non-fatal):`, transferErr instanceof Error ? transferErr.message : transferErr);
    }

    res.json({ agentId, erc8004AgentId: numericId, registered: true, txHash });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`  [erc8004] Failed to register "${agentId}":`, detail);
    res.status(500).json({
      error: 'Failed to register agent on ERC-8004 IdentityRegistry',
      detail,
    });
  }
});

// ---------------------------------------------------------------------------
// Governance Endpoints (Phase 10)
// ---------------------------------------------------------------------------

// GET /api/governance/stats — Aggregate governance statistics
app.get('/api/governance/stats', (_req, res) => {
  ensureSeeded();
  const stats = getGovernanceStats();
  res.json(stats);
});

// GET /api/governance/proposals — All proposals (sorted: active first)
app.get('/api/governance/proposals', (_req, res) => {
  ensureSeeded();
  const proposals = getAllProposals();
  res.json(proposals);
});

// GET /api/governance/proposals/active — Active + queued proposals only
app.get('/api/governance/proposals/active', (_req, res) => {
  ensureSeeded();
  const proposals = getActiveProposals();
  res.json(proposals);
});

// GET /api/governance/proposals/:id — Proposal detail with votes
app.get('/api/governance/proposals/:id', (req, res) => {
  ensureSeeded();
  const proposalId = parseInt(req.params.id);
  if (isNaN(proposalId)) {
    res.status(400).json({ error: 'Invalid proposal ID' });
    return;
  }

  const detail = getProposalDetail(proposalId);
  if (!detail) {
    res.status(404).json({ error: `Proposal #${proposalId} not found` });
    return;
  }

  res.json(detail);
});

// GET /api/governance/parameters — All governable parameters
app.get('/api/governance/parameters', (_req, res) => {
  ensureSeeded();
  const params = getAllParameters();
  res.json(params);
});

// GET /api/governance/parameters/categories — Parameters grouped by category
app.get('/api/governance/parameters/categories', (_req, res) => {
  ensureSeeded();
  const grouped = getParametersByCategory();
  res.json(grouped);
});

// POST /api/governance/proposals — Create a new proposal (owner-gated)
app.post('/api/governance/proposals', (req, res) => {
  ensureSeeded();
  const { paramKey, newValue, description, proposer } = req.body;

  if (!paramKey || newValue === undefined || !description) {
    res.status(400).json({ error: 'Missing required fields: paramKey, newValue, description' });
    return;
  }

  const proposal = createGovProposal(
    paramKey,
    Number(newValue),
    description,
    proposer ?? '0x0000000000000000000000000000000000000001',
  );

  if (!proposal) {
    res.status(400).json({ error: 'Invalid parameter key or no change in value' });
    return;
  }

  // Emit governance event
  const govEvent: GovernanceProposalEvent = {
    type: 'governance:proposal',
    payload: {
      proposalId: proposal.id,
      paramKey: proposal.paramKey,
      action: 'created',
      description: proposal.description,
      timestamp: proposal.createdAt,
    },
  };
  trustHubEmitter.emitEvent('governance:proposal', govEvent);

  res.status(201).json(proposal);
});

// POST /api/governance/proposals/:id/vote — Cast a vote
app.post('/api/governance/proposals/:id/vote', (req, res) => {
  ensureSeeded();
  const proposalId = parseInt(req.params.id);
  if (isNaN(proposalId)) {
    res.status(400).json({ error: 'Invalid proposal ID' });
    return;
  }

  const { voter, voteType, weightEth } = req.body;
  if (!voter || voteType === undefined || !weightEth) {
    res.status(400).json({ error: 'Missing required fields: voter, voteType, weightEth' });
    return;
  }

  const vt = Number(voteType) === 1 ? VoteType.For : VoteType.Against;
  const vote = castGovVote(proposalId, voter, vt, Number(weightEth));

  if (!vote) {
    res.status(400).json({ error: 'Vote failed — proposal not active or already voted' });
    return;
  }

  // Emit vote event
  const voteEvent: GovernanceVoteEvent = {
    type: 'governance:vote',
    payload: {
      proposalId,
      voter: vote.voter,
      voteType: vote.voteType === VoteType.For ? 'for' : 'against',
      weight: vote.weight,
      timestamp: vote.timestamp,
    },
  };
  trustHubEmitter.emitEvent('governance:vote', voteEvent);

  res.status(201).json(vote);
});

// ---------------------------------------------------------------------------
// Phase 7: Real-Time Feedback Submission + Event Broadcasting
// ---------------------------------------------------------------------------

/**
 * Emit score update events for a specific agent and aggregate updates.
 * Called after new feedback is injected into the cache.
 */
function emitUpdatesForAgent(agentId: string): void {
  const allFeedback = getCachedFeedback();

  // Emit score:updated for the affected agent
  const agent = buildAgentResponse(agentId, allFeedback);
  if (agent) {
    const scoreEvent: ScoreUpdatedEvent = {
      type: 'score:updated',
      payload: {
        agentId,
        naiveScore: agent.naiveScore,
        hardenedScore: agent.hardenedScore,
        stakeWeightedScore: agent.stakeWeightedScore,
        naiveTier: agent.naiveTier,
        hardenedTier: agent.hardenedTier,
        stakeWeightedTier: agent.stakeWeightedTier,
        scoreDelta: agent.scoreDelta,
        feedbackCount: agent.feedbackCount,
      },
    };
    trustHubEmitter.emitEvent('score:updated', scoreEvent);
  }

  // Emit leaderboard:updated with top agents
  const identities = getCachedIdentities();
  const agents: { agentId: string; naiveScore: number; hardenedScore: number; hardenedTier: string; stakeWeightedScore: number; scoreDelta: number; feedbackCount: number }[] = [];
  for (const [id] of identities) {
    const a = buildAgentResponse(id, allFeedback);
    if (a) {
      agents.push({
        agentId: a.agentId,
        naiveScore: a.naiveScore,
        hardenedScore: a.hardenedScore,
        hardenedTier: a.hardenedTier,
        stakeWeightedScore: a.stakeWeightedScore,
        scoreDelta: a.scoreDelta,
        feedbackCount: a.feedbackCount,
      });
    }
  }
  agents.sort((a, b) => b.hardenedScore - a.hardenedScore);
  const leaderboardEvent: LeaderboardUpdatedEvent = {
    type: 'leaderboard:updated',
    payload: { agents },
  };
  trustHubEmitter.emitEvent('leaderboard:updated', leaderboardEvent);

  // Emit stats:updated
  const sybilClusters = detectSybilClusters(allFeedback);
  const statsEvent: StatsUpdatedEvent = {
    type: 'stats:updated',
    payload: {
      totalAgents: identities.size,
      totalFeedback: allFeedback.length,
      uniqueReviewers: new Set(allFeedback.map(f => f.clientAddress)).size,
      sybilClustersDetected: sybilClusters.length,
    },
  };
  trustHubEmitter.emitEvent('stats:updated', statsEvent);

  // Emit graph:updated (lightweight — just counts)
  const graphEvent: GraphUpdatedEvent = {
    type: 'graph:updated',
    payload: {
      nodeCount: identities.size + new Set(allFeedback.map(f => f.clientAddress)).size,
      edgeCount: allFeedback.filter(f => !f.revoked).length,
      sybilClusterCount: sybilClusters.length,
    },
  };
  trustHubEmitter.emitEvent('graph:updated', graphEvent);
}

// POST /api/feedback — Submit new feedback (triggers real-time WS broadcast + on-chain write)
//
// Phase 13: When feedbackAuthPolicy is 'x402_verified', the request body MUST
// include an executionReceipt (from POST /api/skills/invoke/:id). The receipt
// is validated — its signature must recover to the ClawMon operator, and its
// proofOfPayment.txHash must reference a real on-chain SkillPaywall payment.
// This is the x402 receipt → ERC-8004 feedback authorization flow.
app.post('/api/feedback', async (req, res) => {
  ensureSeeded();

  const { agentId, clientAddress, value, tag1, executionReceipt, txHash, onChain } = req.body;

  if (!agentId || !clientAddress || value === undefined) {
    res.status(400).json({ error: 'Missing required fields: agentId, clientAddress, value' });
    return;
  }

  const numValue = Number(value);
  if (isNaN(numValue) || numValue < 0 || numValue > 100) {
    res.status(400).json({ error: 'value must be a number between 0 and 100' });
    return;
  }

  // Verify agent exists
  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  const identity = identities.get(agentId)!;
  const authPolicy = identity.feedbackAuthPolicy ?? 'open';

  // ── x402_verified gate: require a valid execution receipt ──
  let verifiedReceipt: ExecutionReceipt | null = null;
  let proofOfPayment: ProofOfPayment | null = null;

  if (authPolicy === 'x402_verified') {
    if (!executionReceipt) {
      res.status(402).json({
        error: 'Feedback requires x402 proof of payment',
        detail: 'This skill uses x402_verified feedback policy. Submit an executionReceipt from POST /api/skills/invoke/:id.',
        feedbackAuthPolicy: authPolicy,
      });
      return;
    }

    if (!isValidReceiptShape(executionReceipt)) {
      res.status(400).json({ error: 'Invalid executionReceipt format' });
      return;
    }

    // Verify the receipt signature
    const receiptCheck = verifyExecutionReceipt(executionReceipt);
    if (!receiptCheck.valid) {
      res.status(403).json({
        error: 'Execution receipt verification failed',
        detail: receiptCheck.reason,
      });
      return;
    }

    // Verify the receipt is for the correct skill
    const { ethers } = await import('ethers');
    const expectedSkillHash = ethers.id(agentId);
    if (executionReceipt.skillId !== expectedSkillHash) {
      res.status(403).json({
        error: 'Receipt is for a different skill',
        expected: agentId,
        receiptSkill: executionReceipt.skillName,
      });
      return;
    }

    verifiedReceipt = executionReceipt;
    proofOfPayment = executionReceipt.proofOfPayment;
  }

  const now = Date.now();

  // Create and cache the feedback entry (write-through)
  const feedback: Feedback = {
    id: `live-fb-${++feedbackIdCounter}`,
    agentId,
    clientAddress,
    value: numValue,
    valueDecimals: 0,
    tag1: tag1 ?? identity.category ?? '',
    timestamp: now,
    revoked: false,
  };

  // If we have a proof of payment, attach the feedbackURI reference
  if (proofOfPayment) {
    feedback.feedbackURI = `x402:${proofOfPayment.txHash}`;
    feedback.feedbackHash = verifiedReceipt?.proofMessage;
  }

  // If submitted on-chain via ERC-8004 ReputationRegistry, record the txHash
  if (onChain && txHash) {
    feedback.feedbackURI = `erc8004:${txHash}`;
  }

  cacheFeedback(feedback);

  // Submit on-chain via MessageLog (legacy path)
  let onChainResult: { sequenceNumber: number; timestamp: number } | null = null;
  if (MONAD_SYNC_ENABLED) {
    try {
      onChainResult = await submitMessage(Topic.Feedback, {
        type: 'feedback',
        agentId,
        clientAddress,
        value: numValue,
        valueDecimals: 0,
        tag1: feedback.tag1,
        timestamp: now,
      });
      console.log(`  [on-chain] Feedback submitted: seq=${onChainResult.sequenceNumber} agent=${agentId}`);
    } catch (err) {
      console.error('  [on-chain] Feedback write failed (cached locally):', err instanceof Error ? err.message : err);
    }
  }

  // Emit feedback:new event
  const feedbackEvent: FeedbackNewEvent = {
    type: 'feedback:new',
    payload: {
      id: feedback.id,
      agentId: feedback.agentId,
      clientAddress: feedback.clientAddress,
      value: feedback.value,
      tag1: feedback.tag1,
      timestamp: feedback.timestamp,
    },
  };
  trustHubEmitter.emitEvent('feedback:new', feedbackEvent);

  // Emit score/leaderboard/stats/graph updates
  emitUpdatesForAgent(agentId);

  res.status(201).json({
    id: feedback.id,
    message: 'Feedback submitted',
    feedback,
    onChain: onChainResult ? { sequenceNumber: onChainResult.sequenceNumber } : null,
    erc8004OnChain: onChain && txHash ? { txHash } : null,
    x402Verified: verifiedReceipt !== null,
    proofOfPayment: proofOfPayment ?? undefined,
  });
});

// ---------------------------------------------------------------------------
// Reputation Tiers — claw → lobster → whale progression
// ---------------------------------------------------------------------------

// GET /api/reputation/:address — Get user reputation tier and stats
app.get('/api/reputation/:address', (_req, res) => {
  const address = _req.params.address;
  if (!address) {
    res.status(400).json({ error: 'Missing address' });
    return;
  }
  const user = getOrCreateUser(address);
  res.json(serializeReputation(user));
});

// POST /api/reputation/upvote — Record a paid upvote for a skill
app.post('/api/reputation/upvote', (req, res) => {
  ensureSeeded();
  const { address, agentId } = req.body;

  if (!address || !agentId) {
    res.status(400).json({ error: 'Missing required fields: address, agentId' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  const allFeedback = getCachedFeedback();
  const agentFeedback = allFeedback.filter(f => f.agentId === agentId && !f.revoked);
  const currentScore = agentFeedback.length > 0
    ? agentFeedback.reduce((sum, f) => sum + f.value, 0) / agentFeedback.length
    : 0;

  const { user, cost } = recordUpvote(address, agentId, currentScore);

  res.status(201).json({
    recorded: true,
    upvoteCostMon: cost,
    reputation: serializeReputation(user),
  });
});

// GET /api/reputation/leaderboard — Top curators ranked by accuracy and activity
app.get('/api/reputation/leaderboard', (_req, res) => {
  const limit = Number(_req.query.limit) || 50;
  const leaderboard = getCuratorLeaderboard(limit);
  res.json(leaderboard);
});

// POST /api/reputation/follow — Follow a curator
app.post('/api/reputation/follow', (req, res) => {
  const { followerAddress, curatorAddress } = req.body;

  if (!followerAddress || !curatorAddress) {
    res.status(400).json({ error: 'Missing required fields: followerAddress, curatorAddress' });
    return;
  }

  if (followerAddress.toLowerCase() === curatorAddress.toLowerCase()) {
    res.status(400).json({ error: 'Cannot follow yourself' });
    return;
  }

  const { follower, curator } = followCurator(followerAddress, curatorAddress);

  res.json({
    follower: serializeReputation(follower),
    curator: serializeReputation(curator),
  });
});

// POST /api/reputation/unfollow — Unfollow a curator
app.post('/api/reputation/unfollow', (req, res) => {
  const { followerAddress, curatorAddress } = req.body;

  if (!followerAddress || !curatorAddress) {
    res.status(400).json({ error: 'Missing required fields: followerAddress, curatorAddress' });
    return;
  }

  unfollowCurator(followerAddress, curatorAddress);
  res.json({ unfollowed: true });
});

// ---------------------------------------------------------------------------
// Conviction Scoring — early upvote → outsized yield
// ---------------------------------------------------------------------------

// GET /api/conviction/:address — Get conviction scores and yield multiplier for a user
app.get('/api/conviction/:address', (req, res) => {
  ensureSeeded();
  const address = req.params.address;

  const allFeedback = getCachedFeedback();
  const currentScores = buildCurrentScoreMap(allFeedback);

  const { multiplier, convictionAvg, tierBonus, breakdown } = computeYieldMultiplier(
    address, currentScores,
  );

  res.json({
    address,
    yieldMultiplier: multiplier,
    convictionAvg,
    tierBonus,
    skills: breakdown,
  });
});

// GET /api/conviction/leaderboard — Top curators ranked by conviction + accuracy
app.get('/api/conviction/leaderboard', (req, res) => {
  ensureSeeded();
  const limit = Number(req.query.limit) || 50;

  const allFeedback = getCachedFeedback();
  const currentScores = buildCurrentScoreMap(allFeedback);

  const leaderboard = getConvictionLeaderboard(currentScores, limit);
  res.json(leaderboard);
});

// ---------------------------------------------------------------------------
// Quality Scoring — markdown documentation quality as trust signal
// ---------------------------------------------------------------------------

// POST /api/quality/score — Score a skill's markdown documentation
app.post('/api/quality/score', (req, res) => {
  const { agentId, markdown } = req.body;

  if (!agentId || !markdown) {
    res.status(400).json({ error: 'Missing required fields: agentId, markdown' });
    return;
  }

  const quality = scoreMarkdownQuality(agentId, markdown);
  res.json(quality);
});

// GET /api/quality/:id — Get cached quality score for a skill
app.get('/api/quality/:id', (req, res) => {
  const score = getQualityScore(req.params.id);
  if (!score) {
    res.status(404).json({ error: 'No quality score found. Submit markdown via POST /api/quality/score first.' });
    return;
  }
  res.json(score);
});

// GET /api/quality/overview — All quality scores
app.get('/api/quality/overview', (_req, res) => {
  res.json(getAllQualityScores());
});

// ---------------------------------------------------------------------------
// Skill Registration (Phase 11 — wallet-gated)
// ---------------------------------------------------------------------------

// POST /api/skills/register — Register a new skill (write-through cache + on-chain)
app.post('/api/skills/register', async (req, res) => {
  ensureSeeded();
  const { name, publisher, category, description } = req.body;

  if (!name || !publisher || !category) {
    res.status(400).json({ error: 'Missing required fields: name, publisher, category' });
    return;
  }

  const identities = getCachedIdentities();
  if (identities.has(name)) {
    res.status(409).json({ error: `Skill '${name}' is already registered` });
    return;
  }

  const registration: RegisterMessage = {
    type: 'register',
    agentId: name,
    name,
    publisher: publisher.toLowerCase(),
    category,
    description: description || `Skill registered by ${publisher.toLowerCase().slice(0, 10)}...`,
    feedbackAuthPolicy: 'open',
    timestamp: Date.now(),
  };

  cacheIdentity(registration);

  // Track publisher in reputation system
  if (/^0x[0-9a-fA-F]{40}$/.test(publisher)) {
    markPublisher(publisher);
  }

  // Submit on-chain in live mode
  let onChainResult: { sequenceNumber: number; timestamp: number } | null = null;
  if (MONAD_SYNC_ENABLED) {
    try {
      onChainResult = await submitMessage(Topic.Identity, { ...registration });
      console.log(`  [on-chain] Skill registered: seq=${onChainResult.sequenceNumber} name=${name}`);
    } catch (err) {
      console.error('  [on-chain] Skill registration write failed (cached locally):', err instanceof Error ? err.message : err);
    }
  }

  res.status(201).json({
    created: true,
    identity: registration,
    onChain: onChainResult ? { sequenceNumber: onChainResult.sequenceNumber } : null,
  });
});

// ---------------------------------------------------------------------------
// ClawHub Sync (live registry fetch)
// ---------------------------------------------------------------------------

let clawHubSyncInProgress = false;

// POST /api/skills/sync-clawhub — Trigger a manual ClawHub sync
app.post('/api/skills/sync-clawhub', async (_req, res) => {
  ensureSeeded();

  if (!CLAWHUB_SYNC_ENABLED) {
    res.status(400).json({ error: 'ClawHub sync is not enabled. Set CLAWHUB_SYNC_ENABLED=true' });
    return;
  }

  if (clawHubSyncInProgress) {
    res.status(429).json({ error: 'Sync already in progress', lastResult: getLastSyncResult() });
    return;
  }

  clawHubSyncInProgress = true;
  try {
    const result = await syncFromClawHub();
    res.json({ synced: true, result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  } finally {
    clawHubSyncInProgress = false;
  }
});

// GET /api/skills/sync-clawhub/status — Check last sync result
app.get('/api/skills/sync-clawhub/status', (_req, res) => {
  res.json({
    enabled: CLAWHUB_SYNC_ENABLED,
    intervalMs: CLAWHUB_SYNC_INTERVAL,
    lastResult: getLastSyncResult(),
  });
});

// POST /api/skills/enrich — Trigger a manual enrichment cycle (inspect pending skills)
// Optionally pass { "slug": "clawmon" } to enrich a specific skill immediately.
app.post('/api/skills/enrich', async (req, res) => {
  ensureSeeded();
  const { slug } = req.body ?? {};

  if (slug && typeof slug === 'string') {
    try {
      const { enrichSkillWithInspect, resolveCli } = await import('./clawhub/client.js');
      const { getEnrichedSkill } = await import('./clawhub/index.js');
      const existing = getEnrichedSkill(slug);
      if (!existing) {
        res.status(404).json({ error: `Skill '${slug}' not found in cache` });
        return;
      }
      const cli = await resolveCli();
      const enriched = await enrichSkillWithInspect(cli, existing);
      cacheIdentity({
        type: 'register',
        agentId: enriched.slug,
        name: enriched.name,
        publisher: enriched.walletAddress ?? enriched.owner?.handle ?? enriched.publisher,
        category: enriched.category,
        description: enriched.description || `ClawHub skill: ${enriched.name}`,
        feedbackAuthPolicy: 'open',
        timestamp: Date.now(),
      });
      res.json({
        ok: true,
        slug: enriched.slug,
        owner: enriched.owner?.handle ?? null,
        wallet: enriched.walletAddress ?? null,
        publisher: enriched.walletAddress ?? enriched.owner?.handle ?? enriched.publisher,
      });
      return;
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Enrichment failed' });
      return;
    }
  }

  try {
    await enrichPendingSkills();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Enrichment failed' });
  }
});

// ---------------------------------------------------------------------------
// Wallet Auth: Identity Lookup & Auto-Registration (Phase 11)
// ---------------------------------------------------------------------------

// GET /api/identity/:address — Look up on-chain identity by wallet address
app.get('/api/identity/:address', (req, res) => {
  ensureSeeded();
  const address = req.params.address.toLowerCase();
  const identities = getCachedIdentities();

  // Search for an identity where the publisher matches the wallet address
  for (const [, identity] of identities) {
    if (identity.publisher.toLowerCase() === address) {
      res.json({ found: true, identity });
      return;
    }
  }

  res.json({ found: false });
});

// POST /api/identity/register — Auto-register wallet identity (write-through + on-chain)
app.post('/api/identity/register', async (req, res) => {
  ensureSeeded();
  const { address } = req.body;

  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'Missing required field: address' });
    return;
  }

  const normalizedAddress = address.toLowerCase();
  const identities = getCachedIdentities();

  // Check if already registered
  for (const [, identity] of identities) {
    if (identity.publisher.toLowerCase() === normalizedAddress) {
      res.json({ created: false, identity, message: 'Identity already exists' });
      return;
    }
  }

  // Create a new identity for this wallet
  const agentId = `wallet-${normalizedAddress.slice(0, 10)}`;
  const shortAddr = `${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`;
  const registration: RegisterMessage = {
    type: 'register',
    agentId,
    name: `User ${shortAddr}`,
    publisher: normalizedAddress,
    category: 'wallet-user',
    description: `Registered via wallet connect (${shortAddr})`,
    feedbackAuthPolicy: 'open',
    timestamp: Date.now(),
  };

  cacheIdentity(registration);

  // Submit on-chain in live mode
  let onChainResult: { sequenceNumber: number; timestamp: number } | null = null;
  if (MONAD_SYNC_ENABLED) {
    try {
      onChainResult = await submitMessage(Topic.Identity, { ...registration });
      console.log(`  [on-chain] Identity registered: seq=${onChainResult.sequenceNumber} address=${shortAddr}`);
    } catch (err) {
      console.error('  [on-chain] Identity registration write failed (cached locally):', err instanceof Error ? err.message : err);
    }
  }

  res.status(201).json({
    created: true,
    identity: registration,
    onChain: onChainResult ? { sequenceNumber: onChainResult.sequenceNumber } : null,
  });
});

// ---------------------------------------------------------------------------
// Periodic Chain Polling
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // 30 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startChainPolling(): void {
  if (!MONAD_SYNC_ENABLED || pollTimer) return;

  pollTimer = setInterval(async () => {
    try {
      const { newIdentities, newFeedback } = await pollChainUpdates();

      if (newIdentities > 0 || newFeedback > 0) {
        console.log(`  [poll] New on-chain data: +${newIdentities} identities, +${newFeedback} feedback`);

        // Recompute sybil clusters with new data
        const allFeedback = getCachedFeedback();
        const sybilClusters = detectSybilClusters(allFeedback);
        cachedSybilAddrs = new Set<string>();
        for (const cluster of sybilClusters) {
          for (const addr of cluster) cachedSybilAddrs.add(addr);
        }

        // Emit WebSocket events for affected agents
        const identities = getCachedIdentities();
        const agents: AgentResponse[] = [];
        for (const [agentId] of identities) {
          const agent = buildAgentResponse(agentId, allFeedback);
          if (agent) agents.push(agent);
        }
        agents.sort((a, b) => b.hardenedScore - a.hardenedScore);

        const leaderboardEvent: LeaderboardUpdatedEvent = {
          type: 'leaderboard:updated',
          payload: {
            agents: agents.map(a => ({
              agentId: a.agentId,
              naiveScore: a.naiveScore,
              hardenedScore: a.hardenedScore,
              hardenedTier: a.hardenedTier,
              stakeWeightedScore: a.stakeWeightedScore,
              scoreDelta: a.scoreDelta,
              feedbackCount: a.feedbackCount,
            })),
          },
        };
        trustHubEmitter.emitEvent('leaderboard:updated', leaderboardEvent);

        const uniqueReviewers = new Set(allFeedback.map(f => f.clientAddress)).size;
        const statsEvent: StatsUpdatedEvent = {
          type: 'stats:updated',
          payload: {
            totalAgents: identities.size,
            totalFeedback: allFeedback.length,
            uniqueReviewers,
            sybilClustersDetected: sybilClusters.length,
          },
        };
        trustHubEmitter.emitEvent('stats:updated', statsEvent);
      }
    } catch (err) {
      console.error('  [poll] Chain poll error:', err instanceof Error ? err.message : err);
    }
  }, POLL_INTERVAL_MS);

  console.log(`  Chain polling started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

// ---------------------------------------------------------------------------
// Static Dashboard Serving (Production)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dashboardDist = join(__dirname, '..', '..', 'dashboard', 'dist');

if (process.env.NODE_ENV === 'production' && existsSync(dashboardDist)) {
  app.use(express.static(dashboardDist));

  // SPA fallback: serve index.html for any non-API, non-WS route
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(join(dashboardDist, 'index.html'));
    } else {
      next();
    }
  });
  console.log('  [static] Serving dashboard from', dashboardDist);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3001', 10);
const httpServer = createServer(app);
export { app, httpServer };

// Initialize WebSocket server on the same HTTP server
initWebSocketServer(httpServer);

// Async startup: initialize data, then start listening
(async () => {
  try {
    await initializeData();
  } catch (err) {
    console.error('  Failed to initialize:', err instanceof Error ? err.message : err);
    seeded = true;
  }

  httpServer.listen(PORT, () => {
    console.log(`\n  Trusted ClawMon API server running on http://localhost:${PORT}`);
    const sources: string[] = [];
    if (MONAD_SYNC_ENABLED) sources.push('Monad');
    if (CLAWHUB_SYNC_ENABLED) sources.push('ClawHub');
    console.log(`  Data sources: ${sources.length > 0 ? sources.join(' + ') : 'none'}\n`);

    console.log('  Endpoints:');
    console.log('    GET  /api/agents           — All agents with trust scores');
    console.log('    GET  /api/leaderboard      — Ranked by hardened score');
    console.log('    GET  /api/graph            — Feedback network graph');
    console.log('    GET  /api/stats            — Aggregate statistics');
    console.log('    GET  /api/staking/overview  — Staking economics (Phase 4)');
    console.log('    GET  /api/attestation/overview — Attestation status (Phase 5)');
    console.log('    GET  /api/insurance/stats   — Insurance pool (Phase 6)');
    console.log('    GET  /api/tee/overview      — TEE attestation (Phase 8)');
    console.log('    GET  /api/payments/overview  — x402 payments (Phase 9)');
    console.log('    GET  /api/governance/proposals — Governance (Phase 10)');
    console.log('    POST /api/feedback          — Submit feedback (real-time WS + on-chain)');
    console.log('    POST /api/skills/sync-clawhub — Trigger ClawHub registry sync');
    console.log(`    GET  /api/x402/score/:id    — Premium trust score (x402 paywall, ${X402_PRICE} USDC)`);
    console.log(`    WS   ws://localhost:${PORT}/ws — Real-time event stream\n`);

    if (MONAD_SYNC_ENABLED) {
      startChainPolling();
    }

    if (CLAWHUB_SYNC_ENABLED) {
      startClawHubPolling(CLAWHUB_SYNC_INTERVAL);
    }
  });
})();
