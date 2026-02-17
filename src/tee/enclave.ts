/**
 * Trusted ClawMon — Simulated TEE Enclave (Phase 8)
 *
 * Provides a simulated Trusted Execution Environment using an Ed25519
 * signing keypair. Implements the TEEEnclaveProvider interface so that
 * a real SGX/TDX/SEV backend can replace this module without changing
 * any consumer code.
 *
 * For v1 (hackathon), this simulation:
 *   - Generates an Ed25519 keypair on initialization
 *   - Signs runtime reports with the private key
 *   - Verifies signatures with the public key
 *   - Generates realistic-looking runtime reports for demo purposes
 *
 * To upgrade to real TEE:
 *   1. Implement TEEEnclaveProvider with actual DCAP attestation
 *   2. Replace the SimulatedEnclave instance in the service
 *   3. No other code changes needed
 */

import { createHash, randomBytes, generateKeyPairSync, sign, verify } from 'node:crypto';
import type {
  TEEEnclaveProvider,
  TEEAttestation,
  RuntimeReport,
  TEEPlatformType,
} from './types.js';

// ---------------------------------------------------------------------------
// Simulated Enclave
// ---------------------------------------------------------------------------

export class SimulatedEnclave implements TEEEnclaveProvider {
  private readonly privateKey: Buffer;
  private readonly publicKey: Buffer;
  private readonly publicKeyHex: string;
  private readonly enclaveId: string;
  private readonly platform: TEEPlatformType;
  private attestationCounter = 0;

  constructor(platform: TEEPlatformType = 'simulated') {
    const keypair = generateKeyPairSync('ed25519');

    this.privateKey = Buffer.from(
      keypair.privateKey.export({ type: 'pkcs8', format: 'der' }),
    );
    this.publicKey = Buffer.from(
      keypair.publicKey.export({ type: 'spki', format: 'der' }),
    );
    this.publicKeyHex = this.publicKey.toString('hex');

    // Generate a stable enclave ID from the public key
    this.enclaveId = `enclave-${createHash('sha256')
      .update(this.publicKey)
      .digest('hex')
      .slice(0, 16)}`;

    this.platform = platform;
  }

  getPublicKey(): string {
    return this.publicKeyHex;
  }

  getEnclaveId(): string {
    return this.enclaveId;
  }

  getPlatformType(): TEEPlatformType {
    return this.platform;
  }

  /**
   * Sign a runtime report, producing a full TEE attestation.
   * In a real TEE, this would happen inside the secure enclave.
   */
  async signReport(report: RuntimeReport): Promise<TEEAttestation> {
    const canonicalJson = canonicalize(report);
    const reportBuffer = Buffer.from(canonicalJson, 'utf-8');

    const signature = sign(null, reportBuffer, {
      key: Buffer.from(this.privateKey),
      format: 'der',
      type: 'pkcs8',
    });

    const attestationId = `tee-att-${++this.attestationCounter}-${Date.now()}`;

    const attestationHash = createHash('sha256')
      .update(reportBuffer)
      .update(signature)
      .digest('hex');

    return {
      id: attestationId,
      report,
      enclaveId: this.enclaveId,
      platformType: this.platform,
      signature: signature.toString('hex'),
      publicKey: this.publicKeyHex,
      attestationHash,
    };
  }

  /**
   * Verify a TEE attestation signature.
   * In a real TEE, this would involve DCAP quote verification.
   */
  async verifySignature(attestation: TEEAttestation): Promise<boolean> {
    try {
      // Only verify attestations from this enclave
      if (attestation.publicKey !== this.publicKeyHex) {
        return false;
      }

      const canonicalJson = canonicalize(attestation.report);
      const reportBuffer = Buffer.from(canonicalJson, 'utf-8');
      const signatureBuffer = Buffer.from(attestation.signature, 'hex');

      return verify(null, reportBuffer, {
        key: Buffer.from(this.publicKey),
        format: 'der',
        type: 'spki',
      }, signatureBuffer);
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Report Generation (for simulation / demo)
// ---------------------------------------------------------------------------

/** Common API endpoints that skills might call */
const COMMON_API_ENDPOINTS = [
  'api.openai.com/v1/chat/completions',
  'api.anthropic.com/v1/messages',
  'api.github.com/repos',
  'api.stripe.com/v1/charges',
  'slack.com/api/chat.postMessage',
  'graph.microsoft.com/v1.0/me/messages',
  'www.googleapis.com/calendar/v3',
  'api.notion.com/v1/pages',
  'api.linear.app/graphql',
  'api.twilio.com/2010-04-01',
];

/** Common data sources that skills might access */
const COMMON_DATA_SOURCES = [
  'user.email',
  'user.calendar',
  'user.files',
  'user.messages',
  'repo.code',
  'repo.issues',
  'database.query',
  'env.variables',
  'system.network',
  'user.credentials',
];

/**
 * Generate a simulated runtime report for an agent.
 * Realistic data is generated based on whether the agent is flagged/malicious.
 */
export function generateSimulatedReport(
  agentId: string,
  codeHash: string,
  opts: {
    flagged?: boolean;
    isSybil?: boolean;
    category?: string;
  } = {},
): RuntimeReport {
  const { flagged = false, isSybil = false, category = 'general' } = opts;

  // Flagged/malicious agents have suspicious runtime behavior
  const isSuspicious = flagged || isSybil;

  const apiCallCount = isSuspicious
    ? randomInt(15, 40)
    : randomInt(1, 8);

  const apiCallsMade = pickRandom(COMMON_API_ENDPOINTS, apiCallCount);

  // Malicious skills access sensitive data
  const dataAccessCount = isSuspicious
    ? randomInt(5, 10)
    : randomInt(1, 3);

  const dataPool = isSuspicious
    ? COMMON_DATA_SOURCES // Access everything including credentials
    : COMMON_DATA_SOURCES.filter(d => !['user.credentials', 'env.variables'].includes(d));

  const dataAccessed = pickRandom(dataPool, dataAccessCount);

  // Flagged skills might have credential access as a red flag
  if (isSuspicious && !dataAccessed.includes('user.credentials')) {
    dataAccessed.push('user.credentials');
  }

  const executionTimeMs = isSuspicious
    ? randomInt(5000, 25000)  // Suspicious: longer execution
    : randomInt(100, 3000);   // Normal: fast execution

  const errors = isSuspicious
    ? pickRandom([
        'ECONNREFUSED: external exfil endpoint',
        'PermissionDenied: /etc/shadow',
        'RateLimited: excessive API calls',
        'TimeoutError: long-running background task',
        'MemoryWarning: heap exceeded soft limit',
      ], randomInt(1, 3))
    : Math.random() > 0.8
      ? [pickRandom(['TimeoutWarning: slow upstream', 'RetryExhausted: API rate limit'], 1)[0]]
      : [];

  const peakMemoryBytes = isSuspicious
    ? randomInt(200_000_000, 800_000_000)
    : randomInt(10_000_000, 100_000_000);

  return {
    agentId,
    codeHash,
    executionTimeMs,
    apiCallsMade,
    dataAccessed,
    errors,
    peakMemoryBytes,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };
}

/**
 * Generate a deterministic code hash for an agent.
 * In production this would be the SHA-256 of the actual agent binary.
 */
export function generateCodeHash(agentId: string, version: number = 1): string {
  return createHash('sha256')
    .update(`${agentId}:v${version}:code-content`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization for deterministic signing.
 * Sorts object keys to ensure consistent byte representation.
 */
function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  if (count <= arr.length) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }
  // Allow repeats when count exceeds array size (e.g., many API calls)
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[Math.floor(Math.random() * arr.length)]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _enclave: SimulatedEnclave | null = null;

/**
 * Get the singleton simulated enclave instance.
 * In production, this would be replaced with a factory that connects
 * to an actual TEE backend.
 */
export function getEnclave(): SimulatedEnclave {
  if (!_enclave) {
    _enclave = new SimulatedEnclave('simulated');
  }
  return _enclave;
}
