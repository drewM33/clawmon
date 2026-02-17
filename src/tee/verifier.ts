/**
 * Trusted ClawMon — TEE Attestation Verifier (Phase 8)
 *
 * Verification service that validates TEE attestation signatures,
 * checks code hash integrity, and evaluates runtime behavior.
 *
 * Verification pipeline:
 *   1. Signature validation — cryptographic proof of enclave origin
 *   2. Code hash comparison — current code matches pinned "known good" hash
 *   3. Platform verification — attestation from recognized TEE platform
 *   4. Freshness check — report generated within the freshness window
 *   5. Behavior analysis — no suspicious runtime patterns
 *
 * All checks must pass for Tier 3 eligibility.
 */

import type {
  TEEAttestation,
  TEEVerificationResult,
  CodeHashPin,
  TEEConfig,
  TEEEnclaveProvider,
} from './types.js';
import { DEFAULT_TEE_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export class TEEVerifier {
  private readonly config: TEEConfig;
  private readonly enclave: TEEEnclaveProvider;
  /** Set of recognized enclave public keys */
  private readonly trustedKeys: Set<string>;

  constructor(enclave: TEEEnclaveProvider, config: TEEConfig = DEFAULT_TEE_CONFIG) {
    this.config = config;
    this.enclave = enclave;
    this.trustedKeys = new Set([enclave.getPublicKey()]);
  }

  /**
   * Register an additional trusted enclave public key.
   * Useful when multiple enclaves are in use or during key rotation.
   */
  addTrustedKey(publicKeyHex: string): void {
    this.trustedKeys.add(publicKeyHex);
  }

  /**
   * Run the full verification pipeline on a TEE attestation.
   */
  async verify(
    attestation: TEEAttestation,
    codeHashPin: CodeHashPin | null,
  ): Promise<TEEVerificationResult> {
    const notes: string[] = [];

    // 1. Signature validation
    const signatureValid = await this.verifySignature(attestation, notes);

    // 2. Code hash comparison
    const codeHashMatch = this.verifyCodeHash(attestation, codeHashPin, notes);

    // 3. Platform verification
    const platformVerified = this.verifyPlatform(attestation, notes);

    // 4. Freshness check
    const reportFresh = this.verifyFreshness(attestation, notes);

    // 5. Behavior analysis
    const behaviorClean = this.analyzeBehavior(attestation, notes);

    // Tier 3 eligibility requires ALL checks to pass
    const tier3Eligible =
      signatureValid &&
      codeHashMatch &&
      platformVerified &&
      reportFresh &&
      behaviorClean;

    const valid = signatureValid && platformVerified && reportFresh;

    return {
      valid,
      signatureValid,
      codeHashMatch,
      platformVerified,
      reportFresh,
      behaviorClean,
      tier3Eligible,
      notes,
    };
  }

  // -----------------------------------------------------------------------
  // Step 1: Signature Validation
  // -----------------------------------------------------------------------

  private async verifySignature(
    attestation: TEEAttestation,
    notes: string[],
  ): Promise<boolean> {
    try {
      // Check that the attestation's public key is trusted
      if (!this.trustedKeys.has(attestation.publicKey)) {
        notes.push('Signature: public key not in trusted set');
        return false;
      }

      const valid = await this.enclave.verifySignature(attestation);
      if (valid) {
        notes.push('Signature: valid (Ed25519)');
      } else {
        notes.push('Signature: INVALID — cryptographic verification failed');
      }
      return valid;
    } catch (err) {
      notes.push(`Signature: ERROR — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Code Hash Comparison
  // -----------------------------------------------------------------------

  private verifyCodeHash(
    attestation: TEEAttestation,
    pin: CodeHashPin | null,
    notes: string[],
  ): boolean {
    if (!pin) {
      notes.push('Code hash: no pin registered — cannot verify');
      return false;
    }

    const match = attestation.report.codeHash === pin.codeHash;
    if (match) {
      notes.push(`Code hash: MATCH (${pin.codeHash.slice(0, 12)}...)`);
    } else {
      notes.push(
        `Code hash: MISMATCH — report=${attestation.report.codeHash.slice(0, 12)}... ` +
        `pin=${pin.codeHash.slice(0, 12)}...`,
      );
    }
    return match;
  }

  // -----------------------------------------------------------------------
  // Step 3: Platform Verification
  // -----------------------------------------------------------------------

  private verifyPlatform(
    attestation: TEEAttestation,
    notes: string[],
  ): boolean {
    const recognized: Set<string> = new Set(['sgx', 'tdx', 'sev', 'simulated']);
    const valid = recognized.has(attestation.platformType);

    if (valid) {
      notes.push(`Platform: ${attestation.platformType} (recognized)`);
    } else {
      notes.push(`Platform: ${attestation.platformType} (UNRECOGNIZED)`);
    }

    // In v1 simulated mode, we accept 'simulated' as valid
    // In production, this would verify DCAP quotes against Intel/AMD roots of trust
    return valid;
  }

  // -----------------------------------------------------------------------
  // Step 4: Freshness Check
  // -----------------------------------------------------------------------

  private verifyFreshness(
    attestation: TEEAttestation,
    notes: string[],
  ): boolean {
    const nowMs = Date.now();
    const reportAgeMs = nowMs - attestation.report.timestamp;
    const windowMs = this.config.freshnessWindowSeconds * 1000;

    const fresh = reportAgeMs >= 0 && reportAgeMs < windowMs;

    if (reportAgeMs < 0) {
      notes.push('Freshness: report timestamp is in the future — SUSPICIOUS');
      return false;
    }

    const ageHours = Math.floor(reportAgeMs / 3_600_000);
    const ageMinutes = Math.floor((reportAgeMs % 3_600_000) / 60_000);

    if (fresh) {
      notes.push(`Freshness: ${ageHours}h ${ageMinutes}m old (within ${this.config.freshnessWindowSeconds / 3600}h window)`);
    } else {
      notes.push(`Freshness: STALE — ${ageHours}h ${ageMinutes}m old (exceeds ${this.config.freshnessWindowSeconds / 3600}h window)`);
    }

    return fresh;
  }

  // -----------------------------------------------------------------------
  // Step 5: Behavior Analysis
  // -----------------------------------------------------------------------

  private analyzeBehavior(
    attestation: TEEAttestation,
    notes: string[],
  ): boolean {
    const report = attestation.report;
    let clean = true;

    // Check API call count
    if (report.apiCallsMade.length > this.config.maxApiCallsThreshold) {
      notes.push(`Behavior: excessive API calls (${report.apiCallsMade.length} > ${this.config.maxApiCallsThreshold})`);
      clean = false;
    }

    // Check execution time
    if (report.executionTimeMs > this.config.maxExecutionTimeMs) {
      notes.push(`Behavior: excessive execution time (${report.executionTimeMs}ms > ${this.config.maxExecutionTimeMs}ms)`);
      clean = false;
    }

    // Check error count
    if (report.errors.length > this.config.maxErrorsThreshold) {
      notes.push(`Behavior: excessive errors (${report.errors.length} > ${this.config.maxErrorsThreshold})`);
      clean = false;
    }

    // Check for sensitive data access patterns
    const sensitiveAccess = report.dataAccessed.filter(d =>
      d.includes('credentials') || d.includes('private_key') || d.includes('env.variables'),
    );
    if (sensitiveAccess.length > 0) {
      notes.push(`Behavior: sensitive data access detected (${sensitiveAccess.join(', ')})`);
      clean = false;
    }

    // Check for known suspicious error patterns
    const suspiciousErrors = report.errors.filter(e =>
      e.includes('exfil') || e.includes('shadow') || e.includes('background task'),
    );
    if (suspiciousErrors.length > 0) {
      notes.push(`Behavior: suspicious error patterns (${suspiciousErrors.length} flagged)`);
      clean = false;
    }

    if (clean) {
      notes.push('Behavior: clean — no suspicious patterns detected');
    }

    return clean;
  }
}

// ---------------------------------------------------------------------------
// Convenience: compute trust weight multiplier from verification
// ---------------------------------------------------------------------------

/**
 * Compute the trust weight multiplier for feedback from a TEE-verified agent.
 *
 *   - Tier 3 eligible (all checks pass): verifiedTrustWeight (default 1.5)
 *   - Valid but not Tier 3 (behavior flag or code mismatch): 1.0 (no change)
 *   - Invalid attestation: 0.8 (penalty)
 *   - No attestation: 1.0 (neutral)
 */
export function computeTEETrustWeight(
  result: TEEVerificationResult | null,
  config: TEEConfig = DEFAULT_TEE_CONFIG,
): number {
  if (!result) return 1.0; // No attestation — neutral

  if (result.tier3Eligible) {
    return config.verifiedTrustWeight; // Full Tier 3 boost
  }

  if (result.valid) {
    return 1.0; // Valid but not full Tier 3 — neutral
  }

  return 0.8; // Failed verification — mild penalty
}
