/**
 * Trusted ClawMon — Phase 1 Seed Script
 *
 * Seeds realistic skill data and community feedback to the MessageLog
 * contract for testing the scoring engine. Can also run in local-only mode
 * (no Monad connection required) for fast iteration.
 *
 * Run: npm run seed
 * Run local: npm run seed -- --local
 * Run quick: npm run seed -- --quick       (10 skills, ~50 feedback — under 2 min)
 *            npm run seed -- --quick --local
 *
 * Seeds (full):
 *   - 50 skills from real ClawMon data (hardcoded subset)
 *   - Synthetic community feedback:
 *     - Legitimate skills: 10-50 positive reviews (score 70-95)
 *     - Flagged skills: mixed reviews (sybil positives + community negatives)
 *     - New skills: 0-5 reviews (cold-start)
 *   - Sybil ring: 5 fake publishers with mutual positive reviews (for testing)
 *
 * Seeds (--quick):
 *   - 10 representative skills (4 legit, 1 cold-start, 2 flagged, 3 sybil)
 *   - ~50 feedback entries with reduced per-skill counts
 */

import 'dotenv/config';
import { submitMessage, Topic } from '../src/monad/message-log.js';
import { closeClient } from '../src/monad/client.js';
import {
  cacheFeedback,
  cacheIdentity,
  getCachedFeedback,
  getCachedIdentities,
} from '../src/scoring/reader.js';
import { computeSummary, computeAllSummaries, rankAgents } from '../src/scoring/engine.js';
import { computeHardenedSummary, computeAllHardenedSummaries } from '../src/scoring/hardened.js';
import { DEFAULT_MITIGATION_CONFIG } from '../src/mitigations/types.js';
import type { Feedback, RegisterMessage } from '../src/scoring/types.js';
import { CREDIBILITY_WEIGHTS } from '../src/scoring/types.js';
import { generateSimulatedAddress } from '../src/monad/accounts.js';
import { computeUsageWeightedSummary, annotateFeedbackCredibility } from '../src/scoring/usage-weighted.js';
import type { UsageTierBreakdown } from '../src/scoring/usage-weighted.js';
import {
  registerSkillPricing,
  processSkillPayment,
  seedSimulatedPayments,
} from '../src/payments/x402.js';
import {
  seedSimulatedStakes,
  getAllSimulatedStakes,
} from '../src/staking/contract.js';

// ---------------------------------------------------------------------------
// Quick mode — 10 skills, ~50 feedback entries for fast test runs
// ---------------------------------------------------------------------------

let isQuick = false;

const QUICK_SKILL_NAMES = new Set([
  'gmail-integration',    // legitimate
  'github-token',         // legitimate
  'postgres-connector',   // legitimate
  'slack-bridge',         // legitimate
  'my-first-skill',       // cold-start
  'what-would-elon-do',   // flagged
  'moltyverse-email',     // flagged
  'sybil-1',              // sybil ring
  'sybil-2',              // sybil ring
  'sybil-3',              // sybil ring
]);

// ---------------------------------------------------------------------------
// Skill Data (hardcoded subset of real ClawMon / awesome-mcp-skills)
// ---------------------------------------------------------------------------

interface SkillSeed {
  name: string;
  publisher: string;
  category: string;
  description: string;
  flagged: boolean;
}

const SKILLS: SkillSeed[] = [
  // --- Legitimate, well-known skills ---
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

  // --- New/unproven skills (cold start) ---
  { name: 'my-first-skill', publisher: 'newdev-2026', category: 'misc', description: 'A basic hello-world MCP skill', flagged: false },
  { name: 'experimental-nlp', publisher: 'student-project', category: 'ai', description: 'Experimental NLP pipeline', flagged: false },
  { name: 'budget-tracker-v1', publisher: 'indie-dev-42', category: 'finance', description: 'Personal budget tracking', flagged: false },
  { name: 'recipe-finder', publisher: 'hobby-coder', category: 'lifestyle', description: 'Recipe search and meal planning', flagged: false },
  { name: 'weather-simple', publisher: 'weekend-project', category: 'utility', description: 'Basic weather lookup', flagged: false },

  // --- Known malicious / flagged skills (from Snyk/Cisco/Authmind research) ---
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

  // --- Sybil ring (5 fake skills that will rate each other) ---
  // Publisher name matches agentId so graph analysis detects mutual pairs:
  //   clientAddress "sybil-1" rates agentId "sybil-2" AND
  //   clientAddress "sybil-2" rates agentId "sybil-1" → MUTUAL PAIR
  { name: 'sybil-1', publisher: 'sybil-1', category: 'utility', description: 'Sybil test skill 1', flagged: false },
  { name: 'sybil-2', publisher: 'sybil-2', category: 'utility', description: 'Sybil test skill 2', flagged: false },
  { name: 'sybil-3', publisher: 'sybil-3', category: 'utility', description: 'Sybil test skill 3', flagged: false },
  { name: 'sybil-4', publisher: 'sybil-4', category: 'utility', description: 'Sybil test skill 4', flagged: false },
  { name: 'sybil-5', publisher: 'sybil-5', category: 'utility', description: 'Sybil test skill 5', flagged: false },

  // --- More legitimate skills to round out the set ---
  { name: 'elasticsearch-query', publisher: 'elastic-co', category: 'search', description: 'Elasticsearch query and index management', flagged: false },
  { name: 'grafana-dashboard', publisher: 'grafana-labs', category: 'monitoring', description: 'Grafana dashboard creation and management', flagged: false },
  { name: 'github-actions-run', publisher: 'github', category: 'ci-cd', description: 'Trigger and monitor GitHub Actions workflows', flagged: false },
  { name: 'snowflake-sql', publisher: 'snowflake-dev', category: 'database', description: 'Snowflake SQL query execution', flagged: false },
  { name: 'confluence-wiki', publisher: 'atlassian', category: 'documentation', description: 'Confluence page creation and search', flagged: false },
];

/** Working skill list — full set or quick subset (set in main). */
let activeSkills: SkillSeed[] = SKILLS;

// ---------------------------------------------------------------------------
// Feedback Generation
// ---------------------------------------------------------------------------

let feedbackIdCounter = 0;

function generateFeedbackId(): string {
  return `seed-fb-${++feedbackIdCounter}`;
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate realistic synthetic feedback for a skill.
 */
function generateSkillFeedback(
  skill: SkillSeed,
  baseTimestamp: number,
): Feedback[] {
  const feedback: Feedback[] = [];

  if (skill.name.startsWith('sybil-')) {
    // Sybil skills get handled separately
    return feedback;
  }

  if (skill.flagged) {
    // Flagged skills: mixed feedback
    //   - Some positive from sybil-like accounts (early, inflated scores)
    //   - Some negative from community (later, more accurate)
    const count = isQuick ? randomInRange(4, 6) : randomInRange(15, 30);
    for (let i = 0; i < count; i++) {
      const isSybilPositive = i < count * 0.4; // First 40% are fake positives
      const timeOffset = i * randomInRange(30_000, 300_000);
      feedback.push({
        id: generateFeedbackId(),
        agentId: skill.name,
        clientAddress: isSybilPositive
          ? generateSimulatedAddress('sybil-reviewer', randomInRange(0, 10))
          : generateSimulatedAddress('community', randomInRange(0, 50)),
        value: isSybilPositive
          ? randomInRange(75, 95) // Inflated sybil scores
          : randomInRange(5, 25), // Honest low scores
        valueDecimals: 0,
        tag1: skill.category,
        timestamp: baseTimestamp + timeOffset,
        revoked: false,
      });
    }
  } else if (skill.name.startsWith('my-') || skill.name.startsWith('experimental-') ||
             skill.name.startsWith('budget-') || skill.name.startsWith('recipe-') ||
             skill.name.startsWith('weather-')) {
    // New skills: very few reviews (cold-start problem)
    const count = isQuick ? randomInRange(0, 2) : randomInRange(0, 4);
    for (let i = 0; i < count; i++) {
      feedback.push({
        id: generateFeedbackId(),
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
    // Legitimate, established skills: 5-8 in quick mode, 10-50 full
    const count = isQuick ? randomInRange(5, 8) : randomInRange(10, 50);
    for (let i = 0; i < count; i++) {
      feedback.push({
        id: generateFeedbackId(),
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

  return feedback;
}

/**
 * Generate sybil ring feedback: 5 fake skills all rate each other highly.
 * This creates the mutual feedback pattern that graph analysis should detect.
 */
function generateSybilRingFeedback(_baseTimestamp: number): Feedback[] {
  const sybilSkills = activeSkills.filter((s) => s.name.startsWith('sybil-'));
  const feedback: Feedback[] = [];

  // Sybil ring is RECENT (within last 2 hours) so temporal decay doesn't mask
  // the graph analysis effect. In a real attack, sybils act quickly.
  const recentBase = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago

  // Each sybil publisher rates all OTHER sybil skills positively
  for (const rater of sybilSkills) {
    for (const target of sybilSkills) {
      if (rater.name === target.name) continue;

      // The "address" of the rater is their publisher name (acting as reviewer)
      // The "agentId" of the target is the skill name
      // Since publisher === name (e.g., "sybil-1"), this creates:
      //   clientAddress "sybil-1" → agentId "sybil-2" AND
      //   clientAddress "sybil-2" → agentId "sybil-1"
      // which is the mutual feedback pattern graph analysis detects
      feedback.push({
        id: generateFeedbackId(),
        agentId: target.name,
        clientAddress: rater.publisher, // Publisher acts as reviewer
        value: randomInRange(85, 98),   // Inflated mutual scores
        valueDecimals: 0,
        tag1: 'utility',
        timestamp: recentBase + randomInRange(0, 30_000), // All within 30s burst
        revoked: false,
      });
    }
  }

  // Also: sybil publishers rate themselves (self-review via secondary address)
  for (const skill of sybilSkills) {
    feedback.push({
      id: generateFeedbackId(),
      agentId: skill.name,
      clientAddress: `${skill.publisher}-alt`, // Secondary address
      value: randomInRange(90, 99),
      valueDecimals: 0,
      tag1: 'utility',
      timestamp: recentBase + randomInRange(0, 30_000),
      revoked: false,
    });
  }

  return feedback;
}

// ---------------------------------------------------------------------------
// Seeding Logic
// ---------------------------------------------------------------------------

async function seedToChain(): Promise<void> {
  console.log('Seeding to Monad MessageLog contract...\n');
  const baseTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago

  // Register skills
  console.log(`Registering ${activeSkills.length} skills...`);
  for (let i = 0; i < activeSkills.length; i++) {
    const skill = activeSkills[i];
    const msg = {
      type: 'register' as const,
      agentId: skill.name,
      name: skill.name,
      publisher: skill.publisher,
      category: skill.category,
      description: skill.description,
      feedbackAuthPolicy: 'open' as const,
      timestamp: baseTimestamp + i * 1000,
    };

    await submitMessage(Topic.Identity, msg);
    cacheIdentity(msg);

    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${activeSkills.length} registered`);
    }
    await sleep(100); // Rate limit
  }
  console.log(`✓ All ${activeSkills.length} skills registered\n`);

  // Generate and submit feedback
  console.log('Generating feedback...');
  const allFeedback: Feedback[] = [];

  for (const skill of activeSkills) {
    const skillFeedback = generateSkillFeedback(skill, baseTimestamp);
    allFeedback.push(...skillFeedback);
  }

  // Sybil ring
  const sybilFeedback = generateSybilRingFeedback(baseTimestamp);
  allFeedback.push(...sybilFeedback);

  console.log(`Submitting ${allFeedback.length} feedback entries...`);
  for (let i = 0; i < allFeedback.length; i++) {
    const fb = allFeedback[i];
    await submitMessage(Topic.Feedback, {
      type: 'feedback',
      agentId: fb.agentId,
      clientAddress: fb.clientAddress,
      value: fb.value,
      valueDecimals: fb.valueDecimals,
      tag1: fb.tag1,
      timestamp: fb.timestamp,
    });
    cacheFeedback(fb);

    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${allFeedback.length} submitted`);
    }
    await sleep(80); // Rate limit
  }
  console.log(`✓ All ${allFeedback.length} feedback entries submitted\n`);
}

function seedLocal(): void {
  console.log('Seeding in LOCAL mode (no Monad connection required)...\n');
  const baseTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Register skills locally
  for (let i = 0; i < activeSkills.length; i++) {
    const skill = activeSkills[i];
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
  console.log(`✓ ${activeSkills.length} skills registered locally`);

  // Generate feedback locally
  const allFeedback: Feedback[] = [];
  for (const skill of activeSkills) {
    allFeedback.push(...generateSkillFeedback(skill, baseTimestamp));
  }
  allFeedback.push(...generateSybilRingFeedback(baseTimestamp));

  for (const fb of allFeedback) {
    cacheFeedback(fb);
  }
  console.log(`✓ ${allFeedback.length} feedback entries cached locally`);

  // Seed staking data (needed for credibility tier determination)
  const agentNames = activeSkills.map(s => s.name);
  seedSimulatedStakes(agentNames);
  console.log(`✓ Seeded simulated staking data for ${agentNames.length} agents`);

  // Seed payment data (needed for verified usage feedback)
  const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);
  const paymentSeeds = agentNames.map(name => {
    const summary = hardenedSummaries.get(name);
    const skill = activeSkills.find(s => s.name === name);
    return {
      agentId: name,
      publisher: skill?.publisher ?? 'unknown',
      tier: summary?.tier ?? ('C' as const),
      feedbackCount: summary?.feedbackCount ?? 0,
      flagged: skill?.flagged ?? false,
      isSybil: name.startsWith('sybil-'),
      category: skill?.category ?? 'general',
    };
  });
  seedSimulatedPayments(paymentSeeds);
  console.log(`✓ Seeded simulated x402 payment data`);

  // Seed verified usage examples for all three credibility tiers
  seedVerifiedUsageExamples(baseTimestamp);
  console.log('');
}

// ---------------------------------------------------------------------------
// Verified Usage Seeding
// ---------------------------------------------------------------------------

/**
 * Seed specific examples of all three credibility tiers for the scoring report.
 *
 * Creates feedback from:
 *   - Paid + Staked reviewers (callers who have x402 receipts AND are staked publishers)
 *   - Paid but Unstaked reviewers (callers with x402 receipts but no stake)
 *   - Unpaid + Unstaked reviewers (no payment history, no stake)
 */
function seedVerifiedUsageExamples(baseTimestamp: number): void {
  console.log('  Seeding verified usage tier examples...');

  // Target skill for the demo: gmail-integration (well-known, legitimate)
  const targetSkill = 'gmail-integration';
  const allStakes = getAllSimulatedStakes();

  // Build staked addresses set
  const stakedAddresses = new Set<string>();
  for (const [, stake] of allStakes) {
    if (stake.active) {
      stakedAddresses.add(stake.publisher);
      stakedAddresses.add(stake.agentId);
    }
  }

  // --- Tier 1: Paid + Staked reviewers ---
  // Use agent names that appear in the staked addresses set (agentId is added
  // to staked addresses in the simulation). These are real staked skills
  // whose publisher wallets are also in the set.
  const paidStakedReviewers = [
    'github-token',          // staked skill — agentId is in stakedAddresses
    'postgres-connector',    // staked skill — agentId is in stakedAddresses
  ];

  for (const reviewer of paidStakedReviewers) {
    // Ensure they have payment receipts for the target skill
    processSkillPayment(targetSkill, reviewer);
    processSkillPayment(targetSkill, reviewer);
    processSkillPayment(targetSkill, reviewer);

    // Submit high-quality feedback
    const fb: Feedback = {
      id: generateFeedbackId(),
      agentId: targetSkill,
      clientAddress: reviewer,
      value: randomInRange(88, 95),
      valueDecimals: 0,
      tag1: 'communication',
      timestamp: baseTimestamp + randomInRange(1_000_000, 5_000_000),
      revoked: false,
    };
    cacheFeedback(fb);
  }
  console.log(`    ✓ ${paidStakedReviewers.length} paid+staked reviewers (5-10x weight)`);

  // --- Tier 2: Paid but Unstaked reviewers ---
  // These callers have x402 payment receipts but no stake
  const paidUnstakedReviewers = [
    'casual-user-alpha',
    'casual-user-beta',
    'casual-user-gamma',
  ];

  for (const reviewer of paidUnstakedReviewers) {
    // Give them payment history
    processSkillPayment(targetSkill, reviewer);
    processSkillPayment(targetSkill, reviewer);

    // Submit feedback
    const fb: Feedback = {
      id: generateFeedbackId(),
      agentId: targetSkill,
      clientAddress: reviewer,
      value: randomInRange(75, 90),
      valueDecimals: 0,
      tag1: 'communication',
      timestamp: baseTimestamp + randomInRange(2_000_000, 6_000_000),
      revoked: false,
    };
    cacheFeedback(fb);
  }
  console.log(`    ✓ ${paidUnstakedReviewers.length} paid+unstaked reviewers (1-2x weight)`);

  // --- Tier 3: Unpaid + Unstaked reviewers ---
  // No payment history, no stake — minimal credibility
  const unpaidUnstakedReviewers = [
    'anon-reviewer-001',
    'anon-reviewer-002',
    'anon-reviewer-003',
    'anon-reviewer-004',
  ];

  for (const reviewer of unpaidUnstakedReviewers) {
    // No payments, no staking — just raw feedback
    const fb: Feedback = {
      id: generateFeedbackId(),
      agentId: targetSkill,
      clientAddress: reviewer,
      value: randomInRange(60, 85),
      valueDecimals: 0,
      tag1: 'communication',
      timestamp: baseTimestamp + randomInRange(3_000_000, 7_000_000),
      revoked: false,
    };
    cacheFeedback(fb);
  }
  console.log(`    ✓ ${unpaidUnstakedReviewers.length} unpaid+unstaked reviewers (0.1x weight)`);
}

// ---------------------------------------------------------------------------
// Scoring Report
// ---------------------------------------------------------------------------

function printScoringReport(): void {
  const allFeedback = getCachedFeedback();
  const identities = getCachedIdentities();

  console.log('═'.repeat(70));
  console.log('  SCORING REPORT — Naive vs. Hardened');
  console.log('═'.repeat(70));

  // Compute both
  const naiveSummaries = computeAllSummaries(allFeedback);
  const hardenedSummaries = computeAllHardenedSummaries(allFeedback, DEFAULT_MITIGATION_CONFIG);

  // Display top 15 by naive score
  const ranked = rankAgents(allFeedback);

  console.log('\n  Top 15 Skills (Naive Ranking):\n');
  console.log(
    '  ' +
      'Rank'.padEnd(6) +
      'Skill'.padEnd(28) +
      'Naive'.padEnd(10) +
      'Tier'.padEnd(6) +
      'Hardened'.padEnd(10) +
      'Tier'.padEnd(6) +
      'Delta'.padEnd(8) +
      'Reviews',
  );
  console.log('  ' + '─'.repeat(80));

  for (let i = 0; i < Math.min(15, ranked.length); i++) {
    const naive = ranked[i];
    const hardened = hardenedSummaries.get(naive.agentId);
    const delta = hardened
      ? naive.summaryValue - hardened.summaryValue
      : 0;
    const flagged = activeSkills.find((s) => s.name === naive.agentId)?.flagged ? ' ⚠' : '';

    console.log(
      '  ' +
        `#${i + 1}`.padEnd(6) +
        `${naive.agentId}${flagged}`.padEnd(28) +
        naive.summaryValue.toFixed(1).padEnd(10) +
        naive.tier.padEnd(6) +
        (hardened?.summaryValue.toFixed(1) ?? 'N/A').padEnd(10) +
        (hardened?.tier ?? 'N/A').padEnd(6) +
        (delta > 0 ? `-${delta.toFixed(1)}` : delta.toFixed(1)).padEnd(8) +
        `${naive.feedbackCount}`,
    );
  }

  // Sybil ring report
  console.log('\n  Sybil Ring Detection:\n');
  const sybilSkills = activeSkills.filter((s) => s.name.startsWith('sybil-'));
  for (const skill of sybilSkills) {
    const naive = naiveSummaries.get(skill.name);
    const hardened = hardenedSummaries.get(skill.name);
    if (naive && hardened) {
      const drop = naive.summaryValue - hardened.summaryValue;
      console.log(
        `  ${skill.name.padEnd(20)} Naive: ${naive.summaryValue.toFixed(1)} (${naive.tier}) → Hardened: ${hardened.summaryValue.toFixed(1)} (${hardened.tier})  Δ${drop > 0 ? '-' : '+'}${Math.abs(drop).toFixed(1)}`,
      );
    }
  }

  // Flagged skills report
  console.log('\n  Flagged Skills (should have mixed/low scores):\n');
  const flaggedSkills = activeSkills.filter((s) => s.flagged);
  for (const skill of flaggedSkills.slice(0, 5)) {
    const naive = naiveSummaries.get(skill.name);
    const hardened = hardenedSummaries.get(skill.name);
    if (naive) {
      console.log(
        `  ${skill.name.padEnd(28)} Naive: ${naive.summaryValue.toFixed(1)} (${naive.tier}) → Hardened: ${hardened?.summaryValue.toFixed(1) ?? 'N/A'} (${hardened?.tier ?? 'N/A'})`,
      );
    }
  }

  // --- Verified Usage Feedback Weighting Report ---
  console.log('\n  Verified Usage Feedback Weighting:\n');

  // Build staked addresses set for credibility
  const allStakes = getAllSimulatedStakes();
  const stakedAddresses = new Set<string>();
  for (const [, stake] of allStakes) {
    if (stake.active) {
      stakedAddresses.add(stake.publisher);
      stakedAddresses.add(stake.agentId);
    }
  }

  // Show usage-weighted scoring for a representative skill
  const demoSkill = 'gmail-integration';
  const demoFb = allFeedback.filter(f => f.agentId === demoSkill);

  if (demoFb.length > 0) {
    const { summary: usageWeighted, tierBreakdown } = computeUsageWeightedSummary(
      demoFb,
      stakedAddresses,
      DEFAULT_MITIGATION_CONFIG,
      allFeedback,
    );
    const naiveDemo = naiveSummaries.get(demoSkill);
    const hardenedDemo = hardenedSummaries.get(demoSkill);

    console.log(`  Target: ${demoSkill}`);
    console.log(`  ┌────────────────────────────────────────────────────────────┐`);
    console.log(`  │  Scoring Comparison:                                      │`);
    console.log(`  │    Naive:          ${(naiveDemo?.summaryValue ?? 0).toFixed(1).padEnd(8)} (${naiveDemo?.tier ?? 'N/A'})                         │`);
    console.log(`  │    Hardened:       ${(hardenedDemo?.summaryValue ?? 0).toFixed(1).padEnd(8)} (${hardenedDemo?.tier ?? 'N/A'})                         │`);
    console.log(`  │    Usage-Weighted: ${usageWeighted.summaryValue.toFixed(1).padEnd(8)} (${usageWeighted.tier})                         │`);
    console.log(`  ├────────────────────────────────────────────────────────────┤`);
    console.log(`  │  Credibility Tier Breakdown:                              │`);
    console.log(`  │    Paid+Staked:    ${String(tierBreakdown.paidAndStaked.count).padEnd(4)} reviews  avg weight: ${tierBreakdown.paidAndStaked.avgWeight.toFixed(1).padEnd(6)} avg score: ${tierBreakdown.paidAndStaked.avgScore.toFixed(1).padEnd(6)}│`);
    console.log(`  │    Paid+Unstaked:  ${String(tierBreakdown.paidUnstaked.count).padEnd(4)} reviews  avg weight: ${tierBreakdown.paidUnstaked.avgWeight.toFixed(1).padEnd(6)} avg score: ${tierBreakdown.paidUnstaked.avgScore.toFixed(1).padEnd(6)}│`);
    console.log(`  │    Unpaid+Unstkd:  ${String(tierBreakdown.unpaidUnstaked.count).padEnd(4)} reviews  avg weight: ${tierBreakdown.unpaidUnstaked.avgWeight.toFixed(1).padEnd(6)} avg score: ${tierBreakdown.unpaidUnstaked.avgScore.toFixed(1).padEnd(6)}│`);
    console.log(`  ├────────────────────────────────────────────────────────────┤`);
    console.log(`  │  Verified:   ${String(tierBreakdown.totalVerified).padEnd(4)} / ${String(tierBreakdown.totalVerified + tierBreakdown.totalUnverified).padEnd(4)}  (badge shown for paid reviewers)  │`);
    console.log(`  │  Weight Differential: ${tierBreakdown.weightDifferential.toFixed(1)}x  (max/min weight ratio)       │`);
    console.log(`  └────────────────────────────────────────────────────────────┘`);
  }

  // Summary stats
  console.log('\n' + '═'.repeat(70));
  console.log(`  Total skills: ${identities.size}`);
  console.log(`  Total feedback: ${allFeedback.length}`);
  console.log(`  Unique reviewers: ${new Set(allFeedback.map((f) => f.clientAddress)).size}`);
  console.log(`  Flagged skills: ${activeSkills.filter((s) => s.flagged).length}`);
  console.log(`  Sybil ring skills: ${sybilSkills.length}`);
  console.log('═'.repeat(70));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Trusted ClawMon — Phase 1 Data Seed    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log();

  const isLocal = process.argv.includes('--local');
  isQuick = process.argv.includes('--quick');

  if (isQuick) {
    activeSkills = SKILLS.filter((s) => QUICK_SKILL_NAMES.has(s.name));
    console.log(`⚡ Quick mode: ${activeSkills.length} skills, reduced feedback (~50 entries)\n`);
  }

  if (isLocal) {
    seedLocal();
  } else {
    const messageLogAddress = process.env.MESSAGELOG_CONTRACT_ADDRESS;

    if (!messageLogAddress) {
      console.log('No MESSAGELOG_CONTRACT_ADDRESS found in .env. Falling back to local mode.');
      console.log('Run `npm run setup` first to deploy the contract, or use --local flag.\n');
      seedLocal();
    } else {
      await seedToChain();
    }
  }

  // Print scoring report
  printScoringReport();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    closeClient();
  });
