/**
 * InsurancePool — Live Integration Test on Sepolia
 *
 * Runs a full lifecycle against the deployed InsurancePool contract:
 *   1. Check initial pool state (should be empty)
 *   2. Deposit ETH into the pool
 *   3. Mark an agent as slashed
 *   4. Submit a claim against the slashed agent
 *   5. Approve the claim (owner fast-path)
 *   6. Verify payout was received and pool balance decreased
 *   7. Submit and reject a second claim
 *   8. Verify final pool stats
 *
 * Usage:
 *   node scripts/test-insurance-live.cjs
 */

const { ethers } = require("ethers");
require("dotenv/config");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.INSURANCE_CONTRACT_ADDRESS;

if (!DEPLOYER_KEY) {
  console.error("Missing DEPLOYER_PRIVATE_KEY in .env");
  process.exit(1);
}
if (!CONTRACT_ADDRESS) {
  console.error("Missing INSURANCE_CONTRACT_ADDRESS in .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ABI (all functions we need)
// ---------------------------------------------------------------------------

const INSURANCE_ABI = [
  "function poolBalance() view returns (uint256)",
  "function totalDeposited() view returns (uint256)",
  "function totalPaidOut() view returns (uint256)",
  "function nextClaimId() view returns (uint256)",
  "function deposit() payable",
  "function markAgentSlashed(bytes32 agentId)",
  "function submitClaim(bytes32 agentId, uint256 lossAmount, bytes32 evidenceHash)",
  "function approveClaim(uint256 claimId)",
  "function rejectClaim(uint256 claimId)",
  "function voteClaim(uint256 claimId, bool approve)",
  "function getClaim(uint256 claimId) view returns (uint256 id, address claimant, bytes32 agentId, uint256 amount, bytes32 evidenceHash, uint256 submittedAt, uint8 status, uint256 payoutAmount, uint256 paidAt, uint256 approveVotes, uint256 rejectVotes)",
  "function getPoolStats() view returns (uint256 _poolBalance, uint256 _totalDeposited, uint256 _totalPaidOut, uint256 _totalClaims, uint256 _pendingClaims, uint256 _approvedClaims, uint256 _rejectedClaims, uint256 _paidClaims)",
  "function isAgentSlashed(bytes32 agentId) view returns (bool)",
  "function getClaimCount() view returns (uint256)",
  "receive() payable",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_NAMES = ["Pending", "Approved", "Rejected", "Paid"];

function fmt(wei) {
  return ethers.formatEther(wei);
}

let passCount = 0;
let failCount = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: ${label}`);
    failCount++;
  }
}

async function waitForTx(tx, label) {
  process.stdout.write(`  ⏳ ${label}...`);
  const receipt = await tx.wait();
  console.log(` confirmed (gas: ${receipt.gasUsed.toString()})`);
  return receipt;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  InsurancePool — Live Sepolia Integration Test            ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const pool = new ethers.Contract(CONTRACT_ADDRESS, INSURANCE_ABI, deployer);

  console.log(`  Contract:  ${CONTRACT_ADDRESS}`);
  console.log(`  Deployer:  ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`  Balance:   ${fmt(balance)} ETH`);
  console.log("");

  // Test agent IDs
  const SLASHED_AGENT = ethers.id("what-would-elon-do");
  const CLEAN_AGENT = ethers.id("gmail-integration");
  const EVIDENCE = ethers.id("ipfs://evidence-credential-leak-proof");
  const DEPOSIT = ethers.parseEther("0.01");
  const CLAIM_AMOUNT = ethers.parseEther("0.003");
  const CLAIM_AMOUNT_2 = ethers.parseEther("0.002");

  // ═══ Step 1: Check initial pool state ═══
  console.log("═══ Step 1: Initial Pool State ═══\n");

  const initialBalance = await pool.poolBalance();
  const initialDeposited = await pool.totalDeposited();
  const initialPaid = await pool.totalPaidOut();
  const initialClaimCount = await pool.getClaimCount();

  console.log(`  Pool balance:    ${fmt(initialBalance)} ETH`);
  console.log(`  Total deposited: ${fmt(initialDeposited)} ETH`);
  console.log(`  Total paid out:  ${fmt(initialPaid)} ETH`);
  console.log(`  Claim count:     ${initialClaimCount.toString()}`);
  console.log("");

  // ═══ Step 2: Deposit ETH into the pool ═══
  console.log("═══ Step 2: Deposit 0.01 ETH into Pool ═══\n");

  const depositTx = await pool.deposit({ value: DEPOSIT });
  await waitForTx(depositTx, "Depositing 0.01 ETH");

  const afterDepositBalance = await pool.poolBalance();
  console.log(`  Pool balance after deposit: ${fmt(afterDepositBalance)} ETH`);

  assert(
    afterDepositBalance === initialBalance + DEPOSIT,
    `Pool balance increased by exactly 0.01 ETH (${fmt(initialBalance)} → ${fmt(afterDepositBalance)})`
  );
  console.log("");

  // ═══ Step 3: Mark agent as slashed ═══
  console.log("═══ Step 3: Mark Agent as Slashed ═══\n");

  const slashTx = await pool.markAgentSlashed(SLASHED_AGENT);
  await waitForTx(slashTx, "Marking 'what-would-elon-do' as slashed");

  const isSlashed = await pool.isAgentSlashed(SLASHED_AGENT);
  const isCleanSlashed = await pool.isAgentSlashed(CLEAN_AGENT);

  assert(isSlashed === true, "'what-would-elon-do' is marked slashed");
  assert(isCleanSlashed === false, "'gmail-integration' is NOT marked slashed");
  console.log("");

  // ═══ Step 4: Submit a claim ═══
  console.log("═══ Step 4: Submit Claim (0.003 ETH) ═══\n");

  const nextId = await pool.nextClaimId();
  const claimTx = await pool.submitClaim(SLASHED_AGENT, CLAIM_AMOUNT, EVIDENCE);
  await waitForTx(claimTx, "Submitting claim #" + nextId.toString());

  const claim = await pool.getClaim(nextId);
  console.log(`  Claim #${claim.id}: ${fmt(claim.amount)} ETH — Status: ${STATUS_NAMES[Number(claim.status)]}`);

  assert(claim.claimant === deployer.address, "Claimant is deployer address");
  assert(claim.amount === CLAIM_AMOUNT, "Claim amount is 0.003 ETH");
  assert(Number(claim.status) === 0, "Claim status is Pending");
  assert(claim.agentId === SLASHED_AGENT, "Claim is against slashed agent");

  const balanceAfterClaim = await pool.poolBalance();
  assert(balanceAfterClaim === afterDepositBalance, "Pool balance unchanged after claim submission");
  console.log("");

  // ═══ Step 5: Approve the claim (owner fast-path) ═══
  console.log("═══ Step 5: Approve Claim & Execute Payout ═══\n");

  const deployerBalanceBefore = await provider.getBalance(deployer.address);

  const approveTx = await pool.approveClaim(nextId);
  const approveReceipt = await waitForTx(approveTx, "Approving claim #" + nextId.toString());

  const claimAfterApproval = await pool.getClaim(nextId);
  console.log(`  Claim #${claimAfterApproval.id}: Status: ${STATUS_NAMES[Number(claimAfterApproval.status)]}, Payout: ${fmt(claimAfterApproval.payoutAmount)} ETH`);

  assert(Number(claimAfterApproval.status) === 3, "Claim status is Paid");
  assert(claimAfterApproval.payoutAmount === CLAIM_AMOUNT, "Payout equals claimed amount (within pool cap)");
  assert(claimAfterApproval.paidAt > 0n, "paidAt timestamp is set");

  const poolAfterPayout = await pool.poolBalance();
  console.log(`  Pool balance after payout: ${fmt(poolAfterPayout)} ETH`);

  assert(
    poolAfterPayout === afterDepositBalance - CLAIM_AMOUNT,
    `Pool decreased by claim amount (${fmt(afterDepositBalance)} − ${fmt(CLAIM_AMOUNT)} = ${fmt(poolAfterPayout)})`
  );

  // Net balance change for deployer: received payout but paid gas
  const deployerBalanceAfter = await provider.getBalance(deployer.address);
  const gasCost = approveReceipt.gasUsed * approveReceipt.gasPrice;
  const expectedNet = deployerBalanceBefore + CLAIM_AMOUNT - gasCost;
  assert(
    deployerBalanceAfter === expectedNet,
    `Deployer received payout: net change = +${fmt(CLAIM_AMOUNT)} − gas ${fmt(gasCost)}`
  );
  console.log("");

  // ═══ Step 6: Submit and reject a second claim ═══
  console.log("═══ Step 6: Submit & Reject a Second Claim ═══\n");

  const nextId2 = await pool.nextClaimId();
  const claim2Tx = await pool.submitClaim(SLASHED_AGENT, CLAIM_AMOUNT_2, EVIDENCE);
  await waitForTx(claim2Tx, "Submitting claim #" + nextId2.toString());

  const rejectTx = await pool.rejectClaim(nextId2);
  await waitForTx(rejectTx, "Rejecting claim #" + nextId2.toString());

  const claim2 = await pool.getClaim(nextId2);
  console.log(`  Claim #${claim2.id}: Status: ${STATUS_NAMES[Number(claim2.status)]}`);

  assert(Number(claim2.status) === 2, "Second claim status is Rejected");

  const poolAfterReject = await pool.poolBalance();
  assert(poolAfterReject === poolAfterPayout, "Pool balance unchanged after rejection (no payout)");
  console.log("");

  // ═══ Step 7: Verify final pool stats ═══
  console.log("═══ Step 7: Final Pool Stats ═══\n");

  const stats = await pool.getPoolStats();
  console.log(`  Pool Balance:     ${fmt(stats._poolBalance)} ETH`);
  console.log(`  Total Deposited:  ${fmt(stats._totalDeposited)} ETH`);
  console.log(`  Total Paid Out:   ${fmt(stats._totalPaidOut)} ETH`);
  console.log(`  Total Claims:     ${stats._totalClaims.toString()}`);
  console.log(`  Pending Claims:   ${stats._pendingClaims.toString()}`);
  console.log(`  Approved Claims:  ${stats._approvedClaims.toString()}`);
  console.log(`  Rejected Claims:  ${stats._rejectedClaims.toString()}`);
  console.log(`  Paid Claims:      ${stats._paidClaims.toString()}`);
  console.log("");

  // The stats should reflect claims from THIS run plus any prior runs
  const newClaimsThisRun = 2n;
  assert(
    stats._totalClaims >= initialClaimCount + newClaimsThisRun,
    `Total claims increased by at least ${newClaimsThisRun} (was ${initialClaimCount}, now ${stats._totalClaims})`
  );

  assert(
    stats._totalDeposited >= initialDeposited + DEPOSIT,
    `Total deposited includes our 0.01 ETH deposit`
  );

  assert(
    stats._totalPaidOut >= initialPaid + CLAIM_AMOUNT,
    `Total paid out includes our 0.003 ETH payout`
  );

  // ═══ Summary ═══
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Results: ${passCount} passed, ${failCount} failed`);
  console.log("═══════════════════════════════════════════════════════════");

  if (failCount > 0) {
    console.log("\n  ⚠  Some assertions failed — check output above.\n");
    process.exit(1);
  } else {
    console.log("\n  ✅ All assertions passed — InsurancePool is working on Sepolia!\n");
    console.log(`  Contract: https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`);
    console.log("");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
