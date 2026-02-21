/**
 * One-shot demo: register 3 skills, stake to L3/L1/L0, slash one.
 * Run after deploy:stake-slash and env vars set.
 *
 *   node scripts/boost/demo-full.cjs
 *
 * Uses slugs that match dashboard seed: gmail-integration, github-token, postgres-connector
 */

require('dotenv/config');
const { spawnSync } = require('child_process');

function run(script, env = {}, opts = {}) {
  const capture = !!opts.capture;
  const r = spawnSync('npx', [
    'hardhat', 'run', script,
    '--network', 'monad',
    '--config', 'hardhat.config.cjs',
  ], {
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });
  if (r.status !== 0) process.exit(r.status || 1);
  return capture ? (r.stdout || '').trim() : '';
}

function main() {
  if (!process.env.SKILL_REGISTRY_ADDRESS || !process.env.STAKE_ESCROW_ADDRESS) {
    console.error('Run deploy first: npm run deploy:stake-slash');
    console.error('Set SKILL_REGISTRY_ADDRESS, STAKE_ESCROW_ADDRESS, SLASHING_MANAGER_ADDRESS, DEPLOYER_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const slugs = ['gmail-integration', 'github-token', 'postgres-connector'];
  const configs = [
    { risk: 'LOW', amount: 14 },
    { risk: 'MEDIUM', amount: 4 },
    { risk: 'HIGH', amount: 0 },
  ];

  console.log('\n=== BOOST DEMO: Register + Stake + Slash ===\n');

  const skillIds = [];
  for (let i = 0; i < slugs.length; i++) {
    console.log(`\n--- Register ${slugs[i]} (${configs[i].risk}) ---`);
    run(`scripts/boost/register-skill.cjs`, { SLUG: slugs[i], RISK: configs[i].risk });
    const out = run(`scripts/boost/status.cjs`, { SLUG: slugs[i] }, { capture: true });
    let parsed = {};
    try { parsed = JSON.parse(out); } catch {}
    if (parsed.skillId) skillIds.push(parsed.skillId);
  }

  for (let i = 0; i < 2 && skillIds[i]; i++) {
    if (configs[i].amount <= 0) continue;
    console.log(`\n--- Stake ${slugs[i]} (${configs[i].amount} MON) ---`);
    run(`scripts/boost/stake-skill.cjs`, { SKILL_ID: String(skillIds[i]), AMOUNT_MON: String(configs[i].amount) });
  }

  console.log('\n--- Slash gmail-integration (50%) ---');
  run(`scripts/boost/slash-skill.cjs`, { SKILL_ID: String(skillIds[0]), SEVERITY_BPS: '5000', REASON: 'DATA_EXFILTRATION' });

  console.log('\n=== Done. Start server + dashboard; check Boost Lx badges ===\n');
}

main();
