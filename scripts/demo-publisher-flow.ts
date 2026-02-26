/**
 * Trusted ClawMon — Publisher Flow Demo (Phase 8)
 *
 * Demonstrates the complete lifecycle:
 *   1. Skill from ClawHub
 *   2. Publisher stakes → Trust Level L2, Silver benefits
 *   3. Agent A and Agent B give positive feedback
 *   4. Trust score calculated
 *   5. Malicious behavior detected → validator proposes slash
 *   6. 3/5 validators approve → 50% slashed → Trust Level drops
 *   7. Benefits downgraded: Silver → Bronze
 *
 * Run: npx ts-node scripts/demo-publisher-flow.ts
 * Or with Hardhat: npx hardhat run scripts/demo-publisher-flow.ts
 */

// ---------------------------------------------------------------------------
// Simulated demo (no chain connection required)
// ---------------------------------------------------------------------------

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
};

function log(color: string, prefix: string, message: string) {
  console.log(`${color}  [${prefix}]${COLORS.reset} ${message}`);
}

function header(text: string) {
  console.log(`\n${COLORS.bright}${COLORS.cyan}${'─'.repeat(60)}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}  ${text}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}${'─'.repeat(60)}${COLORS.reset}\n`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function demo() {
  console.log(`\n${COLORS.bright}${COLORS.white}`);
  console.log('  ╔═══════════════════════════════════════════════════╗');
  console.log('  ║   Trusted ClawMon — Publisher Flow Demo          ║');
  console.log('  ║   Skill Registry + Staking + Feedback + Slash    ║');
  console.log('  ╚═══════════════════════════════════════════════════╝');
  console.log(COLORS.reset);

  // Step 1: ClawHub Skill Discovery
  header('Step 1: Skill Discovery from ClawHub');
  log(COLORS.blue, 'ClawHub', 'Fetching skill catalog...');
  await sleep(500);
  log(COLORS.green, 'Found', 'gmail-integration by @user123');
  log(COLORS.dim, 'Info', 'Category: Email & Communication');
  log(COLORS.dim, 'Info', 'Risk Tier: LOW');
  log(COLORS.dim, 'Info', 'ClawHub slug: clawhub:gmail-integration');
  log(COLORS.dim, 'Info', 'Publisher wallet: 0x1234...abcd');

  // Step 2: Publisher Registration + Stake
  header('Step 2: Publisher Registers & Stakes');
  log(COLORS.magenta, 'Register', 'SkillRegistry.registerSkill(LOW, metadata, clawhubId, providerHash)');
  await sleep(300);
  log(COLORS.green, 'Registered', 'Skill ID: 1');
  log(COLORS.magenta, 'Stake', 'StakeEscrow.stake(1) with 7 MON');
  await sleep(300);
  log(COLORS.green, 'Staked', '7 MON → 7 boost units');
  log(COLORS.green, 'Trust', 'Trust Level: L2 (7+ boost units)');
  log(COLORS.green, 'Benefit', 'Silver tier activated!');
  log(COLORS.cyan, 'Silver', 'Rate limit: 500 req/min');
  log(COLORS.cyan, 'Silver', 'VPS sandbox: 1 CPU, 2GB RAM, 20GB disk');
  log(COLORS.cyan, 'Silver', 'Analytics dashboard: enabled');
  log(COLORS.magenta, 'Auth', 'feedbackAuth set to "open" (ERC-8004 compliant)');

  // Step 3: Agent Feedback
  header('Step 3: Agents Submit Feedback');
  log(COLORS.blue, 'Agent A', 'ERC-8004 agentId: 42 (whale tier, 5x weight)');
  log(COLORS.blue, 'Agent A', 'giveFeedback(agentId=1, value=90, tag1="agent-review", tag2="42")');
  await sleep(300);
  log(COLORS.green, 'Accepted', 'Agent A feedback recorded (90/100, weight 5.0x)');

  log(COLORS.blue, 'Agent B', 'ERC-8004 agentId: 7 (lobster tier, 2x weight)');
  log(COLORS.blue, 'Agent B', 'giveFeedback(agentId=1, value=80, tag1="agent-review", tag2="7")');
  await sleep(300);
  log(COLORS.green, 'Accepted', 'Agent B feedback recorded (80/100, weight 2.0x)');

  // Step 4: Trust Score
  header('Step 4: Trust Score Calculation');
  log(COLORS.dim, 'Scoring', 'Agent A: 90 × 5.0x = 450');
  log(COLORS.dim, 'Scoring', 'Agent B: 80 × 2.0x = 160');
  log(COLORS.dim, 'Scoring', 'Weighted avg: (450 + 160) / (5.0 + 2.0) = 87.14');
  log(COLORS.green, 'Score', 'Trust Score: 87.14 → AA tier');
  log(COLORS.green, 'Access', 'Access Decision: full_access');

  // Step 5: Malicious Behavior
  header('Step 5: Malicious Behavior Detected!');
  log(COLORS.red, 'Alert', 'Security audit found data exfiltration in gmail-integration');
  log(COLORS.red, 'Evidence', 'IPFS: ipfs://evidence/gmail-exfil-report');
  await sleep(500);

  // Step 6: Slash Governance
  header('Step 6: Validator Slash Governance');
  log(COLORS.yellow, 'Propose', 'Validator 1 proposes 50% slash');
  log(COLORS.dim, 'Details', 'Severity: 5000 bps (50%)');
  log(COLORS.dim, 'Details', 'Reason: EXFILTRATION');
  log(COLORS.dim, 'Details', 'Evidence: ipfs://evidence/gmail-exfil-report');
  log(COLORS.dim, 'Vote', 'Validator 1 auto-approves (1/3 quorum)');
  await sleep(300);
  log(COLORS.yellow, 'Vote', 'Validator 2 approves (2/3 quorum)');
  await sleep(300);
  log(COLORS.yellow, 'Vote', 'Validator 3 approves (3/3 quorum reached!)');
  await sleep(300);
  log(COLORS.red, 'Execute', 'Slash auto-executed! 50% of 7 MON = 3.5 MON slashed');
  log(COLORS.dim, 'Treasury', '3.5 MON transferred to treasury');
  log(COLORS.dim, 'Remaining', '3.5 MON remaining stake');

  // Step 7: Benefit Downgrade
  header('Step 7: Benefit Tier Downgrade');
  log(COLORS.yellow, 'Level', 'Trust Level: L2 → L1 (3.5 boost units)');
  log(COLORS.yellow, 'Tier', 'Benefit Tier: Silver → Bronze');
  log(COLORS.red, 'Revoked', 'VPS sandbox access: REVOKED');
  log(COLORS.red, 'Revoked', 'Analytics dashboard: REVOKED');
  log(COLORS.yellow, 'Updated', 'Rate limit: 500 → 100 req/min');
  log(COLORS.green, 'Kept', 'Priority queue: still active');
  log(COLORS.green, 'Kept', 'Feedback badge: still active');

  // Summary
  header('Summary');
  console.log(`${COLORS.bright}  Contract State:${COLORS.reset}`);
  console.log(`  ├── SkillRegistry:    Skill #1 (gmail-integration) - ACTIVE`);
  console.log(`  ├── StakeEscrow:      3.5 MON staked (was 7.0)`);
  console.log(`  ├── SlashingManager:  Case executed (50% slash, 3/5 approval)`);
  console.log(`  ├── BenefitGate:      Bronze tier (was Silver)`);
  console.log(`  └── ReputationRegistry: Score 87.14 (AA tier)\n`);

  console.log(`${COLORS.bright}  Lifecycle Events:${COLORS.reset}`);
  console.log(`  1. skill:published   → skillId=1, trustLevel=2, stakedAmount=7 MON`);
  console.log(`  2. feedback:agent    → agentId=42, value=90, weight=5.0x`);
  console.log(`  3. feedback:agent    → agentId=7, value=80, weight=2.0x`);
  console.log(`  4. skill:slashed     → amount=3.5 MON, reason=EXFILTRATION`);
  console.log(`  5. benefit:activated → oldTier=Silver, newTier=Bronze\n`);

  console.log(`${COLORS.green}${COLORS.bright}  Demo complete!${COLORS.reset}\n`);
}

demo().catch(console.error);
