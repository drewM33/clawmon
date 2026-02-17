/**
 * Live Integration Test — Governance Contract on Sepolia
 *
 * Tests against the deployed Governance contract at:
 *   0xdb9Dd7BF6E2281c78bCD36e8F9451F0cbe2FB632
 *
 * Lifecycle tested:
 *   1. Read current on-chain state (parameters, proposals, stats)
 *   2. Create a proposal to change SCORING_WEIGHT_NAIVE: 100 → 120
 *   3. Cast a stake-weighted FOR vote (0.06 ETH — above 0.05 ETH quorum)
 *   4. Verify quorum is met and vote state is correct
 *   5. Scan existing proposals for any past voting deadline → queue them
 *   6. Scan queued proposals past timelock → execute them
 *   7. Confirm parameter value changed on-chain (if execution was possible)
 *   8. Withdraw vote stake from resolved proposals
 *
 * The contract has immutable constants:
 *   VOTING_PERIOD  = 3 days
 *   TIMELOCK_DELAY = 1 day
 *   QUORUM         = 0.05 ETH
 *   MIN_VOTE_STAKE = 0.001 ETH
 *
 * Since we can't fast-forward time on live Sepolia, the script will:
 *   - Create + vote on a NEW proposal (demonstrates mechanism)
 *   - Advance any EXISTING proposals that have reached the right state
 *   - Report what can and cannot be done right now
 *
 * Usage:
 *   npx hardhat run scripts/test-governance-live.cjs --network sepolia --config hardhat.config.cjs
 */
const hre = require("hardhat");

const CONTRACT_ADDR = "0xdb9Dd7BF6E2281c78bCD36e8F9451F0cbe2FB632";

const STATUS_NAMES = ["Active", "Queued", "Executed", "Cancelled", "Defeated"];
const VOTE_NAMES = ["Against", "For"];

const PARAM_NAMES = [
  "SCORING_WEIGHT_NAIVE",
  "SCORING_WEIGHT_HARDENED",
  "SCORING_WEIGHT_STAKE",
  "MIN_STAKE_WEI",
  "SLASH_REPORTER_BPS",
  "SLASH_INSURANCE_BPS",
  "SLASH_TREASURY_BPS",
  "SLASH_BURN_BPS",
  "INSURANCE_MAX_PAYOUT_BPS",
  "INSURANCE_POOL_CAP",
  "REVIEW_BOND_WEI",
  "UNBONDING_PERIOD",
  "TEE_FRESHNESS_WINDOW",
  "FOREIGN_STAKE_DISCOUNT_BPS",
];

// Helpers
function assert(condition, msg) {
  if (!condition) {
    console.error(`\n  ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`    PASS: ${msg}`);
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function formatTimestamp(ts) {
  return new Date(Number(ts) * 1000).toISOString();
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const now = BigInt(Math.floor(Date.now() / 1000));

  console.log("");
  console.log("================================================================");
  console.log("  GOVERNANCE LIVE INTEGRATION TEST — Sepolia");
  console.log("================================================================");
  console.log(`  Signer:   ${deployer.address}`);
  const bal = hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address));
  console.log(`  Balance:  ${bal} ETH`);
  console.log(`  Contract: ${CONTRACT_ADDR}`);
  console.log(`  Time:     ${new Date().toISOString()}`);
  console.log("");

  // Connect to deployed contract
  const Governance = await hre.ethers.getContractFactory("Governance");
  const gov = Governance.attach(CONTRACT_ADDR);

  // Verify we are the owner
  const contractOwner = await gov.owner();
  const isOwner = contractOwner.toLowerCase() === deployer.address.toLowerCase();
  console.log(`  Owner:    ${contractOwner}`);
  console.log(`  We are owner: ${isOwner}`);
  if (!isOwner) {
    console.error("\n  ERROR: Deployer is not the contract owner. Cannot create proposals.");
    console.log("  The deployer key in .env must match the original deployer.");
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 1: Read Current On-Chain State
  // ═══════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("── STEP 1: Read Current On-Chain State ───────────────────────");
  console.log("");

  // Read constants
  const votingPeriod = await gov.VOTING_PERIOD();
  const timelockDelay = await gov.TIMELOCK_DELAY();
  const quorum = await gov.QUORUM();
  const minVoteStake = await gov.MIN_VOTE_STAKE();

  console.log("  Contract Constants:");
  console.log(`    VOTING_PERIOD:   ${formatDuration(votingPeriod)} (${votingPeriod}s)`);
  console.log(`    TIMELOCK_DELAY:  ${formatDuration(timelockDelay)} (${timelockDelay}s)`);
  console.log(`    QUORUM:          ${hre.ethers.formatEther(quorum)} ETH`);
  console.log(`    MIN_VOTE_STAKE:  ${hre.ethers.formatEther(minVoteStake)} ETH`);
  console.log("");

  // Read all parameters
  console.log("  Current Parameter Values:");
  const paramValues = {};
  for (const name of PARAM_NAMES) {
    const key = hre.ethers.encodeBytes32String(name);
    const value = await gov.getParameter(key);
    paramValues[name] = value;

    let display = value.toString();
    if (name.endsWith("_WEI") || name === "INSURANCE_POOL_CAP") {
      display = `${hre.ethers.formatEther(value)} ETH (${value})`;
    } else if (name === "UNBONDING_PERIOD" || name === "TEE_FRESHNESS_WINDOW") {
      display = `${formatDuration(value)} (${value})`;
    } else if (name.endsWith("_BPS")) {
      display = `${Number(value) / 100}% (${value} bps)`;
    }
    console.log(`    ${name}: ${display}`);
  }
  console.log("");

  // Read governance stats
  const stats = await gov.getGovernanceStats();
  console.log("  Governance Stats:");
  console.log(`    Total Proposals:  ${stats.totalProposals}`);
  console.log(`    Active:           ${stats.activeProposals}`);
  console.log(`    Queued:           ${stats.queuedProposals}`);
  console.log(`    Executed:         ${stats.executedProposals}`);
  console.log(`    Cancelled:        ${stats.cancelledProposals}`);
  console.log(`    Defeated:         ${stats.defeatedProposals}`);
  console.log(`    Total Parameters: ${stats.totalParameters}`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 1b: Scan Existing Proposals
  // ═══════════════════════════════════════════════════════════════════════
  const proposalCount = Number(stats.totalProposals);
  const advanceable = { toQueue: [], toExecute: [], toWithdraw: [] };

  if (proposalCount > 0) {
    console.log("  Existing Proposals:");
    for (let i = 0; i < proposalCount; i++) {
      const core = await gov.getProposalCore(i);
      const voting = await gov.getProposalVoting(i);
      const statusName = STATUS_NAMES[Number(core.status)];
      const totalVotes = voting.forVotes + voting.againstVotes;
      const quorumMet = totalVotes >= quorum;
      const majorityFor = voting.forVotes > voting.againstVotes;
      const votingEnded = now > voting.votingDeadline;
      const timelockElapsed = voting.executionTime > 0n && now >= voting.executionTime;
      const paramName = hre.ethers.decodeBytes32String(core.paramKey);

      console.log(`    [Proposal #${i}] Status: ${statusName}`);
      console.log(`      Parameter: ${paramName}`);
      console.log(`      Change:    ${core.oldValue} -> ${core.newValue}`);
      console.log(`      For:       ${hre.ethers.formatEther(voting.forVotes)} ETH`);
      console.log(`      Against:   ${hre.ethers.formatEther(voting.againstVotes)} ETH`);
      console.log(`      Voters:    ${voting.voterCount}`);
      console.log(`      Quorum:    ${quorumMet ? "MET" : "NOT MET"} (${hre.ethers.formatEther(totalVotes)}/${hre.ethers.formatEther(quorum)} ETH)`);
      console.log(`      Majority:  ${majorityFor ? "FOR" : "AGAINST/TIED"}`);
      console.log(`      Deadline:  ${formatTimestamp(voting.votingDeadline)} (${votingEnded ? "ENDED" : "in " + formatDuration(voting.votingDeadline - now)})`);
      if (voting.executionTime > 0n) {
        console.log(`      Exec Time: ${formatTimestamp(voting.executionTime)} (${timelockElapsed ? "ELAPSED" : "in " + formatDuration(voting.executionTime - now)})`);
      }

      // Check if this proposal can be advanced
      if (Number(core.status) === 0 && votingEnded && quorumMet && majorityFor) {
        advanceable.toQueue.push(i);
        console.log(`      >>> READY TO QUEUE <<<`);
      }
      if (Number(core.status) === 1 && timelockElapsed) {
        advanceable.toExecute.push(i);
        console.log(`      >>> READY TO EXECUTE <<<`);
      }
      if ((Number(core.status) === 2 || Number(core.status) === 3 || Number(core.status) === 4)) {
        // Check if deployer has unreturned stake
        const voterInfo = await gov.getVoterInfo(i, deployer.address);
        if (voterInfo.voted && voterInfo.weight > 0n) {
          advanceable.toWithdraw.push(i);
          console.log(`      >>> STAKE WITHDRAWABLE (${hre.ethers.formatEther(voterInfo.weight)} ETH) <<<`);
        }
      }
      console.log("");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 2: Advance Existing Proposals (Queue & Execute if ready)
  // ═══════════════════════════════════════════════════════════════════════
  let executedProposalParam = null;
  let executedProposalNewValue = null;

  if (advanceable.toQueue.length > 0 || advanceable.toExecute.length > 0) {
    console.log("── STEP 2: Advance Existing Proposals ──────────────────────");
    console.log("");

    // Queue any that are ready
    for (const pid of advanceable.toQueue) {
      console.log(`  Queuing Proposal #${pid}...`);
      try {
        const tx = await gov.queueProposal(pid);
        const receipt = await tx.wait();
        console.log(`    Tx: ${receipt.hash}`);
        console.log(`    Gas: ${receipt.gasUsed}`);

        const voting = await gov.getProposalVoting(pid);
        console.log(`    Execution time: ${formatTimestamp(voting.executionTime)}`);
        console.log(`    QUEUED SUCCESSFULLY`);

        // Check if it's immediately executable (shouldn't be, but just in case)
        if (now >= voting.executionTime) {
          advanceable.toExecute.push(pid);
        }
      } catch (e) {
        console.log(`    Failed to queue: ${e.message}`);
      }
      console.log("");
    }

    // Execute any that are ready
    for (const pid of advanceable.toExecute) {
      const core = await gov.getProposalCore(pid);
      const paramName = hre.ethers.decodeBytes32String(core.paramKey);
      console.log(`  Executing Proposal #${pid} (${paramName}: ${core.oldValue} -> ${core.newValue})...`);
      try {
        const tx = await gov.executeProposal(pid);
        const receipt = await tx.wait();
        console.log(`    Tx: ${receipt.hash}`);
        console.log(`    Gas: ${receipt.gasUsed}`);
        console.log(`    EXECUTED SUCCESSFULLY`);
        executedProposalParam = core.paramKey;
        executedProposalNewValue = core.newValue;

        // Verify the parameter changed
        const currentValue = await gov.getParameter(core.paramKey);
        assert(
          currentValue === core.newValue,
          `Parameter ${paramName} updated to ${currentValue} (expected ${core.newValue})`
        );
      } catch (e) {
        console.log(`    Failed to execute: ${e.message}`);
      }
      console.log("");
    }

    // Withdraw any stakes
    for (const pid of advanceable.toWithdraw) {
      console.log(`  Withdrawing vote stake from Proposal #${pid}...`);
      try {
        const tx = await gov.withdrawVoteStake(pid);
        const receipt = await tx.wait();
        console.log(`    Tx: ${receipt.hash}`);
        console.log(`    STAKE WITHDRAWN`);
      } catch (e) {
        console.log(`    Failed to withdraw: ${e.message}`);
      }
      console.log("");
    }
  } else {
    console.log("── STEP 2: No existing proposals ready to advance ──────────");
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 3: Create a New Proposal
  // ═══════════════════════════════════════════════════════════════════════
  console.log("── STEP 3: Create New Proposal ──────────────────────────────");
  console.log("");

  // Target: change SCORING_WEIGHT_NAIVE
  const targetParam = "SCORING_WEIGHT_NAIVE";
  const targetKey = hre.ethers.encodeBytes32String(targetParam);
  const currentValue = await gov.getParameter(targetKey);
  console.log(`  Target Parameter: ${targetParam}`);
  console.log(`  Current Value:    ${currentValue}`);

  // Choose a new value that's different from current
  // Alternate between 120 and 100 for idempotent re-runs
  let proposedValue;
  if (currentValue === 100n) {
    proposedValue = 120n;
  } else if (currentValue === 120n) {
    proposedValue = 130n;
  } else {
    proposedValue = currentValue + 10n;
  }
  console.log(`  Proposed Value:   ${proposedValue}`);

  const description = `Integration test: change ${targetParam} from ${currentValue} to ${proposedValue} for improved scoring balance (${new Date().toISOString()})`;
  console.log(`  Description:      ${description}`);
  console.log("");

  console.log("  Sending createProposal transaction...");
  const createTx = await gov.createProposal(targetKey, proposedValue, description);
  const createReceipt = await createTx.wait();
  console.log(`    Tx:   ${createReceipt.hash}`);
  console.log(`    Gas:  ${createReceipt.gasUsed}`);

  // Parse the ProposalCreated event to get the proposal ID
  const createEvent = createReceipt.logs
    .map((log) => { try { return gov.interface.parseLog(log); } catch { return null; } })
    .find((e) => e && e.name === "ProposalCreated");

  const newProposalId = createEvent ? Number(createEvent.args.proposalId) : Number(await gov.getProposalCount()) - 1;
  console.log(`    Proposal ID: ${newProposalId}`);
  console.log("");

  // Read back the proposal
  const newCore = await gov.getProposalCore(newProposalId);
  const newVoting = await gov.getProposalVoting(newProposalId);
  assert(Number(newCore.status) === 0, `Proposal status is Active (${STATUS_NAMES[Number(newCore.status)]})`);
  assert(newCore.proposer === deployer.address, `Proposer is deployer`);
  assert(newCore.newValue === proposedValue, `Proposed value is ${proposedValue}`);
  console.log(`    Voting deadline: ${formatTimestamp(newVoting.votingDeadline)}`);
  console.log(`    Voting period remaining: ${formatDuration(newVoting.votingDeadline - now)}`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 4: Cast a Stake-Weighted Vote
  // ═══════════════════════════════════════════════════════════════════════
  console.log("── STEP 4: Cast Stake-Weighted Vote ─────────────────────────");
  console.log("");

  // Vote with 0.06 ETH — above the 0.05 ETH quorum threshold
  const voteStake = hre.ethers.parseEther("0.06");
  const voteType = 1; // For
  console.log(`  Vote: FOR with ${hre.ethers.formatEther(voteStake)} ETH stake weight`);
  console.log(`  (Quorum threshold: ${hre.ethers.formatEther(quorum)} ETH)`);
  console.log("");

  console.log("  Sending castVote transaction...");
  const voteTx = await gov.castVote(newProposalId, voteType, { value: voteStake });
  const voteReceipt = await voteTx.wait();
  console.log(`    Tx:   ${voteReceipt.hash}`);
  console.log(`    Gas:  ${voteReceipt.gasUsed}`);
  console.log("");

  // Parse VoteCast event
  const voteEvent = voteReceipt.logs
    .map((log) => { try { return gov.interface.parseLog(log); } catch { return null; } })
    .find((e) => e && e.name === "VoteCast");

  if (voteEvent) {
    console.log(`    Event VoteCast:`);
    console.log(`      proposalId: ${voteEvent.args.proposalId}`);
    console.log(`      voter:      ${voteEvent.args.voter}`);
    console.log(`      voteType:   ${VOTE_NAMES[Number(voteEvent.args.voteType)]}`);
    console.log(`      weight:     ${hre.ethers.formatEther(voteEvent.args.weight)} ETH`);
    console.log("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 5: Verify Quorum and Vote State
  // ═══════════════════════════════════════════════════════════════════════
  console.log("── STEP 5: Verify Quorum & Vote State ───────────────────────");
  console.log("");

  const afterVoteVoting = await gov.getProposalVoting(newProposalId);
  const totalVoteWeight = afterVoteVoting.forVotes + afterVoteVoting.againstVotes;
  const quorumMet = totalVoteWeight >= quorum;
  const majorityFor = afterVoteVoting.forVotes > afterVoteVoting.againstVotes;

  console.log(`  Vote Tally:`);
  console.log(`    FOR:     ${hre.ethers.formatEther(afterVoteVoting.forVotes)} ETH`);
  console.log(`    AGAINST: ${hre.ethers.formatEther(afterVoteVoting.againstVotes)} ETH`);
  console.log(`    Total:   ${hre.ethers.formatEther(totalVoteWeight)} ETH`);
  console.log(`    Voters:  ${afterVoteVoting.voterCount}`);
  console.log("");

  assert(quorumMet, `Quorum MET (${hre.ethers.formatEther(totalVoteWeight)} >= ${hre.ethers.formatEther(quorum)} ETH)`);
  assert(majorityFor, `Majority is FOR (${hre.ethers.formatEther(afterVoteVoting.forVotes)} > ${hre.ethers.formatEther(afterVoteVoting.againstVotes)})`);
  assert(afterVoteVoting.forVotes === voteStake, `forVotes equals our stake (${hre.ethers.formatEther(voteStake)} ETH)`);
  assert(afterVoteVoting.voterCount === 1n, `Voter count is 1`);
  console.log("");

  // Verify voter info
  const voterInfo = await gov.getVoterInfo(newProposalId, deployer.address);
  assert(voterInfo.voted === true, `Voter recorded as having voted`);
  assert(voterInfo.weight === voteStake, `Vote weight recorded correctly`);
  assert(Number(voterInfo.direction) === voteType, `Vote direction recorded as FOR`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 6: Attempt Queue (will fail — voting period not ended)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("── STEP 6: Attempt Queue (expected to fail) ─────────────────");
  console.log("");

  const votingDeadline = afterVoteVoting.votingDeadline;
  const timeUntilVotingEnds = votingDeadline - now;

  console.log(`  Voting deadline: ${formatTimestamp(votingDeadline)}`);
  console.log(`  Current time:    ${new Date().toISOString()}`);
  console.log(`  Time remaining:  ${formatDuration(timeUntilVotingEnds)}`);
  console.log("");

  if (now <= votingDeadline) {
    console.log("  Attempting queueProposal (should revert with 'Voting not ended')...");
    try {
      await gov.queueProposal.staticCall(newProposalId);
      console.log("    UNEXPECTED: staticCall succeeded");
    } catch (e) {
      const reason = e.message.includes("Voting not ended") ? "Voting not ended" : e.message;
      console.log(`    CORRECTLY REVERTED: "${reason}"`);
      assert(
        e.message.includes("Voting not ended"),
        `Queue correctly blocked — voting period has ${formatDuration(timeUntilVotingEnds)} remaining`
      );
    }
    console.log("");
    console.log(`  NOTE: This proposal can be queued after ${formatTimestamp(votingDeadline)}`);
    console.log(`        Then executed after a further ${formatDuration(timelockDelay)} timelock.`);
    console.log(`        Total wait: ~${formatDuration(timeUntilVotingEnds + timelockDelay)}`);
  } else {
    // Voting already ended — try to queue for real
    console.log("  Voting period has ended! Queuing proposal...");
    const qTx = await gov.queueProposal(newProposalId);
    const qReceipt = await qTx.wait();
    console.log(`    Tx:   ${qReceipt.hash}`);
    console.log(`    Gas:  ${qReceipt.gasUsed}`);
    console.log(`    QUEUED SUCCESSFULLY`);

    const afterQueue = await gov.getProposalVoting(newProposalId);
    console.log(`    Execution time: ${formatTimestamp(afterQueue.executionTime)}`);

    // Try to execute
    if (now >= afterQueue.executionTime) {
      console.log("  Timelock elapsed! Executing proposal...");
      const eTx = await gov.executeProposal(newProposalId);
      const eReceipt = await eTx.wait();
      console.log(`    Tx:   ${eReceipt.hash}`);
      console.log(`    Gas:  ${eReceipt.gasUsed}`);
      console.log(`    EXECUTED SUCCESSFULLY`);
      executedProposalParam = targetKey;
      executedProposalNewValue = proposedValue;
    } else {
      const waitForExec = afterQueue.executionTime - now;
      console.log(`  Timelock not elapsed. Execute available after ${formatTimestamp(afterQueue.executionTime)} (${formatDuration(waitForExec)} from now)`);
    }
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 7: Final State Verification
  // ═══════════════════════════════════════════════════════════════════════
  console.log("── STEP 7: Final State Verification ─────────────────────────");
  console.log("");

  // Re-read governance stats
  const finalStats = await gov.getGovernanceStats();
  console.log("  Final Governance Stats:");
  console.log(`    Total Proposals:  ${finalStats.totalProposals}`);
  console.log(`    Active:           ${finalStats.activeProposals}`);
  console.log(`    Queued:           ${finalStats.queuedProposals}`);
  console.log(`    Executed:         ${finalStats.executedProposals}`);
  console.log(`    Cancelled:        ${finalStats.cancelledProposals}`);
  console.log(`    Defeated:         ${finalStats.defeatedProposals}`);
  console.log("");

  // Verify parameter value
  if (executedProposalParam) {
    const paramName = hre.ethers.decodeBytes32String(executedProposalParam);
    const finalValue = await gov.getParameter(executedProposalParam);
    console.log(`  Parameter Update Confirmed:`);
    console.log(`    ${paramName} = ${finalValue} (expected: ${executedProposalNewValue})`);
    assert(finalValue === executedProposalNewValue, `Parameter ${paramName} has the correct new value`);
    console.log("");
  } else {
    // No proposal was executed — show current target param
    const finalTargetValue = await gov.getParameter(targetKey);
    console.log(`  ${targetParam} current value: ${finalTargetValue} (unchanged — no proposals were executed this run)`);
    console.log("");
  }

  // Read final proposal state for our new proposal
  const finalCore = await gov.getProposalCore(newProposalId);
  const finalVoting = await gov.getProposalVoting(newProposalId);
  console.log(`  New Proposal #${newProposalId} Final State:`);
  console.log(`    Status:     ${STATUS_NAMES[Number(finalCore.status)]}`);
  console.log(`    For:        ${hre.ethers.formatEther(finalVoting.forVotes)} ETH`);
  console.log(`    Against:    ${hre.ethers.formatEther(finalVoting.againstVotes)} ETH`);
  console.log(`    Voters:     ${finalVoting.voterCount}`);
  console.log(`    Quorum Met: YES`);
  console.log(`    Majority:   FOR`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 8: Contract Balance (vote stakes held)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("── STEP 8: Contract & Account Balances ──────────────────────");
  console.log("");

  const contractBal = await deployer.provider.getBalance(CONTRACT_ADDR);
  const deployerBal = await deployer.provider.getBalance(deployer.address);
  console.log(`  Contract balance: ${hre.ethers.formatEther(contractBal)} ETH (vote stakes held)`);
  console.log(`  Deployer balance: ${hre.ethers.formatEther(deployerBal)} ETH`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  //  SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log("================================================================");
  console.log("  INTEGRATION TEST SUMMARY");
  console.log("================================================================");
  console.log("");
  console.log("  Steps Completed:");
  console.log("    [1] Read on-chain state (parameters, proposals, stats)");
  console.log("    [2] Scanned & advanced existing proposals");
  console.log(`    [3] Created Proposal #${newProposalId}: ${targetParam} ${currentValue} -> ${proposedValue}`);
  console.log(`    [4] Cast stake-weighted FOR vote: ${hre.ethers.formatEther(voteStake)} ETH`);
  console.log(`    [5] Verified quorum MET and majority FOR`);

  if (executedProposalParam) {
    const paramName = hre.ethers.decodeBytes32String(executedProposalParam);
    console.log(`    [6] Queued and/or executed a proposal`);
    console.log(`    [7] Confirmed ${paramName} = ${executedProposalNewValue} on-chain`);
  } else {
    console.log(`    [6] Queue blocked (voting period: ${formatDuration(votingPeriod)} remaining)`);
    console.log(`    [7] No execution possible yet — timelock constraints`);
  }
  console.log("");

  if (!executedProposalParam) {
    console.log("  TIMELOCK NOTE:");
    console.log("  ─────────────");
    console.log(`  The contract has immutable constants:`);
    console.log(`    VOTING_PERIOD  = ${formatDuration(votingPeriod)}`);
    console.log(`    TIMELOCK_DELAY = ${formatDuration(timelockDelay)}`);
    console.log("");
    console.log(`  Proposal #${newProposalId} can be QUEUED after:    ${formatTimestamp(votingDeadline)}`);
    console.log(`  Then EXECUTED after:                                 +${formatDuration(timelockDelay)}`);
    console.log("");
    console.log("  To complete the full lifecycle:");
    console.log("    1. Wait for voting deadline to pass (~3 days)");
    console.log("    2. Run this script again — it will auto-detect and queue/execute");
    console.log("    3. OR manually call:");
    console.log(`       npx hardhat console --network sepolia --config hardhat.config.cjs`);
    console.log(`       > const gov = await ethers.getContractAt("Governance", "${CONTRACT_ADDR}")`);
    console.log(`       > await gov.queueProposal(${newProposalId})`);
    console.log(`       > // wait 1 day`);
    console.log(`       > await gov.executeProposal(${newProposalId})`);
    console.log("");
    console.log("  Alternatively, for IMMEDIATE full-lifecycle testing:");
    console.log("    npx hardhat test test/Governance.test.cjs --config hardhat.config.cjs");
    console.log("  (uses Hardhat's time.increase() to skip voting + timelock periods)");
  }

  console.log("");
  console.log("  ALL ASSERTIONS PASSED");
  console.log("================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
