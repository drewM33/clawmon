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
 *   WS   /ws                  — WebSocket stream for live dashboard updates
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { scoreToTier, CREDIBILITY_WEIGHTS } from './scoring/types.js';
import type { Feedback, RegisterMessage, TrustTier, CredibilityTier } from './scoring/types.js';
import { computeUsageWeightedSummary, annotateFeedbackCredibility } from './scoring/usage-weighted.js';
import type { UsageTierBreakdown } from './scoring/usage-weighted.js';
import { generateSimulatedAddress } from './monad/accounts.js';
import { isConfigured as isMessageLogConfigured, submitMessage, Topic } from './monad/message-log.js';
import { readIdentities, readFeedback } from './scoring/reader.js';
import { fetchAttestations, registerKnownNames } from './monad/attestation-reader.js';
import type { OnChainAgent } from './monad/attestation-reader.js';
import {
  seedSimulatedStakes,
  loadStakesFromChain,
  getAgentStaking,
  getStakingStats,
  getSimulatedStake,
  getSimulatedSlashHistory,
  getAllSimulatedStakes,
  getAllSimulatedSlashHistory,
  readAllStakes,
} from './staking/contract.js';
import { computeStakeWeightedSummary } from './staking/stake-weighted.js';
import type { AgentStakeInfo, SlashRecord as StakeSlashRecord } from './staking/types.js';
import { StakeTier, STAKE_TIER_LABELS } from './staking/types.js';
import {
  seedSimulatedAttestations,
  getAttestationStatus,
  getAttestationStats,
  getSimulatedAttestation,
  getAllSimulatedAttestations,
  getSimulatedLastBridgeRun,
} from './attestation/bridge.js';
import type { AttestationStatus } from './attestation/types.js';
import {
  seedSimulatedInsurance,
  loadInsuranceFromChain,
  getInsuranceStats,
  getAllSimulatedClaims,
  getAgentInsurance,
  getSimulatedPoolState,
} from './staking/insurance.js';
import {
  seedSimulatedTEE,
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
  seedSimulatedPayments,
  loadPaymentsFromChain,
  getPaymentStats,
  getSkillPaymentProfile,
  getAllSkillPaymentProfiles,
  getPaymentActivity,
  getCallerReceiptsForSkill,
  checkPaymentAccess,
  computePaymentTrustSignal,
  computeStakingYield,
} from './payments/index.js';
import {
  seedGovernanceData,
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

// ---------------------------------------------------------------------------
// Mode Detection
// ---------------------------------------------------------------------------

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const LIVE_MODE = !DEMO_MODE && isMessageLogConfigured();

// ---------------------------------------------------------------------------
// Seed Data (inline — same logic as seed-phase1.ts but self-contained)
// ---------------------------------------------------------------------------

interface SkillSeed {
  name: string;
  publisher: string;
  category: string;
  description: string;
  flagged: boolean;
}

const SKILLS: SkillSeed[] = [
  { name: 'gmail-integration', publisher: 'google-labs', category: 'communication', description: 'Gmail read/write/search via MCP', flagged: false },
  { name: 'github-token', publisher: 'github', category: 'developer', description: 'GitHub API access and repo management', flagged: false },
  { name: 'deep-research-agent', publisher: 'openai-community', category: 'research', description: 'Multi-step research with source verification', flagged: false },
  { name: 'postgres-connector', publisher: 'supabase', category: 'database', description: 'PostgreSQL query and schema management', flagged: false },
  { name: 'slack-bridge', publisher: 'slack-eng', category: 'communication', description: 'Slack channel/message/thread operations', flagged: false },
  { name: 'aws-toolkit', publisher: 'aws-labs', category: 'cloud', description: 'AWS service management and deployment', flagged: false },
  { name: 'stripe-payments', publisher: 'stripe-dev', category: 'finance', description: 'Stripe payment processing integration', flagged: false },
  { name: 'notion-sync', publisher: 'notion-team', category: 'productivity', description: 'Notion page/database CRUD operations', flagged: false },
  { name: 'jira-agent', publisher: 'atlassian', category: 'project-management', description: 'JIRA issue tracking and sprint management', flagged: false },
  { name: 'docker-compose', publisher: 'docker-inc', category: 'devops', description: 'Docker container orchestration', flagged: false },
  { name: 'mongodb-ops', publisher: 'mongodb-team', category: 'database', description: 'MongoDB CRUD and aggregation pipelines', flagged: false },
  { name: 'figma-design', publisher: 'figma-labs', category: 'design', description: 'Figma file inspection and component export', flagged: false },
  { name: 'linear-tracker', publisher: 'linear-team', category: 'project-management', description: 'Linear issue creation and workflow', flagged: false },
  { name: 'vercel-deploy', publisher: 'vercel', category: 'devops', description: 'Vercel deployment and project management', flagged: false },
  { name: 'redis-cache', publisher: 'redis-labs', category: 'database', description: 'Redis key-value operations and pub/sub', flagged: false },
  { name: 'sentry-monitor', publisher: 'sentry-io', category: 'monitoring', description: 'Sentry error tracking and alerting', flagged: false },
  { name: 'twilio-sms', publisher: 'twilio-dev', category: 'communication', description: 'SMS and voice via Twilio API', flagged: false },
  { name: 'openai-assistant', publisher: 'openai', category: 'ai', description: 'OpenAI API wrapper with streaming', flagged: false },
  { name: 'anthropic-claude', publisher: 'anthropic', category: 'ai', description: 'Claude API integration for agents', flagged: false },
  { name: 'google-calendar', publisher: 'google-labs', category: 'productivity', description: 'Google Calendar event management', flagged: false },
  { name: 'datadog-metrics', publisher: 'datadog', category: 'monitoring', description: 'Datadog metric submission and dashboards', flagged: false },
  { name: 'pagerduty-alert', publisher: 'pagerduty', category: 'monitoring', description: 'PagerDuty incident creation and management', flagged: false },
  { name: 'cloudflare-dns', publisher: 'cloudflare', category: 'infrastructure', description: 'Cloudflare DNS and Worker management', flagged: false },
  { name: 'terraform-plan', publisher: 'hashicorp', category: 'infrastructure', description: 'Terraform plan/apply/state operations', flagged: false },
  { name: 'kubernetes-ctl', publisher: 'k8s-community', category: 'devops', description: 'Kubernetes cluster and workload management', flagged: false },
  { name: 'my-first-skill', publisher: 'newdev-2026', category: 'misc', description: 'A basic hello-world MCP skill', flagged: false },
  { name: 'experimental-nlp', publisher: 'student-project', category: 'ai', description: 'Experimental NLP pipeline', flagged: false },
  { name: 'budget-tracker-v1', publisher: 'indie-dev-42', category: 'finance', description: 'Personal budget tracking', flagged: false },
  { name: 'recipe-finder', publisher: 'hobby-coder', category: 'lifestyle', description: 'Recipe search and meal planning', flagged: false },
  { name: 'weather-simple', publisher: 'weekend-project', category: 'utility', description: 'Basic weather lookup', flagged: false },
  { name: 'what-would-elon-do', publisher: 'shadow-publisher', category: 'entertainment', description: 'AI personality simulation — MALWARE (Cisco flagged)', flagged: true },
  { name: 'moltyverse-email', publisher: 'moltyverse', category: 'communication', description: 'Email integration — LEAKS CREDENTIALS (Snyk)', flagged: true },
  { name: 'youtube-data', publisher: 'yt-scraper-anon', category: 'media', description: 'YouTube data extraction — LEAKS CREDENTIALS (Snyk)', flagged: true },
  { name: 'buy-anything', publisher: 'deal-finder-bot', category: 'shopping', description: 'Shopping assistant — SAVES CREDIT CARDS TO MEMORY (Snyk)', flagged: true },
  { name: 'prediction-markets-roarin', publisher: 'roarin-markets', category: 'finance', description: 'Prediction market agent — LEAKS API KEYS (Snyk)', flagged: true },
  { name: 'prompt-log', publisher: 'log-everything', category: 'developer', description: 'Prompt logging — SESSION EXFILTRATION (Snyk)', flagged: true },
  { name: 'free-gpt-unlimited', publisher: 'totally-legit-ai', category: 'ai', description: 'Free GPT access — PHISHING FRONT (Authmind)', flagged: true },
  { name: 'crypto-wallet-helper', publisher: 'anon-crypto-dev', category: 'finance', description: 'Wallet management — PRIVATE KEY THEFT (Authmind)', flagged: true },
  { name: 'discord-nitro-gen', publisher: 'nitro-free-2026', category: 'social', description: 'Discord Nitro generator — CREDENTIAL HARVESTER (Authmind)', flagged: true },
  { name: 'ai-code-reviewer', publisher: 'code-review-pro', category: 'developer', description: 'Code review agent — EXFILTRATES SOURCE CODE (Authmind)', flagged: true },
  { name: 'sybil-1', publisher: 'sybil-1', category: 'utility', description: 'Sybil test skill 1', flagged: false },
  { name: 'sybil-2', publisher: 'sybil-2', category: 'utility', description: 'Sybil test skill 2', flagged: false },
  { name: 'sybil-3', publisher: 'sybil-3', category: 'utility', description: 'Sybil test skill 3', flagged: false },
  { name: 'sybil-4', publisher: 'sybil-4', category: 'utility', description: 'Sybil test skill 4', flagged: false },
  { name: 'sybil-5', publisher: 'sybil-5', category: 'utility', description: 'Sybil test skill 5', flagged: false },
  { name: 'elasticsearch-query', publisher: 'elastic-co', category: 'search', description: 'Elasticsearch query and index management', flagged: false },
  { name: 'grafana-dashboard', publisher: 'grafana-labs', category: 'monitoring', description: 'Grafana dashboard creation and management', flagged: false },
  { name: 'github-actions-run', publisher: 'github', category: 'ci-cd', description: 'Trigger and monitor GitHub Actions workflows', flagged: false },
  { name: 'snowflake-sql', publisher: 'snowflake-dev', category: 'database', description: 'Snowflake SQL query execution', flagged: false },
  { name: 'confluence-wiki', publisher: 'atlassian', category: 'documentation', description: 'Confluence page creation and search', flagged: false },
];

const skillMap = new Map<string, SkillSeed>();
for (const s of SKILLS) skillMap.set(s.name, s);

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let feedbackIdCounter = 0;
function genFbId(): string {
  return `seed-fb-${++feedbackIdCounter}`;
}

function seedLocalData(): void {
  const baseTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < SKILLS.length; i++) {
    const skill = SKILLS[i];
    cacheIdentity({
      type: 'register',
      agentId: skill.name,
      name: skill.name,
      publisher: skill.publisher,
      category: skill.category,
      description: skill.description,
      feedbackAuthPolicy: 'open',
      timestamp: baseTimestamp + i * 1000,
    });
  }

  const allFeedback: Feedback[] = [];

  for (const skill of SKILLS) {
    if (skill.name.startsWith('sybil-')) continue;

    if (skill.flagged) {
      const count = randomInRange(15, 30);
      for (let i = 0; i < count; i++) {
        const isSybilPositive = i < count * 0.4;
        allFeedback.push({
          id: genFbId(),
          agentId: skill.name,
          clientAddress: isSybilPositive
            ? generateSimulatedAddress('sybil-reviewer', randomInRange(0, 10))
            : generateSimulatedAddress('community', randomInRange(0, 50)),
          value: isSybilPositive ? randomInRange(75, 95) : randomInRange(5, 25),
          valueDecimals: 0,
          tag1: skill.category,
          timestamp: baseTimestamp + i * randomInRange(30_000, 300_000),
          revoked: false,
        });
      }
    } else if (['my-first-skill', 'experimental-nlp', 'budget-tracker-v1', 'recipe-finder', 'weather-simple'].includes(skill.name)) {
      const count = randomInRange(0, 4);
      for (let i = 0; i < count; i++) {
        allFeedback.push({
          id: genFbId(),
          agentId: skill.name,
          clientAddress: generateSimulatedAddress('community', randomInRange(0, 50)),
          value: randomInRange(50, 80),
          valueDecimals: 0,
          tag1: skill.category,
          timestamp: baseTimestamp + i * randomInRange(60_000, 600_000),
          revoked: false,
        });
      }
    } else {
      const count = randomInRange(10, 50);
      for (let i = 0; i < count; i++) {
        allFeedback.push({
          id: genFbId(),
          agentId: skill.name,
          clientAddress: generateSimulatedAddress('community', randomInRange(0, 50)),
          value: randomInRange(70, 95),
          valueDecimals: 0,
          tag1: skill.category,
          timestamp: baseTimestamp + i * randomInRange(60_000, 600_000),
          revoked: false,
        });
      }
    }
  }

  // Sybil ring feedback
  const sybilSkills = SKILLS.filter(s => s.name.startsWith('sybil-'));
  const recentBase = Date.now() - 2 * 60 * 60 * 1000;
  for (const rater of sybilSkills) {
    for (const target of sybilSkills) {
      if (rater.name === target.name) continue;
      allFeedback.push({
        id: genFbId(),
        agentId: target.name,
        clientAddress: rater.publisher,
        value: randomInRange(85, 98),
        valueDecimals: 0,
        tag1: 'utility',
        timestamp: recentBase + randomInRange(0, 30_000),
        revoked: false,
      });
    }
  }
  for (const skill of sybilSkills) {
    allFeedback.push({
      id: genFbId(),
      agentId: skill.name,
      clientAddress: `${skill.publisher}-alt`,
      value: randomInRange(90, 99),
      valueDecimals: 0,
      tag1: 'utility',
      timestamp: recentBase + randomInRange(0, 30_000),
      revoked: false,
    });
  }

  for (const fb of allFeedback) cacheFeedback(fb);

  console.log(`Seeded ${SKILLS.length} skills, ${allFeedback.length} feedback entries`);
}

// ---------------------------------------------------------------------------
// Live Chain Sync
// ---------------------------------------------------------------------------

/**
 * Sync skills (identities) and feedback from the deployed MessageLog contract,
 * and optionally read attestation data from the AttestationRegistry.
 * Used in LIVE_MODE instead of seedLocalData().
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAgentResponse(agentId: string, allFeedback: Feedback[]): AgentResponse | null {
  const identity = getCachedIdentities().get(agentId);
  if (!identity) return null;
  const skill = skillMap.get(agentId);

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
    description: skill?.description ?? identity.description ?? '',
    flagged: skill?.flagged ?? false,
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
 * Seed the simulated phase data (staking, attestations, insurance, TEE,
 * payments, governance) for a given set of agent names. This is shared
 * between demo mode and live mode — live mode reads real identities/feedback
 * from the chain but still uses simulated phase 4-10 data.
 */
async function seedPhaseData(agentNames: string[]): Promise<void> {
  const allFeedback = getCachedFeedback();
  const identities = getCachedIdentities();

  // Pre-compute sybil clusters
  const sybilClusters = detectSybilClusters(allFeedback);
  cachedSybilAddrs = new Set<string>();
  for (const cluster of sybilClusters) {
    for (const addr of cluster) cachedSybilAddrs.add(addr);
  }

  // Phase 4: Staking
  seedSimulatedStakes(agentNames);
  console.log('Seeded simulated staking data for', agentNames.length, 'agents');

  // Phase 5: Attestations
  const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);
  const attestationSeeds = agentNames.map(name => {
    const summary = hardenedSummaries.get(name);
    const skill = skillMap.get(name);
    const identity = identities.get(name);
    return {
      agentId: name,
      score: summary?.summaryValue ?? 0,
      tier: summary?.tier ?? ('C' as const),
      feedbackCount: summary?.feedbackCount ?? 0,
      flagged: skill?.flagged ?? false,
      isSybil: cachedSybilAddrs.has(name),
    };
  });
  seedSimulatedAttestations(attestationSeeds);
  const attCount = getAllSimulatedAttestations().size;
  console.log('Seeded simulated attestation data for', attCount, 'agents');

  // Phase 6: Insurance
  const allSlashes = getAllSimulatedSlashHistory();
  seedSimulatedInsurance(allSlashes, agentNames);
  const poolState = getSimulatedPoolState();
  console.log('Seeded simulated insurance pool:', poolState.totalClaims, 'claims, pool balance', poolState.poolBalanceEth.toFixed(4), 'ETH');

  // Phase 8: TEE
  const allStakes = getAllSimulatedStakes();
  const teeSeeds = agentNames.map(name => {
    const summary = hardenedSummaries.get(name);
    const skill = skillMap.get(name);
    const identity = identities.get(name);
    const stake = allStakes.get(name);
    return {
      agentId: name,
      score: summary?.summaryValue ?? 0,
      tier: summary?.tier ?? ('C' as const),
      feedbackCount: summary?.feedbackCount ?? 0,
      flagged: skill?.flagged ?? false,
      isSybil: cachedSybilAddrs.has(name),
      category: skill?.category ?? identity?.category ?? 'general',
      isStaked: stake?.active ?? false,
    };
  });
  await seedSimulatedTEE(teeSeeds);
  const teeStats = computeTEEStats(agentNames);
  console.log('Seeded simulated TEE data:', teeStats.verifiedCount, 'verified,', teeStats.tier3ActiveCount, 'Tier 3 active');

  // Phase 9: Payments
  const paymentSeeds = agentNames.map(name => {
    const summary = hardenedSummaries.get(name);
    const skill = skillMap.get(name);
    const identity = identities.get(name);
    return {
      agentId: name,
      publisher: skill?.publisher ?? identity?.publisher ?? 'unknown',
      tier: summary?.tier ?? ('C' as const),
      feedbackCount: summary?.feedbackCount ?? 0,
      flagged: skill?.flagged ?? false,
      isSybil: cachedSybilAddrs.has(name),
      category: skill?.category ?? identity?.category ?? 'general',
    };
  });
  seedSimulatedPayments(paymentSeeds);
  const payStats = getPaymentStats(agentNames);
  console.log('Seeded simulated x402 payment data:', payStats.totalPayments, 'payments,', payStats.totalRevenueEth.toFixed(4), 'ETH revenue');

  // Phase 10: Governance
  seedGovernanceData();
  const govStats = getGovernanceStats();
  console.log('Seeded governance:', govStats.totalProposals, 'proposals,', govStats.totalParameters, 'parameters');

  // Build cached staked addresses set (for usage-weighted scoring)
  const allStakesForCache = getAllSimulatedStakes();
  cachedStakedAddrs = new Set<string>();
  for (const [, stake] of allStakesForCache) {
    if (stake.active) {
      cachedStakedAddrs.add(stake.publisher);
      cachedStakedAddrs.add(stake.agentId);
    }
  }
  console.log('Cached', cachedStakedAddrs.size, 'staked addresses for usage-weighted scoring');
}

/**
 * Load real phase 4-10 data from deployed contracts on Monad testnet.
 * Called in LIVE_MODE instead of seedPhaseData(). Reads staking, insurance,
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

  // Phase 6: Read insurance pool from InsurancePool contract
  await loadInsuranceFromChain(agentNames);

  // Phase 8: TEE — no contract deployed, show real (empty) state
  // Intentionally not seeding fake TEE data
  console.log('  [tee] No TEE contract — agents will show as unregistered');

  // Phase 9: Read payment data from SkillPaywall contract
  await loadPaymentsFromChain(agentNames);

  // Phase 10: Read governance from Governance contract
  await loadGovernanceFromChain();

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
 * LIVE_MODE: Reads real identities + feedback from the MessageLog contract
 *            and attestations from the AttestationRegistry, then reads
 *            real phase 4-10 data from deployed contracts.
 *
 * DEMO_MODE: Uses the hardcoded SKILLS array and randomly generated feedback.
 */
async function initializeData(): Promise<void> {
  if (LIVE_MODE) {
    console.log('\n  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║           TRUSTED CLAWBAR — LIVE MODE                    ║');
    console.log('  ║                                                          ║');
    console.log('  ║   Reading real data from Monad testnet contracts.        ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝\n');

    await syncFromChain();

    const agentNames = Array.from(getCachedIdentities().keys());
    if (agentNames.length > 0) {
      await initLivePhaseData(agentNames);
    } else {
      console.log('  No agents found on-chain. Dashboard will show empty state.');
      console.log('  Register skills and submit feedback via the dashboard to populate.');
    }
  } else {
    seedLocalData();
    const agentNames = SKILLS.map(s => s.name);
    await seedPhaseData(agentNames);
  }

  seeded = true;
}

/**
 * Guard for endpoints — ensures data is loaded before responding.
 * In LIVE_MODE, data is loaded at startup. In DEMO_MODE, loaded lazily.
 */
function ensureSeeded(): void {
  if (!seeded) {
    // Fallback for demo mode if somehow called before initializeData
    seedLocalData();
    const agentNames = SKILLS.map(s => s.name);

    const allFeedback = getCachedFeedback();
    const sybilClusters = detectSybilClusters(allFeedback);
    cachedSybilAddrs = new Set<string>();
    for (const cluster of sybilClusters) {
      for (const addr of cluster) cachedSybilAddrs.add(addr);
    }

    seedSimulatedStakes(agentNames);
    const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);
    const attestationSeeds = agentNames.map(name => {
      const summary = hardenedSummaries.get(name);
      const skill = skillMap.get(name);
      return {
        agentId: name,
        score: summary?.summaryValue ?? 0,
        tier: summary?.tier ?? ('C' as const),
        feedbackCount: summary?.feedbackCount ?? 0,
        flagged: skill?.flagged ?? false,
        isSybil: cachedSybilAddrs.has(name),
      };
    });
    seedSimulatedAttestations(attestationSeeds);
    seedGovernanceData();

    seeded = true;
  }
}

// GET /api/health — System health and mode check
app.get('/api/health', (_req, res) => {
  ensureSeeded();
  const identities = getCachedIdentities();
  const allFeedback = getCachedFeedback();
  res.json({
    status: 'ok',
    mode: LIVE_MODE ? 'live' : (DEMO_MODE ? 'demo' : 'local'),
    liveMode: LIVE_MODE,
    demoMode: DEMO_MODE,
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

  // Compute mitigation flags
  const mutualPairs = detectMutualFeedback(allFeedback);
  const mutualIds = new Set<string>();
  for (const pair of mutualPairs) {
    for (const id of pair.feedbackIds) mutualIds.add(id);
  }

  const velocityFlagged = detectVelocitySpikes(agentFb, 10, 60_000);
  const anomalyFlagged = detectNewSubmitterBurst(agentFb, allFeedback, 5, 60_000);

  let sybilMutual = 0;
  let velocityBurst = 0;
  let temporalDecay = 0;
  let newSubmitter = 0;
  let anomalyBurst = 0;

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

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();

  const naiveSummaries = computeAllSummaries(allFeedback);
  const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);

  // Add agent nodes
  for (const [agentId, identity] of identities) {
    const hardened = hardenedSummaries.get(agentId);
    const skill = skillMap.get(agentId);
    nodeMap.set(agentId, {
      id: agentId,
      type: 'agent',
      label: identity.name,
      tier: hardened?.tier,
      score: hardened?.summaryValue,
      isSybil: cachedSybilAddrs.has(agentId),
      isFlagged: skill?.flagged ?? false,
      feedbackCount: hardened?.feedbackCount,
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
        isSybil: cachedSybilAddrs.has(fb.clientAddress),
        isFlagged: false,
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
  };

  res.json(response);
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

  const flaggedCount = SKILLS.filter(s => s.flagged).length;
  const sybilCount = SKILLS.filter(s => s.name.startsWith('sybil-')).length;

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
    const agentNames = SKILLS.map(s => s.name);
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
app.get('/api/staking/overview', (_req, res) => {
  ensureSeeded();
  const stakes = getAllSimulatedStakes();
  const slashes = getAllSimulatedSlashHistory();

  const overview = Array.from(stakes.entries()).map(([agentId, stake]) => {
    const agentSlashes = slashes.filter(s => s.agentId === agentId);
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
    };
  });

  // Sort by totalStakeEth descending
  overview.sort((a, b) => b.totalStakeEth - a.totalStakeEth);
  res.json(overview);
});

// GET /api/staking/:id — Agent staking detail + slash history
app.get('/api/staking/:id', async (req, res) => {
  ensureSeeded();
  const agentId = req.params.id;

  try {
    const result = await getAgentStaking(agentId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staking data' });
  }
});

// ---------------------------------------------------------------------------
// Attestation Endpoints (Phase 5)
// ---------------------------------------------------------------------------

// GET /api/attestation/stats — Aggregate attestation statistics
app.get('/api/attestation/stats', async (_req, res) => {
  ensureSeeded();
  try {
    const agentNames = SKILLS.map(s => s.name);
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
    const agentNames = SKILLS.map(s => s.name);
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
  const agentNames = SKILLS.map(s => s.name);
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
    const skill = skillMap.get(agentId);
    const result = await generateAndSubmitAttestation(agentId, {
      flagged: skill?.flagged ?? false,
      isSybil: cachedSybilAddrs.has(agentId),
      category: skill?.category,
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
  const agentNames = SKILLS.map(s => s.name);
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

// POST /api/payments/pay — Process an x402 payment for a skill
app.post('/api/payments/pay', (req, res) => {
  ensureSeeded();
  const { agentId, caller } = req.body;

  if (!agentId || !caller) {
    res.status(400).json({ error: 'Missing required fields: agentId, caller' });
    return;
  }

  const identities = getCachedIdentities();
  if (!identities.has(agentId)) {
    res.status(404).json({ error: `Agent '${agentId}' not found` });
    return;
  }

  const result = checkPaymentAccess(agentId, caller);

  if (!result.accessGranted) {
    res.status(402).json({
      error: result.denyReason,
      effectivePriceEth: result.effectivePriceEth,
      trustTier: result.trustTier,
    });
    return;
  }

  // Emit payment event via WebSocket
  if (result.receipt) {
    const paymentEvent: PaymentProcessedEvent = {
      type: 'payment:processed',
      payload: {
        paymentId: result.receipt.paymentId,
        agentId: result.receipt.agentId,
        caller: result.receipt.caller,
        amount: result.receipt.amount,
        trustTier: result.receipt.trustTier,
        publisherPayout: result.receipt.publisherPayout,
        protocolPayout: result.receipt.protocolPayout,
        insurancePayout: result.receipt.insurancePayout,
        timestamp: result.receipt.timestamp,
      },
    };
    trustHubEmitter.emitEvent('payment:processed', paymentEvent);
  }

  res.status(200).json({
    accessGranted: result.accessGranted,
    isFree: result.isFree,
    effectivePriceEth: result.effectivePriceEth,
    trustTier: result.trustTier,
    receipt: result.receipt ?? null,
  });
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
app.post('/api/feedback', async (req, res) => {
  ensureSeeded();

  const { agentId, clientAddress, value, tag1 } = req.body;

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

  const now = Date.now();

  // Create and cache the feedback entry (write-through)
  const feedback: Feedback = {
    id: `live-fb-${++feedbackIdCounter}`,
    agentId,
    clientAddress,
    value: numValue,
    valueDecimals: 0,
    tag1: tag1 ?? identities.get(agentId)?.category ?? '',
    timestamp: now,
    revoked: false,
  };

  cacheFeedback(feedback);

  // Submit on-chain in live mode (fire-and-forget with error logging)
  let onChainResult: { sequenceNumber: number; timestamp: number } | null = null;
  if (LIVE_MODE) {
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
  });
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

  // Submit on-chain in live mode
  let onChainResult: { sequenceNumber: number; timestamp: number } | null = null;
  if (LIVE_MODE) {
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
  if (LIVE_MODE) {
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
// Periodic Chain Polling (LIVE_MODE only)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // 30 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startChainPolling(): void {
  if (!LIVE_MODE || pollTimer) return;

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
    console.error('  Failed to initialize data from chain:', err instanceof Error ? err.message : err);
    console.error('  Falling back to demo mode...');
    if (!seeded) {
      seedLocalData();
      const agentNames = SKILLS.map(s => s.name);
      await seedPhaseData(agentNames);
      seeded = true;
    }
  }

  httpServer.listen(PORT, () => {
    if (DEMO_MODE || !LIVE_MODE) {
      console.log();
      console.log('  ╔══════════════════════════════════════════════════════════╗');
      console.log('  ║           TRUSTED CLAWBAR — DEMO MODE                   ║');
      console.log('  ║                                                          ║');
      console.log('  ║   All data simulated in-memory. No external credentials  ║');
      console.log('  ║   required. 50 skills seeded with realistic feedback.    ║');
      console.log('  ║                                                          ║');
      console.log('  ║   Dashboard: http://localhost:5173                       ║');
      console.log('  ║   API:       http://localhost:' + String(PORT).padEnd(24) + '  ║');
      console.log('  ║   WebSocket: ws://localhost:' + (String(PORT) + '/ws').padEnd(26) + '║');
      console.log('  ╚══════════════════════════════════════════════════════════╝');
      console.log();
    } else {
      console.log(`\n  Trusted ClawMon API server running on http://localhost:${PORT}`);
      console.log(`  Mode: LIVE — Monad Testnet\n`);
    }
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
    console.log(`    WS   ws://localhost:${PORT}/ws — Real-time event stream\n`);

    // Start periodic chain polling in live mode
    if (LIVE_MODE) {
      startChainPolling();
    }
  });
})();
