/**
 * Trusted ClawMon — Live Registry Seed Script
 *
 * Fetches real attestation data from the deployed AttestationRegistry
 * contract and identity/feedback data from the MessageLog contract on
 * Monad testnet, then seeds the local caches for the scoring engine.
 *
 * Data flow:
 *   1. Read identity registrations from the MessageLog (Topic.Identity)
 *   2. Read feedback submissions from the MessageLog (Topic.Feedback)
 *   3. Read attested agents from the AttestationRegistry (enumeration)
 *   4. Parse AttestationPublished events for historical context
 *   5. Reverse-map agent hashes → human-readable names
 *   6. Seed local caches with real on-chain data
 *   7. For registry-only agents (no MessageLog data), synthesize feedback
 *      that matches the attested score
 *
 * Run:
 *   npm run seed:live                  Full pull from both contracts
 *   npm run seed:live -- --registry    Registry-only (skip MessageLog)
 *   npm run seed:live -- --dry-run     Show what would be loaded (no cache writes)
 *   npm run seed:live -- --events      Also parse AttestationPublished events
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { getProvider } from '../src/monad/client.js';
import { closeClient } from '../src/monad/client.js';
import { readMessages, Topic, isConfigured as isMessageLogConfigured } from '../src/monad/message-log.js';
import {
  cacheFeedback,
  cacheIdentity,
  getCachedFeedback,
  getCachedIdentities,
  clearCaches,
} from '../src/scoring/reader.js';
import { computeAllSummaries, rankAgents } from '../src/scoring/engine.js';
import { computeAllHardenedSummaries } from '../src/scoring/hardened.js';
import { DEFAULT_MITIGATION_CONFIG } from '../src/mitigations/types.js';
import type { Feedback, RegisterMessage } from '../src/scoring/types.js';
import { UINT8_TO_TIER, TIER_TO_UINT8 } from '../src/attestation/types.js';
import type { AttestationRecord } from '../src/attestation/types.js';
import type { TrustTier } from '../src/scoring/types.js';
import { scoreToTier } from '../src/scoring/types.js';

// ---------------------------------------------------------------------------
// ABI for AttestationRegistry reads + events
// ---------------------------------------------------------------------------

const ATTESTATION_REGISTRY_ABI = [
  'function getAttestedAgentCount() view returns (uint256)',
  'function getAttestedAgent(uint256 index) view returns (bytes32)',
  'function getAttestation(bytes32 agentId) view returns (uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, uint64 attestedAt, string sourceChain, bool revoked, bool isFresh)',
  'function attestationCount(bytes32 agentId) view returns (uint256)',
  'function totalAttestations() view returns (uint256)',
  'function isAttested(bytes32 agentId) view returns (bool)',
  'event AttestationPublished(bytes32 indexed agentId, uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, string sourceChain)',
  'event AttestationRevoked(bytes32 indexed agentId, string reason)',
  'event BatchAttestationPublished(uint256 count)',
];

// ---------------------------------------------------------------------------
// CLI Flags
// ---------------------------------------------------------------------------

const flags = {
  registryOnly: process.argv.includes('--registry'),
  dryRun: process.argv.includes('--dry-run'),
  parseEvents: process.argv.includes('--events'),
};

// ---------------------------------------------------------------------------
// Known Agent Catalog (for reverse hash mapping)
// ---------------------------------------------------------------------------

/**
 * Known agent names from the ecosystem. Used to reverse-map bytes32
 * keccak hashes back to human-readable identifiers.
 *
 * This list is extended at runtime with names found in the MessageLog.
 */
const KNOWN_AGENT_NAMES: string[] = [
  // Legitimate skills
  'gmail-integration', 'github-token', 'deep-research-agent',
  'postgres-connector', 'slack-bridge', 'aws-toolkit',
  'stripe-payments', 'notion-sync', 'jira-agent', 'docker-compose',
  'mongodb-ops', 'figma-design', 'linear-tracker', 'vercel-deploy',
  'redis-cache', 'sentry-monitor', 'twilio-sms', 'openai-assistant',
  'anthropic-claude', 'google-calendar', 'datadog-metrics',
  'pagerduty-alert', 'cloudflare-dns', 'terraform-plan', 'kubernetes-ctl',
  // Cold-start skills
  'my-first-skill', 'experimental-nlp', 'budget-tracker-v1',
  'recipe-finder', 'weather-simple',
  // Flagged skills
  'what-would-elon-do', 'moltyverse-email', 'youtube-data',
  'buy-anything', 'prediction-markets-roarin', 'prompt-log',
  'free-gpt-unlimited', 'crypto-wallet-helper', 'discord-nitro-gen',
  'ai-code-reviewer',
  // Sybil ring
  'sybil-1', 'sybil-2', 'sybil-3', 'sybil-4', 'sybil-5',
  // Additional legitimate
  'elasticsearch-query', 'grafana-dashboard', 'github-actions-run',
  'snowflake-sql', 'confluence-wiki',
];

// ---------------------------------------------------------------------------
// Hash ↔ Name Mapping
// ---------------------------------------------------------------------------

/** Forward map: agentName → bytes32 keccak hash */
const nameToHash = new Map<string, string>();
/** Reverse map: bytes32 keccak hash → agentName */
const hashToName = new Map<string, string>();

function buildHashMaps(names: string[]): void {
  for (const name of names) {
    const hash = ethers.id(name);
    nameToHash.set(name, hash);
    hashToName.set(hash, name);
  }
}

function resolveAgentName(hash: string): string {
  return hashToName.get(hash) ?? `unknown-${hash.slice(0, 10)}`;
}

// ---------------------------------------------------------------------------
// On-Chain Attestation Record (parsed)
// ---------------------------------------------------------------------------

interface OnChainAgent {
  hash: string;
  name: string;
  score: number;
  tier: TrustTier;
  tierNum: number;
  feedbackCount: number;
  sourceTimestamp: number;
  attestedAt: number;
  sourceChain: string;
  revoked: boolean;
  isFresh: boolean;
  attestationCount: number;
  resolvedFromKnown: boolean;
}

// ---------------------------------------------------------------------------
// Step 1: Read Identities from MessageLog
// ---------------------------------------------------------------------------

async function fetchMessageLogIdentities(): Promise<Map<string, RegisterMessage>> {
  if (flags.registryOnly || !isMessageLogConfigured()) {
    console.log('  Skipping MessageLog identities (--registry or not configured)');
    return new Map();
  }

  console.log('  Reading identity registrations from MessageLog...');
  const messages = await readMessages<RegisterMessage>(Topic.Identity);
  const identities = new Map<string, RegisterMessage>();

  for (const msg of messages) {
    if (msg.payload.type === 'register') {
      identities.set(msg.payload.agentId, {
        ...msg.payload,
        timestamp: msg.payload.timestamp ?? msg.timestamp,
      });
      // Also add to hash maps for reverse lookup
      const hash = ethers.id(msg.payload.agentId);
      nameToHash.set(msg.payload.agentId, hash);
      hashToName.set(hash, msg.payload.agentId);
    }
  }

  console.log(`  Found ${identities.size} identity registrations`);
  return identities;
}

// ---------------------------------------------------------------------------
// Step 2: Read Feedback from MessageLog
// ---------------------------------------------------------------------------

interface RawFeedbackMsg {
  type: string;
  agentId: string;
  clientAddress: string;
  value: number;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  timestamp?: number;
}

async function fetchMessageLogFeedback(): Promise<Feedback[]> {
  if (flags.registryOnly || !isMessageLogConfigured()) {
    console.log('  Skipping MessageLog feedback (--registry or not configured)');
    return [];
  }

  console.log('  Reading feedback submissions from MessageLog...');
  const messages = await readMessages<RawFeedbackMsg & Record<string, unknown>>(Topic.Feedback);
  const feedback: Feedback[] = [];

  for (const msg of messages) {
    if (msg.payload.type === 'feedback') {
      const fb = msg.payload;
      feedback.push({
        id: `ml-fb-${msg.sequenceNumber}`,
        agentId: fb.agentId,
        clientAddress: fb.clientAddress,
        value: fb.value,
        valueDecimals: fb.valueDecimals ?? 0,
        tag1: fb.tag1,
        tag2: fb.tag2,
        endpoint: fb.endpoint,
        timestamp: fb.timestamp ?? msg.timestamp,
        sequenceNumber: msg.sequenceNumber,
        revoked: false,
      });
    }
  }

  console.log(`  Found ${feedback.length} feedback entries`);
  return feedback;
}

// ---------------------------------------------------------------------------
// Step 3: Read Attestations from Registry Contract
// ---------------------------------------------------------------------------

async function fetchRegistryAttestations(): Promise<OnChainAgent[]> {
  const contractAddress = process.env.ATTESTATION_CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.log('  No ATTESTATION_CONTRACT_ADDRESS configured — skipping registry');
    return [];
  }

  const provider = getProvider();
  const contract = new ethers.Contract(
    contractAddress,
    ATTESTATION_REGISTRY_ABI,
    provider,
  );

  console.log(`  Reading from AttestationRegistry at ${contractAddress}...`);

  // Get total counts
  const [agentCount, totalAttestations] = await Promise.all([
    contract.getAttestedAgentCount(),
    contract.totalAttestations(),
  ]);

  const count = Number(agentCount);
  const total = Number(totalAttestations);
  console.log(`  Found ${count} attested agents, ${total} total attestations`);

  if (count === 0) return [];

  // Enumerate all agents
  const agents: OnChainAgent[] = [];
  const batchSize = 20;

  for (let i = 0; i < count; i += batchSize) {
    const end = Math.min(i + batchSize, count);
    const batchPromises: Promise<void>[] = [];

    for (let j = i; j < end; j++) {
      batchPromises.push(
        (async () => {
          const hash = await contract.getAttestedAgent(j);
          const hashStr = hash as string;

          const [attestation, attCount] = await Promise.all([
            contract.getAttestation(hashStr),
            contract.attestationCount(hashStr),
          ]);

          const attestedAtNum = Number(attestation.attestedAt);
          if (attestedAtNum === 0) return; // No attestation

          const name = resolveAgentName(hashStr);
          const tierNum = Number(attestation.tier);

          agents.push({
            hash: hashStr,
            name,
            score: Number(attestation.score),
            tier: UINT8_TO_TIER[tierNum] ?? 'C',
            tierNum,
            feedbackCount: Number(attestation.feedbackCount),
            sourceTimestamp: Number(attestation.sourceTimestamp),
            attestedAt: attestedAtNum,
            sourceChain: attestation.sourceChain,
            revoked: attestation.revoked,
            isFresh: attestation.isFresh,
            attestationCount: Number(attCount),
            resolvedFromKnown: hashToName.has(hashStr),
          });
        })(),
      );
    }

    await Promise.all(batchPromises);

    if (end % 20 === 0 || end === count) {
      console.log(`  ${end}/${count} agents read`);
    }
  }

  // Sort by score descending
  agents.sort((a, b) => b.score - a.score);
  return agents;
}

// ---------------------------------------------------------------------------
// Step 4: Parse AttestationPublished Events (optional)
// ---------------------------------------------------------------------------

interface AttestationEvent {
  agentIdHash: string;
  agentName: string;
  score: number;
  tier: TrustTier;
  tierNum: number;
  feedbackCount: number;
  sourceTimestamp: number;
  sourceChain: string;
  blockNumber: number;
  txHash: string;
}

async function fetchAttestationEvents(): Promise<AttestationEvent[]> {
  if (!flags.parseEvents) return [];

  const contractAddress = process.env.ATTESTATION_CONTRACT_ADDRESS;
  if (!contractAddress) return [];

  const provider = getProvider();
  const contract = new ethers.Contract(
    contractAddress,
    ATTESTATION_REGISTRY_ABI,
    provider,
  );

  console.log('  Parsing AttestationPublished events...');

  // Query from genesis (or a reasonable start block)
  // Use a wide range — Monad testnet blocks are fast
  const currentBlock = await provider.getBlockNumber();
  const startBlock = Math.max(0, currentBlock - 500_000);

  const events: AttestationEvent[] = [];

  // Paginate event queries to avoid RPC limits
  const chunkSize = 10_000;
  for (let from = startBlock; from <= currentBlock; from += chunkSize) {
    const to = Math.min(from + chunkSize - 1, currentBlock);

    try {
      const filter = contract.filters.AttestationPublished();
      const logs = await contract.queryFilter(filter, from, to);

      for (const log of logs) {
        if (!('args' in log)) continue;
        const args = (log as ethers.EventLog).args;
        const hash = args.agentId as string;
        const tierNum = Number(args.tier);

        events.push({
          agentIdHash: hash,
          agentName: resolveAgentName(hash),
          score: Number(args.score),
          tier: UINT8_TO_TIER[tierNum] ?? 'C',
          tierNum,
          feedbackCount: Number(args.feedbackCount),
          sourceTimestamp: Number(args.sourceTimestamp),
          sourceChain: args.sourceChain,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
        });
      }
    } catch {
      // Some RPC providers limit event range; skip silently
    }
  }

  console.log(`  Found ${events.length} AttestationPublished events`);
  return events;
}

// ---------------------------------------------------------------------------
// Step 5: Synthesize Feedback for Registry-Only Agents
// ---------------------------------------------------------------------------

/**
 * For agents that exist in the AttestationRegistry but have no MessageLog
 * feedback, generate synthetic feedback entries that produce a score
 * matching the on-chain attestation.
 *
 * This lets the scoring engine operate on the same data the registry reflects.
 */
function synthesizeFeedback(
  agent: OnChainAgent,
  existingFeedbackCount: number,
): Feedback[] {
  if (existingFeedbackCount > 0) return [];

  const feedback: Feedback[] = [];
  const count = Math.max(agent.feedbackCount, 5);
  const targetScore = agent.score;

  // Generate feedback entries whose average ≈ targetScore
  // Add slight variance for realism
  for (let i = 0; i < count; i++) {
    const variance = randomInRange(-5, 5);
    const value = Math.max(0, Math.min(100, targetScore + variance));
    const timeOffset = i * randomInRange(60_000, 600_000);

    feedback.push({
      id: `synth-${agent.name}-${i}`,
      agentId: agent.name,
      clientAddress: `registry-reviewer-${String(randomInRange(0, 200)).padStart(4, '0')}`,
      value,
      valueDecimals: 0,
      tag1: 'registry-synth',
      timestamp: (agent.sourceTimestamp * 1000) - (count - i) * randomInRange(300_000, 3_600_000),
      revoked: false,
    });
  }

  return feedback;
}

// ---------------------------------------------------------------------------
// Step 6: Seed Local Caches
// ---------------------------------------------------------------------------

function seedCaches(
  identities: Map<string, RegisterMessage>,
  feedback: Feedback[],
  registryAgents: OnChainAgent[],
): { totalIdentities: number; totalFeedback: number; synthesized: number } {
  if (flags.dryRun) {
    return {
      totalIdentities: identities.size + registryAgents.filter(a => !identities.has(a.name)).length,
      totalFeedback: feedback.length,
      synthesized: 0,
    };
  }

  clearCaches();

  // Cache MessageLog identities
  for (const [, identity] of identities) {
    cacheIdentity(identity);
  }

  // Cache MessageLog feedback
  for (const fb of feedback) {
    cacheFeedback(fb);
  }

  // Build set of agents that already have feedback
  const agentsWithFeedback = new Set(feedback.map(f => f.agentId));

  // Process registry agents
  let synthesizedCount = 0;
  for (const agent of registryAgents) {
    // Create identity registration if not already from MessageLog
    if (!identities.has(agent.name)) {
      cacheIdentity({
        type: 'register',
        agentId: agent.name,
        name: agent.name,
        publisher: `registry-publisher`,
        category: 'unknown',
        description: `Attested agent from registry (score: ${agent.score}, tier: ${agent.tier})`,
        feedbackAuthPolicy: 'open',
        timestamp: agent.attestedAt * 1000,
      });
    }

    // Synthesize feedback for agents without MessageLog data
    const existingCount = feedback.filter(f => f.agentId === agent.name).length;
    const synthFb = synthesizeFeedback(agent, existingCount);
    for (const fb of synthFb) {
      cacheFeedback(fb);
    }
    synthesizedCount += synthFb.length;
  }

  const allIdentities = getCachedIdentities();
  const allFeedback = getCachedFeedback();

  return {
    totalIdentities: allIdentities.size,
    totalFeedback: allFeedback.length,
    synthesized: synthesizedCount,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(
  identities: Map<string, RegisterMessage>,
  feedback: Feedback[],
  registryAgents: OnChainAgent[],
  events: AttestationEvent[],
  seedResult: { totalIdentities: number; totalFeedback: number; synthesized: number },
): void {
  console.log('\n' + '═'.repeat(74));
  console.log('  LIVE REGISTRY DATA REPORT');
  console.log('═'.repeat(74));

  // --- Data Source Summary ---
  console.log('\n  Data Sources:');
  console.log(`    MessageLog identities:     ${identities.size}`);
  console.log(`    MessageLog feedback:        ${feedback.length}`);
  console.log(`    Registry attested agents:   ${registryAgents.length}`);
  if (events.length > 0) {
    console.log(`    Attestation events parsed:  ${events.length}`);
  }

  // --- Registry Agents Table ---
  if (registryAgents.length > 0) {
    console.log('\n  On-Chain Attestations:\n');
    console.log(
      '  ' +
        '#'.padEnd(5) +
        'Agent'.padEnd(28) +
        'Score'.padEnd(8) +
        'Tier'.padEnd(6) +
        'Reviews'.padEnd(9) +
        'Fresh'.padEnd(7) +
        'Revoked'.padEnd(9) +
        'Source',
    );
    console.log('  ' + '─'.repeat(80));

    for (let i = 0; i < registryAgents.length; i++) {
      const a = registryAgents[i];
      const nameDisplay = a.resolvedFromKnown ? a.name : `${a.name} (?)`;

      console.log(
        '  ' +
          `${i + 1}`.padEnd(5) +
          nameDisplay.slice(0, 26).padEnd(28) +
          String(a.score).padEnd(8) +
          a.tier.padEnd(6) +
          String(a.feedbackCount).padEnd(9) +
          (a.isFresh ? 'yes' : 'no').padEnd(7) +
          (a.revoked ? 'YES' : 'no').padEnd(9) +
          a.sourceChain,
      );
    }
  }

  // --- Hash Resolution Stats ---
  const resolved = registryAgents.filter(a => a.resolvedFromKnown).length;
  const unresolved = registryAgents.filter(a => !a.resolvedFromKnown).length;
  if (registryAgents.length > 0) {
    console.log(`\n  Hash Resolution: ${resolved} resolved, ${unresolved} unresolved`);
    if (unresolved > 0) {
      console.log('  Unresolved agents (hash prefix only):');
      for (const a of registryAgents.filter(a => !a.resolvedFromKnown)) {
        console.log(`    ${a.hash.slice(0, 18)}... → score ${a.score} (${a.tier})`);
      }
    }
  }

  // --- Event History ---
  if (events.length > 0) {
    console.log('\n  Attestation Event History (most recent 10):\n');
    const recent = events.slice(-10);
    for (const e of recent) {
      const name = e.agentName.length > 24 ? e.agentName.slice(0, 22) + '..' : e.agentName;
      console.log(
        `    block ${String(e.blockNumber).padEnd(10)} ${name.padEnd(26)} score=${String(e.score).padEnd(4)} tier=${e.tier.padEnd(4)} tx=${e.txHash.slice(0, 14)}...`,
      );
    }
  }

  // --- Scoring Comparison (if we have cached data) ---
  if (!flags.dryRun && seedResult.totalFeedback > 0) {
    const allFeedback = getCachedFeedback();
    const naiveSummaries = computeAllSummaries(allFeedback);
    const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);

    console.log('\n  Scoring Engine Results (from live data):\n');
    console.log(
      '  ' +
        'Agent'.padEnd(28) +
        'On-Chain'.padEnd(10) +
        'Naive'.padEnd(10) +
        'Hardened'.padEnd(10) +
        'Delta'.padEnd(8) +
        'Match?',
    );
    console.log('  ' + '─'.repeat(74));

    const ranked = rankAgents(allFeedback);
    for (let i = 0; i < Math.min(20, ranked.length); i++) {
      const naive = ranked[i];
      const hardened = hardenedSummaries.get(naive.agentId);
      const registry = registryAgents.find(a => a.name === naive.agentId);
      const onChainScore = registry?.score ?? '-';
      const hardenedScore = hardened?.summaryValue ?? 0;
      const delta = registry ? hardenedScore - registry.score : 0;
      const match = registry
        ? Math.abs(delta) < 5 ? 'yes' : `off by ${Math.abs(delta).toFixed(0)}`
        : 'n/a';

      console.log(
        '  ' +
          naive.agentId.slice(0, 26).padEnd(28) +
          String(onChainScore).padEnd(10) +
          naive.summaryValue.toFixed(1).padEnd(10) +
          hardenedScore.toFixed(1).padEnd(10) +
          (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)).padEnd(8) +
          match,
      );
    }
  }

  // --- Final Summary ---
  console.log('\n' + '═'.repeat(74));
  console.log(`  Seeded: ${seedResult.totalIdentities} agents, ${seedResult.totalFeedback} feedback entries`);
  if (seedResult.synthesized > 0) {
    console.log(`  (${seedResult.synthesized} feedback entries synthesized from registry scores)`);
  }
  if (flags.dryRun) {
    console.log('  (DRY RUN — no caches were written)');
  }
  console.log('═'.repeat(74));
}

// ---------------------------------------------------------------------------
// Tier Distribution Summary
// ---------------------------------------------------------------------------

function printTierDistribution(agents: OnChainAgent[]): void {
  if (agents.length === 0) return;

  const dist: Record<string, number> = {};
  let activeCount = 0;
  let staleCount = 0;
  let revokedCount = 0;

  for (const a of agents) {
    dist[a.tier] = (dist[a.tier] || 0) + 1;
    if (a.revoked) revokedCount++;
    else if (a.isFresh) activeCount++;
    else staleCount++;
  }

  console.log('\n  Tier Distribution:');
  const tiers: TrustTier[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'CC', 'C'];
  for (const tier of tiers) {
    const count = dist[tier] || 0;
    if (count > 0) {
      const bar = '#'.repeat(Math.min(count * 2, 40));
      console.log(`    ${tier.padEnd(4)} ${bar} (${count})`);
    }
  }

  console.log(`\n  Status: ${activeCount} active, ${staleCount} stale, ${revokedCount} revoked`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Trusted ClawMon — Live Registry Data Seed       ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log();

  if (flags.dryRun) console.log('  [DRY RUN MODE — no caches will be written]\n');
  if (flags.registryOnly) console.log('  [REGISTRY ONLY — skipping MessageLog]\n');
  if (flags.parseEvents) console.log('  [EVENTS — parsing on-chain events]\n');

  // Verify connectivity
  const provider = getProvider();
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`  Connected to Monad (block #${blockNumber})\n`);
  } catch (err) {
    console.error('  Failed to connect to Monad RPC. Check MONAD_RPC_URL in .env');
    console.error('  Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Build initial hash maps from known catalog
  buildHashMaps(KNOWN_AGENT_NAMES);
  console.log(`  Loaded ${KNOWN_AGENT_NAMES.length} known agent names for hash resolution\n`);

  // Step 1: Fetch MessageLog identities (enriches hash maps)
  console.log('Step 1/4 — MessageLog Identities');
  const identities = await fetchMessageLogIdentities();

  // Step 2: Fetch MessageLog feedback
  console.log('\nStep 2/4 — MessageLog Feedback');
  const feedback = await fetchMessageLogFeedback();

  // Step 3: Fetch registry attestations
  console.log('\nStep 3/4 — AttestationRegistry');
  const registryAgents = await fetchRegistryAttestations();

  // Step 4: Parse events (optional)
  console.log('\nStep 4/4 — Event History');
  const events = await fetchAttestationEvents();
  if (!flags.parseEvents) {
    console.log('  Skipped (use --events to enable)');
  }

  // Tier distribution
  printTierDistribution(registryAgents);

  // Seed caches
  console.log('\n  Seeding local caches...');
  const seedResult = seedCaches(identities, feedback, registryAgents);

  // Print report
  printReport(identities, feedback, registryAgents, events, seedResult);
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    closeClient();
  });
