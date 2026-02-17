#!/usr/bin/env tsx
/**
 * Trusted ClawMon — Real-Time Demo Script (Phase 7)
 *
 * Simulates a stream of incoming feedback to demonstrate the
 * WebSocket-powered live dashboard updates.
 *
 * Usage:
 *   npx tsx scripts/demo-realtime.ts
 *   npx tsx scripts/demo-realtime.ts --fast       # 500ms interval
 *   npx tsx scripts/demo-realtime.ts --burst       # rapid sybil burst
 *   npx tsx scripts/demo-realtime.ts --count 50    # send 50 feedback items
 */

const API_BASE = process.env.API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Agents to target (mix of legit, flagged, and sybil)
// ---------------------------------------------------------------------------

const LEGIT_AGENTS = [
  'gmail-integration',
  'github-token',
  'deep-research-agent',
  'postgres-connector',
  'slack-bridge',
  'aws-toolkit',
  'stripe-payments',
  'notion-sync',
  'openai-assistant',
  'anthropic-claude',
  'vercel-deploy',
  'redis-cache',
];

const FLAGGED_AGENTS = [
  'what-would-elon-do',
  'moltyverse-email',
  'free-gpt-unlimited',
  'crypto-wallet-helper',
  'ai-code-reviewer',
];

const SYBIL_AGENTS = ['sybil-1', 'sybil-2', 'sybil-3', 'sybil-4', 'sybil-5'];

const REVIEWER_ADDRESSES = [
  '0xreviewer_alice',
  '0xreviewer_bob',
  '0xreviewer_carol',
  '0xreviewer_dave',
  '0xreviewer_eve',
  '0xreviewer_frank',
  '0xreviewer_grace',
  '0xreviewer_hank',
  '0xnew_reviewer_1',
  '0xnew_reviewer_2',
  '0xnew_reviewer_3',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function submitFeedback(agentId: string, clientAddress: string, value: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, clientAddress, value }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  [ERROR] ${res.status}: ${text}`);
    return;
  }

  const data = await res.json() as { id: string };
  console.log(`  [OK] ${data.id}: ${clientAddress} → ${agentId} (score: ${value})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------

interface FeedbackItem {
  agentId: string;
  clientAddress: string;
  value: number;
  label: string;
}

function generateLegitFeedback(): FeedbackItem {
  const agentId = randomFrom(LEGIT_AGENTS);
  const clientAddress = randomFrom(REVIEWER_ADDRESSES);
  const value = randomInt(70, 98);
  return { agentId, clientAddress, value, label: 'LEGIT' };
}

function generateFlaggedFeedback(): FeedbackItem {
  const agentId = randomFrom(FLAGGED_AGENTS);
  const isHonest = Math.random() > 0.5;
  const clientAddress = isHonest
    ? randomFrom(REVIEWER_ADDRESSES)
    : `0xsybil_bot_${randomInt(1, 10)}`;
  const value = isHonest ? randomInt(5, 30) : randomInt(80, 99);
  return {
    agentId,
    clientAddress,
    value,
    label: isHonest ? 'FLAGGED-HONEST' : 'FLAGGED-SYBIL',
  };
}

function generateSybilBurst(): FeedbackItem[] {
  const items: FeedbackItem[] = [];
  for (const rater of SYBIL_AGENTS) {
    for (const target of SYBIL_AGENTS) {
      if (rater === target) continue;
      items.push({
        agentId: target,
        clientAddress: rater,
        value: randomInt(88, 99),
        label: 'SYBIL-RING',
      });
    }
  }
  return items;
}

function generateMixedFeedback(): FeedbackItem {
  const roll = Math.random();
  if (roll < 0.6) return generateLegitFeedback();
  if (roll < 0.85) return generateFlaggedFeedback();
  // Occasional individual sybil feedback
  const target = randomFrom(SYBIL_AGENTS);
  const rater = randomFrom(SYBIL_AGENTS.filter((s) => s !== target));
  return {
    agentId: target,
    clientAddress: rater,
    value: randomInt(85, 99),
    label: 'SYBIL',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isFast = args.includes('--fast');
  const isBurst = args.includes('--burst');
  const countIdx = args.indexOf('--count');
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1], 10) || 30 : 30;

  const interval = isFast ? 500 : 2000;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║      Trusted ClawMon — Real-Time Demo (Phase 7)            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  API:      ${API_BASE.padEnd(48)}║`);
  console.log(`║  Mode:     ${(isBurst ? 'Sybil Burst' : isFast ? 'Fast' : 'Normal').padEnd(48)}║`);
  console.log(`║  Count:    ${String(count).padEnd(48)}║`);
  console.log(`║  Interval: ${(interval + 'ms').padEnd(48)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Verify server is running
  try {
    const healthRes = await fetch(`${API_BASE}/api/stats`);
    if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
    console.log('[READY] Server is running. Starting feedback stream...\n');
  } catch (err) {
    console.error('[ERROR] Cannot reach server at', API_BASE);
    console.error('        Start the server first: npm run dev:server\n');
    process.exit(1);
  }

  if (isBurst) {
    // Sybil burst mode: flood sybil feedback rapidly
    console.log('=== SYBIL BURST MODE ===\n');
    const burstItems = generateSybilBurst();
    console.log(`Sending ${burstItems.length} sybil-ring feedback items...\n`);

    for (let i = 0; i < burstItems.length; i++) {
      const item = burstItems[i];
      console.log(`[${i + 1}/${burstItems.length}] [${item.label}]`);
      await submitFeedback(item.agentId, item.clientAddress, item.value);
      await sleep(200);
    }

    console.log('\n=== Burst complete. Now sending mixed feedback... ===\n');
  }

  for (let i = 0; i < count; i++) {
    const item = generateMixedFeedback();
    const progress = `[${i + 1}/${count}]`;
    console.log(`${progress} [${item.label}]`);
    await submitFeedback(item.agentId, item.clientAddress, item.value);

    if (i < count - 1) {
      const jitter = randomInt(-interval * 0.3, interval * 0.3);
      await sleep(Math.max(200, interval + jitter));
    }
  }

  console.log('\n[DONE] Demo complete. Check the dashboard for live updates!\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
