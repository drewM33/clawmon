/**
 * Trusted ClawMon — On-Chain vs Local Seed Comparison
 *
 * Reads all feedback from the Monad MessageLog contract using reader.ts,
 * runs both naive and hardened scorers, then compares against a
 * fresh local-mode seed. Confirms sybil ring scores C in hardened
 * mode and legitimate skills are unaffected.
 *
 * Run: npx tsx scripts/compare-mirror-vs-local.ts
 */

import 'dotenv/config';
import {
  readFeedback,
  readIdentities,
  clearCaches,
  cacheFeedback,
  cacheIdentity,
  getCachedFeedback,
  getCachedIdentities,
} from '../src/scoring/reader.js';
import {
  computeAllSummaries,
  rankAgents,
} from '../src/scoring/engine.js';
import {
  computeAllHardenedSummaries,
} from '../src/scoring/hardened.js';
import { DEFAULT_MITIGATION_CONFIG } from '../src/mitigations/types.js';
import { generateSimulatedAddress } from '../src/monad/accounts.js';
import type { Feedback, FeedbackSummary, RegisterMessage } from '../src/scoring/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Skill data (mirrors seed-phase1.ts so we can regenerate locally)
// ─────────────────────────────────────────────────────────────────────────────

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

const SYBIL_NAMES = new Set(['sybil-1', 'sybil-2', 'sybil-3', 'sybil-4', 'sybil-5']);
const COLD_START_PREFIXES = ['my-', 'experimental-', 'budget-', 'recipe-', 'weather-'];

function isColdStart(name: string): boolean {
  return COLD_START_PREFIXES.some((p) => name.startsWith(p));
}

function isSybil(name: string): boolean {
  return SYBIL_NAMES.has(name);
}

function isFlagged(name: string): boolean {
  return SKILLS.find((s) => s.name === name)?.flagged ?? false;
}

function skillCategory(name: string): 'legitimate' | 'cold-start' | 'flagged' | 'sybil' {
  if (isSybil(name)) return 'sybil';
  if (isFlagged(name)) return 'flagged';
  if (isColdStart(name)) return 'cold-start';
  return 'legitimate';
}

// ─────────────────────────────────────────────────────────────────────────────
// Local seed generation (deterministic version of seed-phase1.ts)
// ─────────────────────────────────────────────────────────────────────────────

let feedbackIdCounter = 0;
function generateFeedbackId(): string {
  return `local-fb-${++feedbackIdCounter}`;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateLocalSeedData(): { feedback: Feedback[]; identities: Map<string, RegisterMessage> } {
  const rand = seededRandom(42);
  const randInRange = (min: number, max: number) =>
    Math.floor(rand() * (max - min + 1)) + min;

  const baseTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const identities = new Map<string, RegisterMessage>();
  const allFeedback: Feedback[] = [];

  for (let i = 0; i < SKILLS.length; i++) {
    const skill = SKILLS[i];
    identities.set(skill.name, {
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

  for (const skill of SKILLS) {
    if (skill.name.startsWith('sybil-')) continue;

    if (skill.flagged) {
      const count = randInRange(15, 30);
      for (let i = 0; i < count; i++) {
        const isSybilPositive = i < count * 0.4;
        const timeOffset = i * randInRange(30_000, 300_000);
        allFeedback.push({
          id: generateFeedbackId(),
          agentId: skill.name,
          clientAddress: isSybilPositive
            ? generateSimulatedAddress('sybil-reviewer', randInRange(0, 10))
            : generateSimulatedAddress('community', randInRange(0, 50)),
          value: isSybilPositive ? randInRange(75, 95) : randInRange(5, 25),
          valueDecimals: 0,
          tag1: skill.category,
          timestamp: baseTimestamp + timeOffset,
          revoked: false,
        });
      }
    } else if (isColdStart(skill.name)) {
      const count = randInRange(0, 4);
      for (let i = 0; i < count; i++) {
        allFeedback.push({
          id: generateFeedbackId(),
          agentId: skill.name,
          clientAddress: generateSimulatedAddress('community', randInRange(0, 50)),
          value: randInRange(50, 80),
          valueDecimals: 0,
          tag1: skill.category,
          timestamp: baseTimestamp + i * randInRange(60_000, 600_000),
          revoked: false,
        });
      }
    } else {
      const count = randInRange(10, 50);
      for (let i = 0; i < count; i++) {
        allFeedback.push({
          id: generateFeedbackId(),
          agentId: skill.name,
          clientAddress: generateSimulatedAddress('community', randInRange(0, 50)),
          value: randInRange(70, 95),
          valueDecimals: 0,
          tag1: skill.category,
          timestamp: baseTimestamp + i * randInRange(60_000, 600_000),
          revoked: false,
        });
      }
    }
  }

  // Sybil ring feedback (recent)
  const sybilSkills = SKILLS.filter((s) => s.name.startsWith('sybil-'));
  const recentBase = Date.now() - 2 * 60 * 60 * 1000;

  for (const rater of sybilSkills) {
    for (const target of sybilSkills) {
      if (rater.name === target.name) continue;
      allFeedback.push({
        id: generateFeedbackId(),
        agentId: target.name,
        clientAddress: rater.publisher,
        value: randInRange(85, 98),
        valueDecimals: 0,
        tag1: 'utility',
        timestamp: recentBase + randInRange(0, 30_000),
        revoked: false,
      });
    }
  }

  for (const skill of sybilSkills) {
    allFeedback.push({
      id: generateFeedbackId(),
      agentId: skill.name,
      clientAddress: `${skill.publisher}-alt`,
      value: randInRange(90, 99),
      valueDecimals: 0,
      tag1: 'utility',
      timestamp: recentBase + randInRange(0, 30_000),
      revoked: false,
    });
  }

  return { feedback: allFeedback, identities };
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string { return s.padEnd(n); }
function rpad(s: string, n: number): string { return s.padStart(n); }

function tierEmoji(tier: string): string {
  if (tier === 'AAA' || tier === 'AA') return '\u2705'; // green check
  if (tier === 'A' || tier === 'BBB') return '\u2796'; // dash
  if (tier === 'C' || tier === 'CC' || tier === 'CCC') return '\u274C'; // red X
  return '\u26A0\uFE0F'; // warning
}

interface ScoredRow {
  name: string;
  cat: string;
  naiveScore: number;
  naiveTier: string;
  hardenedScore: number;
  hardenedTier: string;
  delta: number;
  count: number;
}

function buildRows(
  naiveSummaries: Map<string, FeedbackSummary>,
  hardenedSummaries: Map<string, FeedbackSummary>,
): ScoredRow[] {
  const rows: ScoredRow[] = [];
  for (const [agentId, naive] of naiveSummaries) {
    const hardened = hardenedSummaries.get(agentId);
    rows.push({
      name: agentId,
      cat: skillCategory(agentId),
      naiveScore: naive.summaryValue,
      naiveTier: naive.tier,
      hardenedScore: hardened?.summaryValue ?? 0,
      hardenedTier: hardened?.tier ?? 'C',
      delta: naive.summaryValue - (hardened?.summaryValue ?? 0),
      count: naive.feedbackCount,
    });
  }
  return rows.sort((a, b) => b.naiveScore - a.naiveScore);
}

function printTable(title: string, rows: ScoredRow[], limit?: number): void {
  console.log();
  console.log(`  ${title}`);
  console.log();
  console.log(
    '  ' +
    pad('#', 5) +
    pad('Skill', 30) +
    pad('Type', 12) +
    rpad('Naive', 7) +
    '  ' +
    pad('Tier', 6) +
    rpad('Hard.', 7) +
    '  ' +
    pad('Tier', 6) +
    rpad('Delta', 7) +
    '  ' +
    rpad('Cnt', 5),
  );
  console.log('  ' + '\u2500'.repeat(95));

  const display = limit ? rows.slice(0, limit) : rows;
  for (let i = 0; i < display.length; i++) {
    const r = display[i];
    const typeTag = r.cat === 'sybil' ? 'SYBIL' :
                    r.cat === 'flagged' ? 'FLAGGED' :
                    r.cat === 'cold-start' ? 'COLD' :
                    'legit';
    const deltaStr = r.delta > 0.5 ? `-${r.delta.toFixed(1)}` : r.delta.toFixed(1);

    console.log(
      '  ' +
      pad(`${i + 1}`, 5) +
      pad(r.name, 30) +
      pad(typeTag, 12) +
      rpad(r.naiveScore.toFixed(1), 7) +
      '  ' +
      pad(r.naiveTier, 6) +
      rpad(r.hardenedScore.toFixed(1), 7) +
      '  ' +
      pad(r.hardenedTier, 6) +
      rpad(deltaStr, 7) +
      '  ' +
      rpad(String(r.count), 5),
    );
  }
  if (limit && rows.length > limit) {
    console.log(`  ... and ${rows.length - limit} more skills`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification checks
// ─────────────────────────────────────────────────────────────────────────────

interface CheckResult { pass: boolean; msg: string; }

function runChecks(
  label: string,
  naiveSummaries: Map<string, FeedbackSummary>,
  hardenedSummaries: Map<string, FeedbackSummary>,
): CheckResult[] {
  const checks: CheckResult[] = [];

  // Check 1: All sybil ring members score C in hardened mode
  const sybilNames = ['sybil-1', 'sybil-2', 'sybil-3', 'sybil-4', 'sybil-5'];
  for (const name of sybilNames) {
    const h = hardenedSummaries.get(name);
    if (!h) {
      checks.push({ pass: false, msg: `[${label}] ${name}: not found in hardened results` });
      continue;
    }
    const isCTier = h.tier === 'C' || h.tier === 'CC' || h.tier === 'CCC';
    checks.push({
      pass: isCTier,
      msg: `[${label}] ${name} hardened tier = ${h.tier} (score ${h.summaryValue.toFixed(1)}) ${isCTier ? '-> C-range CONFIRMED' : '-> UNEXPECTED: expected C-range'}`,
    });
  }

  // Check 2: Sybil ring naive scores are inflated (AAA/AA)
  for (const name of sybilNames) {
    const n = naiveSummaries.get(name);
    if (!n) continue;
    const isHigh = n.summaryValue >= 80;
    checks.push({
      pass: isHigh,
      msg: `[${label}] ${name} naive score = ${n.summaryValue.toFixed(1)} (${n.tier}) ${isHigh ? '-> inflated as expected' : '-> not inflated?'}`,
    });
  }

  // Check 3: Legitimate skills retain high hardened scores
  const legitimateSkills = SKILLS.filter(
    (s) => !s.flagged && !s.name.startsWith('sybil-') && !isColdStart(s.name),
  );
  let legitOk = 0;
  let legitTotal = 0;
  for (const skill of legitimateSkills) {
    const n = naiveSummaries.get(skill.name);
    const h = hardenedSummaries.get(skill.name);
    if (!n || !h || n.feedbackCount === 0) continue;
    legitTotal++;
    const tierOk = h.tier === 'AAA' || h.tier === 'AA' || h.tier === 'A' || h.tier === 'BBB';
    if (tierOk) legitOk++;
  }
  checks.push({
    pass: legitTotal > 0 && legitOk === legitTotal,
    msg: `[${label}] Legitimate skills unaffected: ${legitOk}/${legitTotal} retain tier >= BBB in hardened mode`,
  });

  // Check 4: Hardened score <= naive score for sybil ring (mitigations applied)
  for (const name of sybilNames) {
    const n = naiveSummaries.get(name);
    const h = hardenedSummaries.get(name);
    if (!n || !h) continue;
    const drop = n.summaryValue - h.summaryValue;
    checks.push({
      pass: drop > 30,
      msg: `[${label}] ${name} score drop: ${n.summaryValue.toFixed(1)} -> ${h.summaryValue.toFixed(1)} (delta ${drop.toFixed(1)}) ${drop > 30 ? '-> significant drop' : '-> insufficient drop'}`,
    });
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Side-by-side comparison
// ─────────────────────────────────────────────────────────────────────────────

function printSideBySide(
  mirrorRows: ScoredRow[],
  localRows: ScoredRow[],
): void {
  console.log();
  console.log('  SIDE-BY-SIDE: Mirror Node Data vs Local Seed');
  console.log();

  const localMap = new Map(localRows.map((r) => [r.name, r]));

  console.log(
    '  ' +
    pad('Skill', 26) +
    pad('Type', 9) +
    ' | ' +
    pad('MIRROR Naive', 13) +
    pad('Hard.', 10) +
    ' | ' +
    pad('LOCAL Naive', 13) +
    pad('Hard.', 10) +
    ' | ' +
    'Match?',
  );
  console.log('  ' + '\u2500'.repeat(105));

  const allNames = new Set([...mirrorRows.map((r) => r.name), ...localRows.map((r) => r.name)]);

  // Sort by category then name for readability
  const sortOrder = { sybil: 0, flagged: 1, 'cold-start': 2, legitimate: 3 };
  const sorted = Array.from(allNames).sort((a, b) => {
    const ca = sortOrder[skillCategory(a)] ?? 9;
    const cb = sortOrder[skillCategory(b)] ?? 9;
    if (ca !== cb) return ca - cb;
    return a.localeCompare(b);
  });

  for (const name of sorted) {
    const mr = mirrorRows.find((r) => r.name === name);
    const lr = localMap.get(name);
    const cat = skillCategory(name);
    const typeTag = cat === 'sybil' ? 'SYBIL' :
                    cat === 'flagged' ? 'FLAG' :
                    cat === 'cold-start' ? 'COLD' : 'OK';

    const mNaive = mr ? `${mr.naiveScore.toFixed(1)} (${mr.naiveTier})` : '  --  ';
    const mHard = mr ? `${mr.hardenedScore.toFixed(1)} (${mr.hardenedTier})` : '  --  ';
    const lNaive = lr ? `${lr.naiveScore.toFixed(1)} (${lr.naiveTier})` : '  --  ';
    const lHard = lr ? `${lr.hardenedScore.toFixed(1)} (${lr.hardenedTier})` : '  --  ';

    // "Match" means same hardened tier between mirror and local
    let match = '  --  ';
    if (mr && lr) {
      match = mr.hardenedTier === lr.hardenedTier ? ' YES ' : ` ${mr.hardenedTier}/${lr.hardenedTier}`;
    } else if (!mr) {
      match = 'NO-MR';
    }

    console.log(
      '  ' +
      pad(name, 26) +
      pad(typeTag, 9) +
      ' | ' +
      pad(mNaive, 13) +
      pad(mHard, 10) +
      ' | ' +
      pad(lNaive, 13) +
      pad(lHard, 10) +
      ' | ' +
      match,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\u2554' + '\u2550'.repeat(62) + '\u2557');
  console.log('\u2551  Trusted ClawMon \u2014 Mirror Node vs Local Comparison           \u2551');
  console.log('\u255A' + '\u2550'.repeat(62) + '\u255D');
  console.log();

  const messageLogAddress = process.env.MESSAGELOG_CONTRACT_ADDRESS;

  // ── Phase 1: Read from Monad MessageLog ──────────────────────────────
  let mirrorFeedback: Feedback[] = [];
  let mirrorIdentities = new Map<string, RegisterMessage>();

  if (messageLogAddress) {
    console.log('  Phase 1: Reading from Monad MessageLog contract...');
    console.log(`  Contract: ${messageLogAddress}`);
    console.log();

    try {
      mirrorIdentities = await readIdentities();
      console.log(`    Identities read: ${mirrorIdentities.size}`);

      mirrorFeedback = await readFeedback();
      console.log(`    Feedback read:   ${mirrorFeedback.length}`);

      const uniqueAgents = new Set(mirrorFeedback.map((f) => f.agentId));
      const uniqueReviewers = new Set(mirrorFeedback.map((f) => f.clientAddress));
      console.log(`    Unique agents:   ${uniqueAgents.size}`);
      console.log(`    Unique reviewers: ${uniqueReviewers.size}`);
    } catch (err) {
      console.log(`    On-chain read failed: ${err}`);
      console.log('    Falling back to local-only comparison.\n');
    }
  } else {
    console.log('  Phase 1: No MESSAGELOG_CONTRACT_ADDRESS in .env, skipping on-chain read.');
    console.log('  (Set MESSAGELOG_CONTRACT_ADDRESS to enable.)\n');
  }

  // ── Phase 2: Score mirror node data ────────────────────────────────────
  let mirrorNaive = new Map<string, FeedbackSummary>();
  let mirrorHardened = new Map<string, FeedbackSummary>();
  let mirrorRows: ScoredRow[] = [];

  if (mirrorFeedback.length > 0) {
    console.log('\n  Phase 2: Scoring mirror node data...');
    mirrorNaive = computeAllSummaries(mirrorFeedback);
    mirrorHardened = computeAllHardenedSummaries(mirrorFeedback, DEFAULT_MITIGATION_CONFIG);
    mirrorRows = buildRows(mirrorNaive, mirrorHardened);

    console.log(`    Agents scored: ${mirrorNaive.size}`);
    printTable('MIRROR NODE \u2014 All Skills (Naive Rank)', mirrorRows);
  }

  // ── Phase 3: Generate local seed data ──────────────────────────────────
  console.log('\n  Phase 3: Generating local seed data (deterministic)...');
  clearCaches();
  const { feedback: localFeedback, identities: localIdentities } = generateLocalSeedData();
  console.log(`    Skills:   ${localIdentities.size}`);
  console.log(`    Feedback: ${localFeedback.length}`);

  // ── Phase 4: Score local data ──────────────────────────────────────────
  console.log('\n  Phase 4: Scoring local seed data...');
  const localNaive = computeAllSummaries(localFeedback);
  const localHardened = computeAllHardenedSummaries(localFeedback, DEFAULT_MITIGATION_CONFIG);
  const localRows = buildRows(localNaive, localHardened);

  console.log(`    Agents scored: ${localNaive.size}`);
  printTable('LOCAL SEED \u2014 All Skills (Naive Rank)', localRows);

  // ── Phase 5: Side-by-side comparison ───────────────────────────────────
  console.log('\n' + '\u2550'.repeat(70));

  if (mirrorRows.length > 0) {
    printSideBySide(mirrorRows, localRows);
  } else {
    console.log('\n  (No mirror node data available \u2014 showing local-only results above.)');
  }

  // ── Phase 6: Verification checks ──────────────────────────────────────
  console.log('\n' + '\u2550'.repeat(70));
  console.log('  VERIFICATION CHECKS');
  console.log('\u2550'.repeat(70));

  const allChecks: CheckResult[] = [];

  if (mirrorNaive.size > 0) {
    allChecks.push(...runChecks('MIRROR', mirrorNaive, mirrorHardened));
  }
  allChecks.push(...runChecks('LOCAL', localNaive, localHardened));

  let passed = 0;
  let failed = 0;
  for (const c of allChecks) {
    console.log(`  ${c.pass ? '\u2705' : '\u274C'} ${c.msg}`);
    if (c.pass) passed++; else failed++;
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n' + '\u2550'.repeat(70));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  if (mirrorFeedback.length > 0) {
    console.log(`  Mirror node: ${mirrorFeedback.length} feedback entries, ${mirrorNaive.size} agents`);
  }
  console.log(`  Local seed:  ${localFeedback.length} feedback entries, ${localNaive.size} agents`);

  // Final verdict
  const sybilAllC = ['sybil-1', 'sybil-2', 'sybil-3', 'sybil-4', 'sybil-5'].every((name) => {
    const checkBoth = (summaries: Map<string, FeedbackSummary>) => {
      const h = summaries.get(name);
      return h ? (h.tier === 'C' || h.tier === 'CC' || h.tier === 'CCC') : true;
    };
    return checkBoth(localHardened) && (mirrorHardened.size === 0 || checkBoth(mirrorHardened));
  });

  console.log();
  if (sybilAllC && failed === 0) {
    console.log('  \u2705 ALL CLEAR: Sybil ring scores C in hardened mode.');
    console.log('  \u2705 ALL CLEAR: Legitimate skills are unaffected.');
  } else {
    console.log('  \u274C ISSUES DETECTED \u2014 see failed checks above.');
  }
  console.log('\u2550'.repeat(70));

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Comparison failed:', err);
  process.exit(1);
});
