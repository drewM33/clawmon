/**
 * Trusted ClawMon — Live Integration Test for AttestationRegistry on Monad
 *
 * Steps:
 *   1. Connect to deployed contract
 *   2. Publish an attestation for a test agent
 *   3. Read it back and display the full record
 *   4. Verify it passes verifyMinScore and verifyMinTier checks
 *   5. Revoke it
 *   6. Confirm revocation — isAttested, verifyMinScore, verifyMinTier all return false
 */

import 'dotenv/config';
import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONAD_RPC = process.env.MONAD_RPC_URL || 'https://testnet.monad.xyz/v1';
const CONTRACT_ADDRESS = process.env.ATTESTATION_CONTRACT_ADDRESS!;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY!;

const TIER_NAMES: Record<number, string> = {
  0: 'C', 1: 'CC', 2: 'CCC', 3: 'B', 4: 'BB', 5: 'BBB', 6: 'A', 7: 'AA', 8: 'AAA',
};

const TEST_AGENT_NAME = `integration-test-agent-${Date.now()}`;
const TEST_AGENT_HASH = ethers.id(TEST_AGENT_NAME);
const TEST_SCORE = 87;
const TEST_TIER = 7; // AA
const TEST_FEEDBACK_COUNT = 42;
const TEST_SOURCE_TS = Math.floor(Date.now() / 1000);
const SOURCE_CHAIN = 'monad-testnet';

// ---------------------------------------------------------------------------
// ABI
// ---------------------------------------------------------------------------

const ABI = [
  'function publishAttestation(bytes32 agentId, uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, string sourceChain) external',
  'function revokeAttestation(bytes32 agentId, string reason) external',
  'function isAttested(bytes32 agentId) view returns (bool)',
  'function getAttestation(bytes32 agentId) view returns (uint16 score, uint8 tier, uint32 feedbackCount, uint64 sourceTimestamp, uint64 attestedAt, string sourceChain, bool revoked, bool isFresh)',
  'function getAttestationAge(bytes32 agentId) view returns (uint64)',
  'function verifyMinScore(bytes32 agentId, uint16 minScore) view returns (bool)',
  'function verifyMinTier(bytes32 agentId, uint8 minTier) view returns (bool)',
  'function getAttestedAgentCount() view returns (uint256)',
  'function totalAttestations() view returns (uint256)',
  'function attestationCount(bytes32 agentId) view returns (uint256)',
  'function attester() view returns (address)',
  'function owner() view returns (address)',
  'function FRESHNESS_WINDOW() view returns (uint64)',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function divider(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

function check(label: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} ${label}: ${JSON.stringify(actual)}${pass ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  return pass;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   AttestationRegistry — Live Monad Integration Test       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const provider = new ethers.JsonRpcProvider(MONAD_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log(`\n  Contract:  ${CONTRACT_ADDRESS}`);
  console.log(`  Attester:  ${wallet.address}`);
  console.log(`  Agent:     ${TEST_AGENT_NAME}`);
  console.log(`  Agent Hash:${TEST_AGENT_HASH}`);
  console.log(`  Network:   Monad Testnet`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance:   ${ethers.formatEther(balance)} MON`);

  // ── Step 0: Pre-flight checks ──────────────────────────────────────
  divider('STEP 0 — Pre-flight');

  const owner = await contract.owner();
  const attester = await contract.attester();
  const freshness = await contract.FRESHNESS_WINDOW();
  const preCount = await contract.totalAttestations();

  console.log(`  Owner:             ${owner}`);
  console.log(`  Attester:          ${attester}`);
  console.log(`  Freshness Window:  ${Number(freshness)}s (${Number(freshness) / 3600}h)`);
  console.log(`  Total Attestations:${preCount}`);

  const preAttested = await contract.isAttested(TEST_AGENT_HASH);
  check('Agent not yet attested', preAttested, false);

  // ── Step 1: Publish attestation ────────────────────────────────────
  divider('STEP 1 — Publish Attestation');

  console.log(`  Publishing: score=${TEST_SCORE}, tier=${TIER_NAMES[TEST_TIER]} (${TEST_TIER}), feedbackCount=${TEST_FEEDBACK_COUNT}`);
  console.log(`  Submitting tx...`);

  const tx = await contract.publishAttestation(
    TEST_AGENT_HASH, TEST_SCORE, TEST_TIER, TEST_FEEDBACK_COUNT, TEST_SOURCE_TS, SOURCE_CHAIN,
  );
  console.log(`  Tx hash: ${tx.hash}`);
  console.log(`  Waiting for confirmation...`);

  const receipt = await tx.wait();
  console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

  // ── Step 2: Read attestation back ──────────────────────────────────
  divider('STEP 2 — Read Attestation');

  const att = await contract.getAttestation(TEST_AGENT_HASH);
  const age = await contract.getAttestationAge(TEST_AGENT_HASH);
  const count = await contract.attestationCount(TEST_AGENT_HASH);
  const totalNow = await contract.totalAttestations();

  console.log(`  Score:          ${att.score}`);
  console.log(`  Tier:           ${TIER_NAMES[Number(att.tier)]} (${att.tier})`);
  console.log(`  Feedback Count: ${att.feedbackCount}`);
  console.log(`  Source TS:      ${att.sourceTimestamp}`);
  console.log(`  Attested At:    ${att.attestedAt} (${new Date(Number(att.attestedAt) * 1000).toISOString()})`);
  console.log(`  Source Chain:   ${att.sourceChain}`);
  console.log(`  Revoked:        ${att.revoked}`);
  console.log(`  Is Fresh:       ${att.isFresh}`);
  console.log(`  Age:            ${age}s`);
  console.log(`  Att. Count:     ${count}`);
  console.log(`  Total Atts:     ${totalNow}`);

  let allPass = true;
  allPass = check('score matches', Number(att.score), TEST_SCORE) && allPass;
  allPass = check('tier matches', Number(att.tier), TEST_TIER) && allPass;
  allPass = check('feedbackCount matches', Number(att.feedbackCount), TEST_FEEDBACK_COUNT) && allPass;
  allPass = check('sourceChain matches', att.sourceChain, SOURCE_CHAIN) && allPass;
  allPass = check('not revoked', att.revoked, false) && allPass;
  allPass = check('is fresh', att.isFresh, true) && allPass;

  // ── Step 3: Verify consumer functions ──────────────────────────────
  divider('STEP 3 — Verify Consumer Functions');

  const isAtt = await contract.isAttested(TEST_AGENT_HASH);
  allPass = check('isAttested() = true', isAtt, true) && allPass;

  const minScore80 = await contract.verifyMinScore(TEST_AGENT_HASH, 80);
  allPass = check('verifyMinScore(80) = true', minScore80, true) && allPass;

  const minScore87 = await contract.verifyMinScore(TEST_AGENT_HASH, 87);
  allPass = check('verifyMinScore(87) = true (exact)', minScore87, true) && allPass;

  const minScore90 = await contract.verifyMinScore(TEST_AGENT_HASH, 90);
  allPass = check('verifyMinScore(90) = false (above)', minScore90, false) && allPass;

  const minTierA = await contract.verifyMinTier(TEST_AGENT_HASH, 6); // A
  allPass = check('verifyMinTier(A=6) = true', minTierA, true) && allPass;

  const minTierAA = await contract.verifyMinTier(TEST_AGENT_HASH, 7); // AA
  allPass = check('verifyMinTier(AA=7) = true (exact)', minTierAA, true) && allPass;

  const minTierAAA = await contract.verifyMinTier(TEST_AGENT_HASH, 8); // AAA
  allPass = check('verifyMinTier(AAA=8) = false (above)', minTierAAA, false) && allPass;

  // ── Step 4: Revoke attestation ─────────────────────────────────────
  divider('STEP 4 — Revoke Attestation');

  console.log(`  Revoking attestation for: ${TEST_AGENT_NAME}`);
  console.log(`  Reason: "Live integration test — confirmed revocation"`);
  console.log(`  Submitting tx...`);

  const revokeTx = await contract.revokeAttestation(
    TEST_AGENT_HASH, 'Live integration test — confirmed revocation',
  );
  console.log(`  Tx hash: ${revokeTx.hash}`);
  console.log(`  Waiting for confirmation...`);

  const revokeReceipt = await revokeTx.wait();
  console.log(`  ✅ Confirmed in block ${revokeReceipt.blockNumber}`);
  console.log(`  Gas used: ${revokeReceipt.gasUsed.toString()}`);

  // ── Step 5: Confirm revocation ─────────────────────────────────────
  divider('STEP 5 — Confirm Revocation');

  const postAtt = await contract.getAttestation(TEST_AGENT_HASH);
  console.log(`  Revoked:   ${postAtt.revoked}`);
  console.log(`  Is Fresh:  ${postAtt.isFresh}`);
  console.log(`  Score:     ${postAtt.score} (data preserved)`);

  allPass = check('revoked = true', postAtt.revoked, true) && allPass;
  allPass = check('isFresh = false (revoked)', postAtt.isFresh, false) && allPass;

  const postIsAtt = await contract.isAttested(TEST_AGENT_HASH);
  allPass = check('isAttested() = false after revoke', postIsAtt, false) && allPass;

  const postMinScore = await contract.verifyMinScore(TEST_AGENT_HASH, 1);
  allPass = check('verifyMinScore(1) = false after revoke', postMinScore, false) && allPass;

  const postMinTier = await contract.verifyMinTier(TEST_AGENT_HASH, 0);
  allPass = check('verifyMinTier(0) = false after revoke', postMinTier, false) && allPass;

  // ── Summary ────────────────────────────────────────────────────────
  divider('SUMMARY');

  const finalTotal = await contract.totalAttestations();
  const finalAgentCount = await contract.getAttestedAgentCount();

  console.log(`  Total Attestations on contract: ${finalTotal}`);
  console.log(`  Total Attested Agents:          ${finalAgentCount}`);
  console.log(`  Explorer: https://testnet.monadexplorer.com/address/${CONTRACT_ADDRESS}`);
  console.log(`  Publish tx: ${receipt.hash}`);
  console.log(`  Revoke tx:  ${revokeReceipt.hash}`);
  console.log();

  if (allPass) {
    console.log('  ALL CHECKS PASSED — Attestation lifecycle verified on Monad');
  } else {
    console.log('  ⚠️  SOME CHECKS FAILED — review output above');
    process.exit(1);
  }
  console.log();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
