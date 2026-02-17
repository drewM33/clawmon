/**
 * Trusted ClawMon — TEE Attestation Tests (Phase 8)
 *
 * Comprehensive tests for the TEE attestation module:
 *   1. Enclave: keypair generation, report signing, signature verification
 *   2. Verifier: full verification pipeline, behavior analysis, freshness
 *   3. Service: attestation submission, state management, statistics
 *   4. Scoring integration: TEE trust weight impact on scores
 *   5. API: endpoint correctness
 *
 * Run: npx tsx scripts/test-tee.ts
 */

import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { SimulatedEnclave, generateCodeHash, generateSimulatedReport, getEnclave } from '../src/tee/enclave.js';
import { TEEVerifier, computeTEETrustWeight } from '../src/tee/verifier.js';
import {
  pinCodeHash,
  submitAttestation,
  generateAndSubmitAttestation,
  getTEEAgentState,
  getAllTEEAgentStates,
  getAgentAttestations,
  getLatestVerification,
  getCodeHashPin,
  getTEETrustWeight,
  buildTEEAgentResponse,
  buildTEEOverviewItem,
  computeTEEStats,
  seedSimulatedTEE,
} from '../src/tee/service.js';
import { DEFAULT_TEE_CONFIG } from '../src/tee/types.js';
import type { TEEVerificationResult, RuntimeReport } from '../src/tee/types.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let testNum = 0;

function assert(condition: boolean, message: string): void {
  testNum++;
  if (condition) {
    console.log(`  \u2713 Test ${testNum}: ${message}`);
    passed++;
  } else {
    console.error(`  \u2717 Test ${testNum}: ${message}`);
    failed++;
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, message: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message} (got ${actual}, expected ~${expected})`);
}

function section(name: string): void {
  console.log(`\n--- ${name} ---`);
}

// ---------------------------------------------------------------------------
// 1. Enclave Tests
// ---------------------------------------------------------------------------

async function testEnclave(): Promise<void> {
  section('1. SimulatedEnclave');

  const enclave = new SimulatedEnclave('simulated');

  // Test: keypair generation
  const pubKey = enclave.getPublicKey();
  assert(typeof pubKey === 'string' && pubKey.length > 0, 'Public key is non-empty string');
  assert(pubKey.length > 50, `Public key has reasonable length (${pubKey.length} chars)`);

  // Test: enclave ID generation
  const enclaveId = enclave.getEnclaveId();
  assert(enclaveId.startsWith('enclave-'), 'Enclave ID has correct prefix');
  assert(enclaveId.length > 10, 'Enclave ID has reasonable length');

  // Test: platform type
  assert(enclave.getPlatformType() === 'simulated', 'Platform type is simulated');

  // Test: sign a report
  const report: RuntimeReport = {
    agentId: 'test-agent',
    codeHash: generateCodeHash('test-agent'),
    executionTimeMs: 500,
    apiCallsMade: ['api.example.com/v1/data'],
    dataAccessed: ['user.email'],
    errors: [],
    peakMemoryBytes: 50_000_000,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };

  const attestation = await enclave.signReport(report);
  assert(attestation.id.startsWith('tee-att-'), 'Attestation ID has correct prefix');
  assert(attestation.signature.length > 0, 'Signature is non-empty');
  assert(attestation.publicKey === pubKey, 'Attestation contains enclave public key');
  assert(attestation.enclaveId === enclaveId, 'Attestation contains enclave ID');
  assert(attestation.platformType === 'simulated', 'Attestation has correct platform type');
  assert(attestation.attestationHash.length === 64, 'Attestation hash is SHA-256 hex');
  assert(attestation.report === report, 'Attestation contains the original report');

  // Test: verify valid signature
  const valid = await enclave.verifySignature(attestation);
  assert(valid === true, 'Valid signature verifies correctly');

  // Test: tampered report fails verification
  const tampered = { ...attestation, report: { ...attestation.report, executionTimeMs: 999 } };
  const tamperedValid = await enclave.verifySignature(tampered);
  assert(tamperedValid === false, 'Tampered report fails verification');

  // Test: wrong public key fails verification
  const otherEnclave = new SimulatedEnclave('simulated');
  const wrongKeyValid = await otherEnclave.verifySignature(attestation);
  assert(wrongKeyValid === false, 'Wrong enclave rejects signature');

  // Test: multiple signatures are unique
  const att2 = await enclave.signReport({ ...report, nonce: randomBytes(16).toString('hex') });
  assert(att2.signature !== attestation.signature, 'Different nonces produce different signatures');
  assert(att2.id !== attestation.id, 'Different attestations get unique IDs');
}

// ---------------------------------------------------------------------------
// 2. Verifier Tests
// ---------------------------------------------------------------------------

async function testVerifier(): Promise<void> {
  section('2. TEEVerifier');

  const enclave = new SimulatedEnclave('simulated');
  const verifier = new TEEVerifier(enclave);

  const codeHash = generateCodeHash('verifier-test');

  // Pin the code hash
  const pin = {
    agentId: 'verifier-test',
    codeHash,
    pinnedAt: Math.floor(Date.now() / 1000),
    pinnedBy: 'publisher:verifier-test',
  };

  // Test: fully valid attestation
  const report: RuntimeReport = {
    agentId: 'verifier-test',
    codeHash,
    executionTimeMs: 200,
    apiCallsMade: ['api.safe.com/v1/data'],
    dataAccessed: ['user.email'],
    errors: [],
    peakMemoryBytes: 30_000_000,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };

  const attestation = await enclave.signReport(report);
  const result = await verifier.verify(attestation, pin);

  assert(result.signatureValid === true, 'Signature validation passes');
  assert(result.codeHashMatch === true, 'Code hash matches pin');
  assert(result.platformVerified === true, 'Platform verified');
  assert(result.reportFresh === true, 'Report is fresh');
  assert(result.behaviorClean === true, 'Behavior is clean');
  assert(result.tier3Eligible === true, 'Tier 3 eligible (all checks pass)');
  assert(result.valid === true, 'Overall valid');
  assert(result.notes.length > 0, 'Verification notes are populated');

  // Test: code hash mismatch
  const mismatchReport: RuntimeReport = {
    ...report,
    codeHash: generateCodeHash('different-agent'),
    nonce: randomBytes(16).toString('hex'),
  };
  const mismatchAtt = await enclave.signReport(mismatchReport);
  const mismatchResult = await verifier.verify(mismatchAtt, pin);

  assert(mismatchResult.signatureValid === true, 'Mismatch: signature still valid');
  assert(mismatchResult.codeHashMatch === false, 'Mismatch: code hash does not match');
  assert(mismatchResult.tier3Eligible === false, 'Mismatch: not Tier 3 eligible');

  // Test: no pin registered
  const noPinResult = await verifier.verify(attestation, null);
  assert(noPinResult.codeHashMatch === false, 'No pin: code hash check fails');
  assert(noPinResult.tier3Eligible === false, 'No pin: not Tier 3 eligible');

  // Test: stale report
  const staleReport: RuntimeReport = {
    ...report,
    timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
    nonce: randomBytes(16).toString('hex'),
  };
  const staleAtt = await enclave.signReport(staleReport);
  const staleResult = await verifier.verify(staleAtt, pin);

  assert(staleResult.reportFresh === false, 'Stale: report is not fresh');
  assert(staleResult.tier3Eligible === false, 'Stale: not Tier 3 eligible');

  // Test: suspicious behavior (many API calls)
  const suspiciousReport: RuntimeReport = {
    ...report,
    apiCallsMade: Array.from({ length: 60 }, (_, i) => `api.example.com/endpoint${i}`),
    nonce: randomBytes(16).toString('hex'),
  };
  const suspiciousAtt = await enclave.signReport(suspiciousReport);
  const suspiciousResult = await verifier.verify(suspiciousAtt, pin);

  assert(suspiciousResult.behaviorClean === false, 'Suspicious: behavior flagged');
  assert(suspiciousResult.tier3Eligible === false, 'Suspicious: not Tier 3 eligible');
  assert(suspiciousResult.valid === true, 'Suspicious: still valid (just not clean behavior)');

  // Test: credential access flagged
  const credReport: RuntimeReport = {
    ...report,
    dataAccessed: ['user.credentials', 'env.variables'],
    nonce: randomBytes(16).toString('hex'),
  };
  const credAtt = await enclave.signReport(credReport);
  const credResult = await verifier.verify(credAtt, pin);

  assert(credResult.behaviorClean === false, 'Credential access: behavior flagged');

  // Test: future timestamp rejected
  const futureReport: RuntimeReport = {
    ...report,
    timestamp: Date.now() + 60_000, // 1 minute in future
    nonce: randomBytes(16).toString('hex'),
  };
  const futureAtt = await enclave.signReport(futureReport);
  const futureResult = await verifier.verify(futureAtt, pin);

  assert(futureResult.reportFresh === false, 'Future timestamp: not fresh');
}

// ---------------------------------------------------------------------------
// 3. Trust Weight Tests
// ---------------------------------------------------------------------------

function testTrustWeight(): void {
  section('3. Trust Weight Computation');

  // Tier 3 eligible → boost
  const tier3Result: TEEVerificationResult = {
    valid: true,
    signatureValid: true,
    codeHashMatch: true,
    platformVerified: true,
    reportFresh: true,
    behaviorClean: true,
    tier3Eligible: true,
    notes: [],
  };
  assert(computeTEETrustWeight(tier3Result) === 1.5, 'Tier 3 eligible gets 1.5x weight');

  // Valid but not Tier 3 → neutral
  const validNotTier3: TEEVerificationResult = {
    ...tier3Result,
    codeHashMatch: false,
    tier3Eligible: false,
  };
  assert(computeTEETrustWeight(validNotTier3) === 1.0, 'Valid but not Tier 3 gets 1.0x weight');

  // Invalid → penalty
  const invalid: TEEVerificationResult = {
    ...tier3Result,
    valid: false,
    signatureValid: false,
    tier3Eligible: false,
  };
  assert(computeTEETrustWeight(invalid) === 0.8, 'Invalid attestation gets 0.8x weight');

  // No attestation → neutral
  assert(computeTEETrustWeight(null) === 1.0, 'No attestation gets 1.0x weight');

  // Custom config
  const customConfig = { ...DEFAULT_TEE_CONFIG, verifiedTrustWeight: 2.0 };
  assert(computeTEETrustWeight(tier3Result, customConfig) === 2.0, 'Custom config respected');
}

// ---------------------------------------------------------------------------
// 4. Service Tests
// ---------------------------------------------------------------------------

async function testService(): Promise<void> {
  section('4. TEE Service');

  // Test: pin code hash
  const pin = pinCodeHash('service-test', 'abc123', 'publisher:test', 'audit-ref');
  assert(pin.agentId === 'service-test', 'Pin has correct agent ID');
  assert(pin.codeHash === 'abc123', 'Pin has correct code hash');
  assert(pin.pinnedBy === 'publisher:test', 'Pin has correct publisher');
  assert(pin.auditReference === 'audit-ref', 'Pin has audit reference');

  // Test: retrieve pinned hash
  const retrieved = getCodeHashPin('service-test');
  assert(retrieved !== null, 'Can retrieve pinned hash');
  assert(retrieved!.codeHash === 'abc123', 'Retrieved hash matches');

  // Test: generate and submit attestation
  const codeHash = generateCodeHash('service-test');
  pinCodeHash('service-test', codeHash, 'publisher:test');

  const result = await generateAndSubmitAttestation('service-test', {
    flagged: false,
    isSybil: false,
    category: 'developer',
    codeHash,
  });

  assert(result.attestation.report.agentId === 'service-test', 'Attestation has correct agent ID');
  assert(result.verification.signatureValid === true, 'Verification passes');

  // Test: agent state is tracked
  const state = getTEEAgentState('service-test');
  assert(state !== null, 'Agent state exists after submission');
  assert(state!.attestationCount === 1, 'Attestation count is 1');
  assert(state!.latestAttestation !== null, 'Latest attestation is stored');

  // Test: trust weight is set
  const weight = getTEETrustWeight('service-test');
  assert(weight > 0, 'Trust weight is positive');

  // Test: attestation history
  const history = getAgentAttestations('service-test');
  assert(history.length === 1, 'One attestation in history');

  // Test: verification result stored
  const verification = getLatestVerification('service-test');
  assert(verification !== null, 'Latest verification is stored');

  // Test: second attestation increments count
  await generateAndSubmitAttestation('service-test', { codeHash });
  const state2 = getTEEAgentState('service-test');
  assert(state2!.attestationCount === 2, 'Attestation count incremented to 2');

  // Test: API response builders
  const agentResponse = buildTEEAgentResponse('service-test');
  assert(agentResponse.agentId === 'service-test', 'Agent response has correct ID');
  assert(agentResponse.attestationCount === 2, 'Agent response has correct count');
  assert(agentResponse.latestAttestation !== null, 'Agent response has latest attestation');

  const overviewItem = buildTEEOverviewItem('service-test');
  assert(overviewItem.agentId === 'service-test', 'Overview item has correct ID');
  assert(overviewItem.codeHash !== null, 'Overview item has code hash');

  // Test: non-existent agent
  const noAgent = getTEEAgentState('non-existent');
  assert(noAgent === null, 'Non-existent agent returns null');
  assert(getTEETrustWeight('non-existent') === 1.0, 'Non-existent agent has neutral weight');
}

// ---------------------------------------------------------------------------
// 5. Seeding + Stats Tests
// ---------------------------------------------------------------------------

async function testSeedingAndStats(): Promise<void> {
  section('5. Seeding & Statistics');

  const agents = [
    { agentId: 'good-1', score: 85, tier: 'AA', feedbackCount: 30, flagged: false, isSybil: false, category: 'developer', isStaked: true },
    { agentId: 'good-2', score: 92, tier: 'AAA', feedbackCount: 50, flagged: false, isSybil: false, category: 'ai', isStaked: true },
    { agentId: 'flagged-1', score: 45, tier: 'BB', feedbackCount: 20, flagged: true, isSybil: false, category: 'finance', isStaked: false },
    { agentId: 'sybil-1', score: 90, tier: 'AAA', feedbackCount: 25, flagged: false, isSybil: true, category: 'utility', isStaked: false },
    { agentId: 'lowscore', score: 25, tier: 'CC', feedbackCount: 5, flagged: false, isSybil: false, category: 'misc', isStaked: false },
  ];

  await seedSimulatedTEE(agents);

  // Sybils should be skipped
  assert(getTEEAgentState('sybil-1') === null, 'Sybil agents are skipped during seeding');

  // Good agents should be seeded
  const good1 = getTEEAgentState('good-1');
  assert(good1 !== null, 'Good agent 1 is seeded');

  const good2 = getTEEAgentState('good-2');
  assert(good2 !== null, 'Good agent 2 is seeded');

  // Flagged agents should have code hash mismatch (since we use different version)
  const flagged1 = getTEEAgentState('flagged-1');
  assert(flagged1 !== null, 'Flagged agent is seeded');
  if (flagged1) {
    assert(
      flagged1.latestVerification?.codeHashMatch === false,
      'Flagged agent has code hash mismatch',
    );
  }

  // Stats computation
  const allIds = agents.map(a => a.agentId);
  const stats = computeTEEStats(allIds);

  assert(stats.totalRegistered > 0, `Total registered: ${stats.totalRegistered}`);
  assert(stats.totalAttestations > 0, `Total attestations: ${stats.totalAttestations}`);
  assert(stats.unregisteredCount >= 1, `At least 1 unregistered (sybil): ${stats.unregisteredCount}`);
  assert(stats.enclavePublicKey.length > 0, 'Enclave public key in stats');
  assert(stats.platformType === 'simulated', 'Platform type is simulated');

  // All states combined
  const allStates = getAllTEEAgentStates();
  assert(allStates.size > 0, `All states map has ${allStates.size} entries`);
}

// ---------------------------------------------------------------------------
// 6. Code Hash Generation Tests
// ---------------------------------------------------------------------------

function testCodeHashGeneration(): void {
  section('6. Code Hash Generation');

  const hash1 = generateCodeHash('agent-a');
  const hash2 = generateCodeHash('agent-b');
  const hash1Again = generateCodeHash('agent-a');
  const hash1v2 = generateCodeHash('agent-a', 2);

  assert(hash1.length === 64, 'Code hash is SHA-256 hex (64 chars)');
  assert(hash1 !== hash2, 'Different agents produce different hashes');
  assert(hash1 === hash1Again, 'Same agent produces deterministic hash');
  assert(hash1 !== hash1v2, 'Different versions produce different hashes');
}

// ---------------------------------------------------------------------------
// 7. Simulated Report Generation Tests
// ---------------------------------------------------------------------------

function testReportGeneration(): void {
  section('7. Report Generation');

  const normalReport = generateSimulatedReport('normal-agent', 'hash123', {
    flagged: false,
    isSybil: false,
    category: 'developer',
  });

  assert(normalReport.agentId === 'normal-agent', 'Normal report has correct agent ID');
  assert(normalReport.codeHash === 'hash123', 'Normal report has correct code hash');
  assert(normalReport.executionTimeMs >= 100, 'Normal report has reasonable exec time');
  assert(normalReport.executionTimeMs <= 3000, 'Normal report exec time is bounded');
  assert(normalReport.apiCallsMade.length >= 1, 'Normal report has API calls');
  assert(normalReport.apiCallsMade.length <= 8, 'Normal report API calls are bounded');
  assert(normalReport.nonce.length === 32, 'Report has 16-byte nonce (32 hex chars)');
  assert(normalReport.timestamp > 0, 'Report has timestamp');

  const flaggedReport = generateSimulatedReport('malicious-agent', 'hash456', {
    flagged: true,
    isSybil: false,
  });

  assert(flaggedReport.apiCallsMade.length >= 15, 'Flagged report has many API calls');
  assert(flaggedReport.executionTimeMs >= 5000, 'Flagged report has longer exec time');
  assert(
    flaggedReport.dataAccessed.includes('user.credentials'),
    'Flagged report accesses credentials',
  );
}

// ---------------------------------------------------------------------------
// 8. End-to-End: Full Attestation Flow
// ---------------------------------------------------------------------------

async function testEndToEnd(): Promise<void> {
  section('8. End-to-End Flow');

  // Use the singleton enclave (same one the service uses)
  const enclave = getEnclave();
  const verifier = new TEEVerifier(enclave);

  // Step 1: Publisher pins code hash
  const agentId = 'e2e-agent';
  const codeHash = generateCodeHash(agentId);
  const pin = pinCodeHash(agentId, codeHash, 'publisher:e2e');

  // Step 2: Agent runs in TEE, produces runtime report
  const report = generateSimulatedReport(agentId, codeHash, { flagged: false });

  // Step 3: Enclave signs the report
  const attestation = await enclave.signReport(report);

  // Step 4: Verifier checks the attestation
  const result = await verifier.verify(attestation, pin);

  // Step 5: Check all fields
  assert(result.signatureValid, 'E2E: signature valid');
  assert(result.codeHashMatch, 'E2E: code hash matches');
  assert(result.platformVerified, 'E2E: platform verified');
  assert(result.reportFresh, 'E2E: report fresh');
  assert(result.valid, 'E2E: overall valid');

  // Step 6: Submit to service (uses the same singleton enclave for verification)
  const submitted = await submitAttestation(attestation);
  assert(submitted.verification.signatureValid, 'E2E: service signature valid');

  // Step 7: Query state
  const state = getTEEAgentState(agentId);
  assert(state !== null, 'E2E: state exists');
  assert(state!.attestationCount >= 1, 'E2E: attestation count tracked');

  console.log('\n  E2E flow: publisher pins code hash -> agent runs in TEE -> report signed -> verified -> state tracked');
}

// ---------------------------------------------------------------------------
// Run All Tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== Trusted ClawMon — TEE Attestation Tests (Phase 8) ===\n');

  try {
    await testEnclave();
    await testVerifier();
    testTrustWeight();
    await testService();
    await testSeedingAndStats();
    testCodeHashGeneration();
    testReportGeneration();
    await testEndToEnd();
  } catch (err) {
    console.error('\n\u2717 UNEXPECTED ERROR:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);

  if (failed > 0) {
    console.error('\nSome tests FAILED!');
    process.exit(1);
  } else {
    console.log('\nAll tests PASSED!');
  }
}

main();
