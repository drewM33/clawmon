/**
 * Live Integration Test — SkillPaywall on Sepolia
 *
 * Steps:
 *   1. Connect to deployed contract, read current state
 *   2. Register a skill with tier-based pricing (Standard tier, BBB=5)
 *   3. Verify effective price accounts for tier multiplier
 *   4. Process a payment via payForSkill
 *   5. Verify fee distribution (80% publisher / 10% protocol / 10% insurance)
 *   6. Confirm the payment record is stored on-chain
 */

import { ethers } from "ethers";
import "dotenv/config";

// ── Config ──────────────────────────────────────────────────────────────────

const PAYWALL_ADDRESS = "0x26eC545156B786d2DDf0e82621CC0a7385B3B263";
const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY!;

if (!DEPLOYER_KEY) {
  console.error("ERROR: DEPLOYER_PRIVATE_KEY not set in .env");
  process.exit(1);
}

// Minimal ABI for SkillPaywall (only the functions we need)
const ABI = [
  "function owner() view returns (address)",
  "function protocolTreasury() view returns (address)",
  "function insurancePool() view returns (address)",
  "function nextPaymentId() view returns (uint256)",
  "function totalPaymentsProcessed() view returns (uint256)",
  "function registerSkill(bytes32 agentId, address publisher, uint256 pricePerCall, uint8 trustTier)",
  "function getEffectivePrice(bytes32 agentId) view returns (uint256)",
  "function getSkillPricing(bytes32 agentId) view returns (uint256 pricePerCall, uint8 trustTier, bool active, address publisher, uint256 effectivePrice)",
  "function payForSkill(bytes32 agentId) payable",
  "function getPayment(uint256 paymentId) view returns (uint256 id, bytes32 agentId, address caller, address publisher, uint256 amount, uint256 publisherPayout, uint256 protocolPayout, uint256 insurancePayout, uint256 timestamp)",
  "function getPaymentStats() view returns (uint256 totalPayments, uint256 totalProtocolRevenue, uint256 totalPublisherPayouts, uint256 totalInsuranceContributions, uint256 registeredSkillCount)",
  "function getSkillUsage(bytes32 agentId) view returns (uint256 paymentCount, uint256 totalRevenue)",
  "event SkillRegistered(bytes32 indexed agentId, address indexed publisher, uint256 pricePerCall, uint8 trustTier)",
  "event PaymentProcessed(uint256 indexed paymentId, bytes32 indexed agentId, address indexed caller, uint256 amount, uint256 publisherPayout, uint256 protocolPayout, uint256 insurancePayout)",
];

// ── Tier names ──────────────────────────────────────────────────────────────

const TIER_NAMES: Record<number, string> = {
  0: "C", 1: "CC", 2: "CCC",
  3: "B", 4: "BB", 5: "BBB",
  6: "A", 7: "AA", 8: "AAA",
};

// ── Utilities ───────────────────────────────────────────────────────────────

function hr(title: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(70)}\n`);
}

function fmtEth(wei: bigint): string {
  return `${ethers.formatEther(wei)} ETH (${wei.toString()} wei)`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  hr("LIVE INTEGRATION TEST — SkillPaywall on Sepolia");
  console.log(`  Contract : ${PAYWALL_ADDRESS}`);
  console.log(`  RPC      : ${RPC_URL}`);
  console.log(`  Time     : ${new Date().toISOString()}`);

  // Connect
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const contract = new ethers.Contract(PAYWALL_ADDRESS, ABI, wallet);

  const network = await provider.getNetwork();
  console.log(`  Chain ID : ${network.chainId}`);
  console.log(`  Wallet   : ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance  : ${fmtEth(balance)}`);

  if (balance === 0n) {
    console.error("\nERROR: Wallet has no Sepolia ETH. Need testnet funds.");
    process.exit(1);
  }

  // ── Step 0: Read contract state ──────────────────────────────────────────

  hr("STEP 0 — Contract State (before test)");

  const owner = await contract.owner();
  const treasury = await contract.protocolTreasury();
  const insurance = await contract.insurancePool();
  const statsBefore = await contract.getPaymentStats();

  console.log(`  Owner              : ${owner}`);
  console.log(`  Protocol Treasury  : ${treasury}`);
  console.log(`  Insurance Pool     : ${insurance}`);
  console.log(`  Total Payments     : ${statsBefore[0].toString()}`);
  console.log(`  Protocol Revenue   : ${fmtEth(statsBefore[1])}`);
  console.log(`  Publisher Payouts  : ${fmtEth(statsBefore[2])}`);
  console.log(`  Insurance Contrib  : ${fmtEth(statsBefore[3])}`);
  console.log(`  Registered Skills  : ${statsBefore[4].toString()}`);

  const isOwner = owner.toLowerCase() === wallet.address.toLowerCase();
  console.log(`\n  Wallet is owner?   : ${isOwner ? "YES ✓" : "NO ✗"}`);

  if (!isOwner) {
    console.error("\nERROR: Wallet is not the contract owner — cannot register skills.");
    process.exit(1);
  }

  // ── Step 1: Register a skill with tier-based pricing ─────────────────────

  hr("STEP 1 — Register Skill (Standard tier BBB=5)");

  // Generate a unique agentId using timestamp to avoid collisions
  const skillName = `test-skill-${Date.now()}`;
  const agentId = ethers.keccak256(ethers.toUtf8Bytes(skillName));
  const basePrice = ethers.parseEther("0.001"); // 0.001 ETH base
  const trustTier = 5; // BBB = Standard tier (1.0x multiplier)

  // We use the wallet itself as a publisher (simple for testing)
  // But to properly verify fee distribution, we use a separate publisher address
  // Actually, let's use the deployer as publisher for simplicity
  const publisherAddress = wallet.address;

  console.log(`  Skill Name   : ${skillName}`);
  console.log(`  Agent ID     : ${agentId}`);
  console.log(`  Base Price   : ${fmtEth(basePrice)}`);
  console.log(`  Trust Tier   : ${trustTier} (${TIER_NAMES[trustTier]})`);
  console.log(`  Publisher    : ${publisherAddress}`);
  console.log(`  Expected Multiplier: 1.0x (Standard tier)`);
  console.log(`  Expected Effective Price: ${fmtEth(basePrice)} (0.001 × 1.0)`);

  console.log("\n  Sending registerSkill tx...");
  const regTx = await contract.registerSkill(agentId, publisherAddress, basePrice, trustTier);
  console.log(`  Tx Hash    : ${regTx.hash}`);
  console.log("  Waiting for confirmation...");

  const regReceipt = await regTx.wait();
  console.log(`  Block      : ${regReceipt!.blockNumber}`);
  console.log(`  Gas Used   : ${regReceipt!.gasUsed.toString()}`);
  console.log(`  Status     : ${regReceipt!.status === 1 ? "SUCCESS ✓" : "FAILED ✗"}`);

  // Parse SkillRegistered event
  const regEvent = regReceipt!.logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "SkillRegistered";
    } catch { return false; }
  });
  if (regEvent) {
    const parsed = contract.interface.parseLog({ topics: regEvent.topics as string[], data: regEvent.data });
    console.log(`\n  Event SkillRegistered:`);
    console.log(`    agentId      : ${parsed!.args[0]}`);
    console.log(`    publisher    : ${parsed!.args[1]}`);
    console.log(`    pricePerCall : ${fmtEth(parsed!.args[2])}`);
    console.log(`    trustTier    : ${parsed!.args[3]} (${TIER_NAMES[Number(parsed!.args[3])]})`);
  }

  // ── Step 2: Verify effective price with tier multiplier ──────────────────

  hr("STEP 2 — Verify Tier-Based Pricing");

  const effectivePrice = await contract.getEffectivePrice(agentId);
  const pricing = await contract.getSkillPricing(agentId);

  console.log(`  Stored Base Price  : ${fmtEth(pricing[0])}`);
  console.log(`  Stored Tier        : ${pricing[1]} (${TIER_NAMES[Number(pricing[1])]})`);
  console.log(`  Active             : ${pricing[2]}`);
  console.log(`  Publisher          : ${pricing[3]}`);
  console.log(`  Effective Price    : ${fmtEth(pricing[4])}`);
  console.log(`  getEffectivePrice  : ${fmtEth(effectivePrice)}`);

  // Standard tier (BBB=5) → 1.0x multiplier → effective = base
  const expectedEffective = basePrice; // 1.0x for BBB
  const priceMatch = effectivePrice === expectedEffective;
  console.log(`\n  Expected effective : ${fmtEth(expectedEffective)}`);
  console.log(`  Prices match?      : ${priceMatch ? "YES ✓" : "NO ✗"}`);

  // ── Step 3: Process a payment ────────────────────────────────────────────

  hr("STEP 3 — Process Payment (payForSkill)");

  const paymentAmount = effectivePrice; // Pay exact effective price

  // Capture balances before payment
  const publisherBalBefore = await provider.getBalance(publisherAddress);
  const treasuryBalBefore = await provider.getBalance(treasury);
  const insuranceBalBefore = await provider.getBalance(insurance);
  const nextPayIdBefore = await contract.nextPaymentId();

  console.log(`  Payment Amount     : ${fmtEth(paymentAmount)}`);
  console.log(`  Next Payment ID    : ${nextPayIdBefore.toString()}`);
  console.log(`\n  Balances BEFORE:`);
  console.log(`    Publisher  (${publisherAddress.slice(0, 10)}...) : ${fmtEth(publisherBalBefore)}`);
  console.log(`    Treasury   (${treasury.slice(0, 10)}...)  : ${fmtEth(treasuryBalBefore)}`);
  console.log(`    Insurance  (${insurance.slice(0, 10)}...) : ${fmtEth(insuranceBalBefore)}`);

  console.log("\n  Sending payForSkill tx...");
  const payTx = await contract.payForSkill(agentId, { value: paymentAmount });
  console.log(`  Tx Hash    : ${payTx.hash}`);
  console.log("  Waiting for confirmation...");

  const payReceipt = await payTx.wait();
  console.log(`  Block      : ${payReceipt!.blockNumber}`);
  console.log(`  Gas Used   : ${payReceipt!.gasUsed.toString()}`);
  console.log(`  Status     : ${payReceipt!.status === 1 ? "SUCCESS ✓" : "FAILED ✗"}`);

  // Parse PaymentProcessed event
  const payEvent = payReceipt!.logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "PaymentProcessed";
    } catch { return false; }
  });

  let eventAmount = 0n;
  let eventPublisherPayout = 0n;
  let eventProtocolPayout = 0n;
  let eventInsurancePayout = 0n;
  let eventPaymentId = 0n;

  if (payEvent) {
    const parsed = contract.interface.parseLog({ topics: payEvent.topics as string[], data: payEvent.data });
    // Indexed: args[0]=paymentId, args[1]=agentId, args[2]=caller
    // Non-indexed: args[3]=amount, args[4]=publisherPayout, args[5]=protocolPayout, args[6]=insurancePayout
    eventPaymentId = parsed!.args[0];
    eventAmount = parsed!.args[3];
    eventPublisherPayout = parsed!.args[4];
    eventProtocolPayout = parsed!.args[5];
    eventInsurancePayout = parsed!.args[6];

    console.log(`\n  Event PaymentProcessed:`);
    console.log(`    paymentId        : ${eventPaymentId.toString()}`);
    console.log(`    agentId          : ${parsed!.args[1]}`);
    console.log(`    caller           : ${parsed!.args[2]}`);
    console.log(`    amount           : ${fmtEth(eventAmount)}`);
    console.log(`    publisherPayout  : ${fmtEth(eventPublisherPayout)}`);
    console.log(`    protocolPayout   : ${fmtEth(eventProtocolPayout)}`);
    console.log(`    insurancePayout  : ${fmtEth(eventInsurancePayout)}`);
  }

  // ── Step 4: Verify fee distribution (80/10/10) ──────────────────────────

  hr("STEP 4 — Verify Fee Distribution (80% / 10% / 10%)");

  const expectedPublisher = (paymentAmount * 8000n) / 10000n;
  const expectedProtocol = (paymentAmount * 1000n) / 10000n;
  const expectedInsurance = paymentAmount - expectedPublisher - expectedProtocol;

  console.log(`  Payment Amount       : ${fmtEth(paymentAmount)}`);
  console.log(`\n  Expected splits:`);
  console.log(`    Publisher  (80%)   : ${fmtEth(expectedPublisher)}`);
  console.log(`    Protocol   (10%)   : ${fmtEth(expectedProtocol)}`);
  console.log(`    Insurance  (10%)   : ${fmtEth(expectedInsurance)}`);
  console.log(`    Sum                : ${fmtEth(expectedPublisher + expectedProtocol + expectedInsurance)}`);

  console.log(`\n  Event payouts:`);
  console.log(`    Publisher          : ${fmtEth(eventPublisherPayout)}`);
  console.log(`    Protocol           : ${fmtEth(eventProtocolPayout)}`);
  console.log(`    Insurance          : ${fmtEth(eventInsurancePayout)}`);

  const pubMatch = eventPublisherPayout === expectedPublisher;
  const proMatch = eventProtocolPayout === expectedProtocol;
  const insMatch = eventInsurancePayout === expectedInsurance;

  console.log(`\n  Publisher payout correct?  : ${pubMatch ? "YES ✓" : "NO ✗"}`);
  console.log(`  Protocol payout correct?  : ${proMatch ? "YES ✓" : "NO ✗"}`);
  console.log(`  Insurance payout correct? : ${insMatch ? "YES ✓" : "NO ✗"}`);

  // Cross-check: verify via on-chain payment record (stored in contract)
  const recordCheck = await contract.getPayment(nextPayIdBefore);
  const recordPubPayout = recordCheck[5];
  const recordProPayout = recordCheck[6];
  const recordInsPayout = recordCheck[7];

  console.log(`\n  On-chain payment record verification:`);
  console.log(`    Record publisher payout  : ${fmtEth(recordPubPayout)}`);
  console.log(`    Record protocol payout   : ${fmtEth(recordProPayout)}`);
  console.log(`    Record insurance payout  : ${fmtEth(recordInsPayout)}`);

  const recordPubOk = recordPubPayout === expectedPublisher;
  const recordProOk = recordProPayout === expectedProtocol;
  const recordInsOk = recordInsPayout === expectedInsurance;
  console.log(`    Record pub matches 80%?  : ${recordPubOk ? "YES ✓" : "NO ✗"}`);
  console.log(`    Record pro matches 10%?  : ${recordProOk ? "YES ✓" : "NO ✗"}`);
  console.log(`    Record ins matches 10%?  : ${recordInsOk ? "YES ✓" : "NO ✗"}`);

  // Note: Publisher, Treasury, and Insurance are all the deployer address in this deploy,
  // so individual ETH balance deltas are not meaningful. We verify via stored records instead.
  // ── Step 5: Confirm payment record stored on-chain ───────────────────────

  hr("STEP 5 — Verify Payment Record On-Chain");

  const paymentId = nextPayIdBefore; // The payment ID we just created
  const record = await contract.getPayment(paymentId);

  console.log(`  Payment ID         : ${record[0].toString()}`);
  console.log(`  Agent ID           : ${record[1]}`);
  console.log(`  Caller             : ${record[2]}`);
  console.log(`  Publisher          : ${record[3]}`);
  console.log(`  Amount             : ${fmtEth(record[4])}`);
  console.log(`  Publisher Payout   : ${fmtEth(record[5])}`);
  console.log(`  Protocol Payout    : ${fmtEth(record[6])}`);
  console.log(`  Insurance Payout   : ${fmtEth(record[7])}`);
  console.log(`  Timestamp          : ${record[8].toString()} (${new Date(Number(record[8]) * 1000).toISOString()})`);

  const recordAgentMatch = record[1] === agentId;
  const recordCallerMatch = record[2].toLowerCase() === wallet.address.toLowerCase();
  const recordAmountMatch = record[4] === paymentAmount;

  console.log(`\n  Agent ID matches?  : ${recordAgentMatch ? "YES ✓" : "NO ✗"}`);
  console.log(`  Caller matches?    : ${recordCallerMatch ? "YES ✓" : "NO ✗"}`);
  console.log(`  Amount matches?    : ${recordAmountMatch ? "YES ✓" : "NO ✗"}`);

  // ── Step 6: Verify aggregate stats updated ───────────────────────────────

  hr("STEP 6 — Aggregate Stats (after test)");

  const statsAfter = await contract.getPaymentStats();
  const usage = await contract.getSkillUsage(agentId);

  console.log(`  Total Payments     : ${statsBefore[0].toString()} → ${statsAfter[0].toString()}`);
  console.log(`  Protocol Revenue   : ${fmtEth(statsBefore[1])} → ${fmtEth(statsAfter[1])}`);
  console.log(`  Publisher Payouts  : ${fmtEth(statsBefore[2])} → ${fmtEth(statsAfter[2])}`);
  console.log(`  Insurance Contrib  : ${fmtEth(statsBefore[3])} → ${fmtEth(statsAfter[3])}`);
  console.log(`  Registered Skills  : ${statsBefore[4].toString()} → ${statsAfter[4].toString()}`);
  console.log(`\n  Skill Usage (this skill):`);
  console.log(`    Payment Count    : ${usage[0].toString()}`);
  console.log(`    Total Revenue    : ${fmtEth(usage[1])}`);

  const paymentCountUp = statsAfter[0] === statsBefore[0] + 1n;
  const skillCountUp = statsAfter[4] === statsBefore[4] + 1n;
  console.log(`\n  Payment count +1?  : ${paymentCountUp ? "YES ✓" : "NO ✗"}`);
  console.log(`  Skill count +1?    : ${skillCountUp ? "YES ✓" : "NO ✗"}`);

  // ── Summary ──────────────────────────────────────────────────────────────

  hr("TEST SUMMARY");

  const allChecks = [
    ["Skill registered on-chain", true],
    ["Effective price = base × tier multiplier", priceMatch],
    ["Payment processed successfully", payReceipt!.status === 1],
    ["Publisher payout = 80%", pubMatch],
    ["Protocol payout = 10%", proMatch],
    ["Insurance payout = 10%", insMatch],
    ["Record publisher payout = 80%", recordPubOk],
    ["Record protocol payout = 10%", recordProOk],
    ["Record insurance payout = 10%", recordInsOk],
    ["Payment record stored on-chain", recordAgentMatch && recordCallerMatch && recordAmountMatch],
    ["Aggregate stats updated", paymentCountUp && skillCountUp],
  ] as const;

  let passed = 0;
  let failed = 0;

  for (const [name, ok] of allChecks) {
    const status = ok ? "PASS ✓" : "FAIL ✗";
    console.log(`  [${status}] ${name}`);
    if (ok) passed++; else failed++;
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${allChecks.length} checks`);
  console.log(`${"═".repeat(70)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  process.exit(1);
});
