/**
 * Trusted ClawMon — x402 HTTP Protocol Layer
 *
 * Implements the x402 payment protocol at the HTTP level:
 *   1. Returns 402 Payment Required with payment requirements
 *   2. Validates payment tx hashes submitted in PAYMENT-SIGNATURE header
 *   3. Verifies settlement on-chain via SkillPaywall.sol events
 *   4. Returns PAYMENT-RESPONSE header with settlement confirmation
 *
 * Settlement happens on Monad in native MON through the existing
 * SkillPaywall contract. The x402 HTTP flow is spec-compatible;
 * the settlement layer uses the project's own contract rather than
 * an external facilitator.
 */

import { ethers } from 'ethers';
import { getProvider } from '../monad/client.js';
import type { ProofOfPayment } from '../erc8004/types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PAYWALL_ADDRESS = process.env.PAYWALL_CONTRACT_ADDRESS || '';

/**
 * Monad testnet chain ID.
 * CAIP-2 format: eip155:10143
 */
const MONAD_CHAIN_ID = process.env.MONAD_CHAIN_ID || '10143';

const PAYWALL_EVENT_ABI = [
  'event PaymentProcessed(uint256 indexed paymentId, bytes32 indexed agentId, address indexed caller, uint256 amount, uint256 publisherPayout, uint256 protocolPayout, uint256 insurancePayout)',
];

// ---------------------------------------------------------------------------
// Payment Requirements (x402-compatible)
// ---------------------------------------------------------------------------

export interface PaymentRequirement {
  scheme: 'exact';
  network: string;    // CAIP-2 e.g. "eip155:10143"
  asset: 'native';    // native MON
  payTo: string;      // SkillPaywall contract address
  amount: string;     // wei amount
  description: string;
  skillId: string;    // keccak256 hash of skill name (bytes32)
  /** Human-readable price in MON */
  priceDisplay: string;
  maxTimeoutSeconds: number;
}

export interface PaymentRequiredResponse {
  x402Version: 1;
  error: 'Payment required';
  resource: {
    url: string;
    description: string;
  };
  accepts: PaymentRequirement[];
}

/**
 * Build a 402 Payment Required response body for a skill.
 */
export function buildPaymentRequired(params: {
  skillName: string;
  effectivePriceWei: bigint;
  description: string;
  requestUrl: string;
}): PaymentRequiredResponse {
  const skillHash = ethers.id(params.skillName);

  return {
    x402Version: 1,
    error: 'Payment required',
    resource: {
      url: params.requestUrl,
      description: params.description,
    },
    accepts: [{
      scheme: 'exact',
      network: `eip155:${MONAD_CHAIN_ID}`,
      asset: 'native',
      payTo: PAYWALL_ADDRESS,
      amount: params.effectivePriceWei.toString(),
      description: params.description,
      skillId: skillHash,
      priceDisplay: `${ethers.formatEther(params.effectivePriceWei)} MON`,
      maxTimeoutSeconds: 300,
    }],
  };
}

// ---------------------------------------------------------------------------
// Payment Verification (on-chain tx validation)
// ---------------------------------------------------------------------------

export interface VerifiedPayment {
  valid: true;
  paymentId: number;
  agentIdHash: string;
  caller: string;
  publisher: string;
  amount: bigint;
  publisherPayout: bigint;
  protocolPayout: bigint;
  insurancePayout: bigint;
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
}

export interface PaymentVerificationError {
  valid: false;
  reason: string;
}

export type PaymentVerificationResult = VerifiedPayment | PaymentVerificationError;

/**
 * Verify an on-chain payment by checking the transaction receipt
 * for a PaymentProcessed event from SkillPaywall.
 *
 * Validates:
 *   1. Transaction exists and succeeded
 *   2. Transaction was sent to the SkillPaywall contract
 *   3. PaymentProcessed event was emitted
 *   4. The agentId in the event matches the expected skill
 *   5. Payment amount meets the required minimum
 *   6. Transaction is recent enough (within maxAge)
 */
export async function verifyPaymentTx(
  txHash: string,
  expectedSkillHash: string,
  minAmountWei: bigint,
  maxAgeSeconds: number = 300,
): Promise<PaymentVerificationResult> {
  if (!PAYWALL_ADDRESS) {
    return { valid: false, reason: 'SkillPaywall contract not configured' };
  }

  const provider = getProvider();

  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch {
    return { valid: false, reason: 'Failed to fetch transaction receipt' };
  }

  if (!receipt) {
    return { valid: false, reason: 'Transaction not found or not yet mined' };
  }

  if (receipt.status !== 1) {
    return { valid: false, reason: 'Transaction reverted' };
  }

  if (receipt.to?.toLowerCase() !== PAYWALL_ADDRESS.toLowerCase()) {
    return { valid: false, reason: 'Transaction was not sent to the SkillPaywall contract' };
  }

  const iface = new ethers.Interface(PAYWALL_EVENT_ABI);
  let paymentEvent: ethers.LogDescription | null = null;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'PaymentProcessed') {
        paymentEvent = parsed;
        break;
      }
    } catch {
      // Not our event
    }
  }

  if (!paymentEvent) {
    return { valid: false, reason: 'No PaymentProcessed event found in transaction' };
  }

  const eventAgentId = paymentEvent.args.agentId;
  if (eventAgentId !== expectedSkillHash) {
    return { valid: false, reason: 'Payment was for a different skill' };
  }

  const amount = paymentEvent.args.amount as bigint;
  if (amount < minAmountWei) {
    return { valid: false, reason: `Payment amount ${amount} below required ${minAmountWei}` };
  }

  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) {
    return { valid: false, reason: 'Could not fetch block for timestamp verification' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - block.timestamp > maxAgeSeconds) {
    return { valid: false, reason: `Payment too old (${now - block.timestamp}s > ${maxAgeSeconds}s max)` };
  }

  return {
    valid: true,
    paymentId: Number(paymentEvent.args.paymentId),
    agentIdHash: eventAgentId,
    caller: paymentEvent.args.caller,
    publisher: '', // Not in the event; read from SkillPaywall.getPayment if needed
    amount,
    publisherPayout: paymentEvent.args.publisherPayout as bigint,
    protocolPayout: paymentEvent.args.protocolPayout as bigint,
    insurancePayout: paymentEvent.args.insurancePayout as bigint,
    blockNumber: receipt.blockNumber,
    blockTimestamp: block.timestamp,
    txHash,
  };
}

/**
 * Build an ERC-8004-compliant proofOfPayment from a verified on-chain payment.
 */
export function buildProofOfPayment(verification: VerifiedPayment): ProofOfPayment {
  return {
    fromAddress: verification.caller,
    toAddress: PAYWALL_ADDRESS,
    chainId: MONAD_CHAIN_ID,
    txHash: verification.txHash,
  };
}

// ---------------------------------------------------------------------------
// x402 Header Utilities
// ---------------------------------------------------------------------------

/**
 * Encode a PaymentRequiredResponse as a base64 string for the
 * PAYMENT-REQUIRED HTTP header.
 */
export function encodePaymentRequired(response: PaymentRequiredResponse): string {
  return Buffer.from(JSON.stringify(response)).toString('base64');
}

/**
 * Decode the PAYMENT-SIGNATURE header.
 * The client sends the tx hash (hex string) directly or base64-encoded JSON.
 */
export function decodePaymentSignature(header: string): {
  txHash: string;
  skillId?: string;
} | null {
  // Direct tx hash (0x-prefixed hex)
  if (header.startsWith('0x') && header.length === 66) {
    return { txHash: header };
  }

  // Base64-encoded JSON payload
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    if (decoded.txHash && typeof decoded.txHash === 'string') {
      return { txHash: decoded.txHash, skillId: decoded.skillId };
    }
  } catch {
    // Not base64 JSON
  }

  return null;
}

/**
 * Encode a settlement response as base64 for the PAYMENT-RESPONSE header.
 */
export function encodePaymentResponse(verification: VerifiedPayment): string {
  return Buffer.from(JSON.stringify({
    success: true,
    transaction: verification.txHash,
    network: `eip155:${MONAD_CHAIN_ID}`,
    payer: verification.caller,
    paymentId: verification.paymentId,
    amount: verification.amount.toString(),
  })).toString('base64');
}

/**
 * Get the configured SkillPaywall address.
 */
export function getPaywallAddress(): string {
  return PAYWALL_ADDRESS;
}
