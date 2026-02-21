/**
 * Trusted ClawMon — Execution Proof
 *
 * Generates cryptographic proofs that bind an x402 payment to the actual
 * skill output. The proof is a three-in-one artifact:
 *
 *   1. Payment proof  — x402 settlement tx hash (agent paid the creator)
 *   2. Delivery proof  — keccak256(output), proves authentic output
 *   3. Feedback auth   — the receipt IS the ERC-8004 feedback authorization
 *
 * The proof is signed by ClawMon's operator key (same key used for on-chain
 * operations). The agent cannot forge this because they'd need the signing key.
 *
 * Proof structure:
 *   message = keccak256(paymentTxHash ‖ skillId ‖ outputHash ‖ timestamp)
 *   signature = sign(message, operatorKey)
 */

import { ethers } from 'ethers';
import { getSigner } from '../monad/client.js';
import type { ProofOfPayment } from '../erc8004/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The full execution receipt returned to the agent */
export interface ExecutionReceipt {
  /** x402 payment transaction hash on Monad */
  paymentTxHash: string;
  /** keccak256 hash of the skill name */
  skillId: string;
  /** Human-readable skill name */
  skillName: string;
  /** keccak256 hash of the serialized skill output */
  outputHash: string;
  /** Unix timestamp (seconds) when the proof was generated */
  timestamp: number;
  /** The message that was signed (hex) */
  proofMessage: string;
  /** ClawMon operator's ECDSA signature over proofMessage */
  clawmonSignature: string;
  /** Address of the signing key (for verification) */
  signerAddress: string;
  /** Proof-of-payment object for ERC-8004 feedback file */
  proofOfPayment: ProofOfPayment;
}

/** Verification result when checking a receipt */
export interface ReceiptVerification {
  valid: boolean;
  reason?: string;
  recoveredSigner?: string;
}

// ---------------------------------------------------------------------------
// Proof Generation
// ---------------------------------------------------------------------------

/**
 * Hash arbitrary skill output into a deterministic digest.
 * Accepts any serializable value — objects are JSON-stringified.
 */
export function hashOutput(output: unknown): string {
  let serialized: string;
  if (typeof output === 'string') {
    serialized = output;
  } else if (Buffer.isBuffer(output)) {
    serialized = output.toString('hex');
  } else {
    serialized = JSON.stringify(output, Object.keys(output as object).sort());
  }
  return ethers.keccak256(ethers.toUtf8Bytes(serialized));
}

/**
 * Build the proof message that gets signed.
 *
 * message = keccak256(abi.encodePacked(paymentTxHash, skillId, outputHash, timestamp))
 */
function buildProofMessage(
  paymentTxHash: string,
  skillId: string,
  outputHash: string,
  timestamp: number,
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'bytes32', 'bytes32', 'uint256'],
      [paymentTxHash, skillId, outputHash, timestamp],
    ),
  );
}

/**
 * Generate a signed execution receipt.
 *
 * Called by the ClawMon proxy after:
 *   1. x402 payment is verified on-chain
 *   2. Skill is invoked and output is captured
 *
 * The receipt binds payment + output + timestamp under the operator's signature.
 */
export async function generateExecutionReceipt(params: {
  paymentTxHash: string;
  skillName: string;
  callerAddress: string;
  output: unknown;
  paywallAddress: string;
  chainId: string;
}): Promise<ExecutionReceipt> {
  const skillId = ethers.id(params.skillName);
  const outputHash = hashOutput(params.output);
  const timestamp = Math.floor(Date.now() / 1000);

  const proofMessage = buildProofMessage(
    params.paymentTxHash,
    skillId,
    outputHash,
    timestamp,
  );

  const signer = getSigner();
  const clawmonSignature = await signer.signMessage(ethers.getBytes(proofMessage));

  return {
    paymentTxHash: params.paymentTxHash,
    skillId,
    skillName: params.skillName,
    outputHash,
    timestamp,
    proofMessage,
    clawmonSignature,
    signerAddress: signer.address,
    proofOfPayment: {
      fromAddress: params.callerAddress,
      toAddress: params.paywallAddress,
      chainId: params.chainId,
      txHash: params.paymentTxHash,
    },
  };
}

// ---------------------------------------------------------------------------
// Proof Verification
// ---------------------------------------------------------------------------

/**
 * Verify an execution receipt's integrity and authenticity.
 *
 * Checks:
 *   1. The proof message is correctly reconstructed from components
 *   2. The signature recovers to the claimed signer address
 *   3. The signer is the ClawMon operator (if operatorAddress provided)
 */
export function verifyExecutionReceipt(
  receipt: ExecutionReceipt,
  operatorAddress?: string,
): ReceiptVerification {
  // Reconstruct the proof message from components
  const expectedMessage = buildProofMessage(
    receipt.paymentTxHash,
    receipt.skillId,
    receipt.outputHash,
    receipt.timestamp,
  );

  if (expectedMessage !== receipt.proofMessage) {
    return { valid: false, reason: 'Proof message does not match components' };
  }

  // Recover signer from signature
  let recoveredSigner: string;
  try {
    recoveredSigner = ethers.verifyMessage(
      ethers.getBytes(receipt.proofMessage),
      receipt.clawmonSignature,
    );
  } catch {
    return { valid: false, reason: 'Invalid signature' };
  }

  if (recoveredSigner.toLowerCase() !== receipt.signerAddress.toLowerCase()) {
    return {
      valid: false,
      reason: `Signer mismatch: recovered ${recoveredSigner}, claimed ${receipt.signerAddress}`,
      recoveredSigner,
    };
  }

  // If operator address provided, verify it matches
  if (operatorAddress && recoveredSigner.toLowerCase() !== operatorAddress.toLowerCase()) {
    return {
      valid: false,
      reason: `Signer ${recoveredSigner} is not the ClawMon operator ${operatorAddress}`,
      recoveredSigner,
    };
  }

  return { valid: true, recoveredSigner };
}

/**
 * Quick check: does a receipt have a valid structure?
 */
export function isValidReceiptShape(obj: unknown): obj is ExecutionReceipt {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.paymentTxHash === 'string' &&
    typeof r.skillId === 'string' &&
    typeof r.outputHash === 'string' &&
    typeof r.timestamp === 'number' &&
    typeof r.proofMessage === 'string' &&
    typeof r.clawmonSignature === 'string' &&
    typeof r.signerAddress === 'string' &&
    r.proofOfPayment !== null &&
    typeof r.proofOfPayment === 'object'
  );
}
