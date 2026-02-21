/**
 * Trusted ClawMon — Skill Invocation Proxy
 *
 * Express route handler factory for the x402 skill invocation flow:
 *
 *   1. Agent hits POST /api/skills/invoke/:id
 *   2. No PAYMENT-SIGNATURE header → return 402 with payment requirements
 *   3. Has PAYMENT-SIGNATURE header → verify tx on-chain via SkillPaywall
 *   4. Valid payment → proxy to skill creator endpoint, capture output
 *   5. Generate execution proof (payment tx + output hash + ClawMon signature)
 *   6. Return output + execution receipt + PAYMENT-RESPONSE header
 *
 * The execution receipt is the artifact that authorizes ERC-8004 feedback.
 */

import type { Request, Response } from 'express';
import { ethers } from 'ethers';
import {
  buildPaymentRequired,
  verifyPaymentTx,
  decodePaymentSignature,
  encodePaymentRequired,
  encodePaymentResponse,
  buildProofOfPayment,
  getPaywallAddress,
} from './x402-protocol.js';
import type { VerifiedPayment } from './x402-protocol.js';
import { generateExecutionReceipt } from './execution-proof.js';
import type { ExecutionReceipt } from './execution-proof.js';
import { getSkillPaymentProfile, recordVerifiedPayment } from './x402.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A registered skill endpoint that ClawMon can proxy to.
 * Skill creators register these so agents can invoke through ClawMon.
 */
export interface SkillEndpoint {
  /** The skill name (matches agentId in the registry) */
  skillName: string;
  /** The URL ClawMon forwards the invocation to */
  endpointUrl: string;
  /** HTTP method to use when forwarding */
  method: 'GET' | 'POST';
  /** Publisher address (receives 80% of payment) */
  publisher: string;
  /** Description for the 402 response */
  description: string;
}

/** In-memory registry of skill endpoints */
const skillEndpoints = new Map<string, SkillEndpoint>();

// ---------------------------------------------------------------------------
// Skill Endpoint Registration
// ---------------------------------------------------------------------------

/**
 * Register a skill endpoint for x402-proxied invocation.
 */
export function registerSkillEndpoint(endpoint: SkillEndpoint): void {
  skillEndpoints.set(endpoint.skillName, endpoint);
}

/**
 * Get a registered skill endpoint.
 */
export function getSkillEndpoint(skillName: string): SkillEndpoint | undefined {
  return skillEndpoints.get(skillName);
}

/**
 * Get all registered skill endpoints.
 */
export function getAllSkillEndpoints(): Map<string, SkillEndpoint> {
  return new Map(skillEndpoints);
}

// ---------------------------------------------------------------------------
// Skill Invocation Handler
// ---------------------------------------------------------------------------

const MONAD_CHAIN_ID = process.env.MONAD_CHAIN_ID || '10143';

/**
 * Express route handler for POST /api/skills/invoke/:id
 *
 * Implements the full x402 payment flow:
 *   - No payment header → 402 with requirements
 *   - Valid payment header → verify, proxy, return output + receipt
 */
export async function handleSkillInvoke(req: Request, res: Response): Promise<void> {
  const rawId = req.params.id;
  const skillName = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!skillName) {
    res.status(400).json({ error: 'Missing skill ID' });
    return;
  }

  // Look up skill payment profile
  const profile = getSkillPaymentProfile(skillName);
  if (!profile || !profile.active) {
    res.status(404).json({ error: 'Skill not registered for x402 payments' });
    return;
  }

  const endpoint = skillEndpoints.get(skillName);

  // -------------------------------------------------------------------
  // Step 1: Check for PAYMENT-SIGNATURE header
  // -------------------------------------------------------------------
  const paymentHeader = req.headers['payment-signature'] as string | undefined;

  if (!paymentHeader) {
    // Return 402 Payment Required
    const effectivePriceWei = ethers.parseEther(profile.effectivePriceEth.toString());
    const paymentRequired = buildPaymentRequired({
      skillName,
      effectivePriceWei,
      description: endpoint?.description || `Invoke skill: ${skillName}`,
      requestUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    });

    res.status(402)
      .set('PAYMENT-REQUIRED', encodePaymentRequired(paymentRequired))
      .json(paymentRequired);
    return;
  }

  // -------------------------------------------------------------------
  // Step 2: Decode and verify payment
  // -------------------------------------------------------------------
  const payment = decodePaymentSignature(paymentHeader);
  if (!payment) {
    res.status(400).json({ error: 'Invalid PAYMENT-SIGNATURE header format' });
    return;
  }

  const skillHash = ethers.id(skillName);
  const minAmountWei = ethers.parseEther(profile.effectivePriceEth.toString());

  const verification = await verifyPaymentTx(
    payment.txHash,
    skillHash,
    minAmountWei,
  );

  if (!verification.valid) {
    // Payment verification failed — return 402 with reason
    const effectivePriceWei = ethers.parseEther(profile.effectivePriceEth.toString());
    const paymentRequired = buildPaymentRequired({
      skillName,
      effectivePriceWei,
      description: endpoint?.description || `Invoke skill: ${skillName}`,
      requestUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    });

    res.status(402)
      .set('PAYMENT-REQUIRED', encodePaymentRequired(paymentRequired))
      .json({
        ...paymentRequired,
        verificationError: verification.reason,
      });
    return;
  }

  const verified = verification as VerifiedPayment;

  // Record the verified on-chain payment in ClawMon's trust engine
  recordVerifiedPayment({
    agentId: skillName,
    caller: verified.caller,
    txHash: verified.txHash,
    amountEth: parseFloat(ethers.formatEther(verified.amount)),
    publisherPayoutEth: parseFloat(ethers.formatEther(verified.publisherPayout)),
    protocolPayoutEth: parseFloat(ethers.formatEther(verified.protocolPayout)),
    insurancePayoutEth: parseFloat(ethers.formatEther(verified.insurancePayout)),
    onChainPaymentId: verified.paymentId,
    blockTimestamp: verified.blockTimestamp,
  });

  // -------------------------------------------------------------------
  // Step 3: Proxy to skill creator (or return mock output)
  // -------------------------------------------------------------------
  let skillOutput: unknown;

  if (endpoint?.endpointUrl) {
    try {
      const proxyResponse = await fetch(endpoint.endpointUrl, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: endpoint.method === 'POST' ? JSON.stringify(req.body) : undefined,
      });
      skillOutput = await proxyResponse.json();
    } catch (err) {
      skillOutput = {
        error: 'Skill endpoint unreachable',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    skillOutput = {
      skillName,
      status: 'executed',
      message: `Skill "${skillName}" invoked successfully (no proxy endpoint configured)`,
      timestamp: Date.now(),
    };
  }

  // -------------------------------------------------------------------
  // Step 4: Generate execution proof
  // -------------------------------------------------------------------
  let receipt: ExecutionReceipt;
  try {
    receipt = await generateExecutionReceipt({
      paymentTxHash: verified.txHash,
      skillName,
      callerAddress: verified.caller,
      output: skillOutput,
      paywallAddress: getPaywallAddress(),
      chainId: MONAD_CHAIN_ID,
    });
  } catch (err) {
    // If signing fails (no private key in dev), return output without proof
    res.status(200)
      .set('PAYMENT-RESPONSE', encodePaymentResponse(verified))
      .json({
        output: skillOutput,
        payment: {
          verified: true,
          txHash: verified.txHash,
          amount: verified.amount.toString(),
          paymentId: verified.paymentId,
          proofOfPayment: buildProofOfPayment(verified),
        },
        executionProof: null,
        warning: 'Execution proof generation failed — operator key may not be configured',
      });
    return;
  }

  // -------------------------------------------------------------------
  // Step 5: Return output + receipt
  // -------------------------------------------------------------------
  res.status(200)
    .set('PAYMENT-RESPONSE', encodePaymentResponse(verified))
    .json({
      output: skillOutput,
      payment: {
        verified: true,
        txHash: verified.txHash,
        amount: verified.amount.toString(),
        paymentId: verified.paymentId,
      },
      executionReceipt: receipt,
    });
}

/**
 * Express route handler for GET /api/skills/invoke/:id
 *
 * Returns payment requirements without attempting to invoke.
 * Useful for agents to discover pricing before paying.
 */
export function handleSkillPricing(req: Request, res: Response): void {
  const rawId = req.params.id;
  const skillName = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!skillName) {
    res.status(400).json({ error: 'Missing skill ID' });
    return;
  }

  const profile = getSkillPaymentProfile(skillName);
  if (!profile || !profile.active) {
    res.status(404).json({ error: 'Skill not registered for x402 payments' });
    return;
  }

  const endpoint = skillEndpoints.get(skillName);
  const effectivePriceWei = ethers.parseEther(profile.effectivePriceEth.toString());

  const paymentRequired = buildPaymentRequired({
    skillName,
    effectivePriceWei,
    description: endpoint?.description || `Invoke skill: ${skillName}`,
    requestUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
  });

  res.json({
    skillName,
    effectivePriceEth: profile.effectivePriceEth,
    effectivePriceWei: effectivePriceWei.toString(),
    trustTier: profile.trustTier,
    tierMultiplier: profile.tierMultiplier,
    publisher: profile.publisher,
    totalPayments: profile.totalPayments,
    x402: paymentRequired,
  });
}
