/**
 * Trusted ClawMon — TEE Module Exports (Phase 8)
 */

// Types
export type {
  TEEPlatformType,
  RuntimeReport,
  TEEAttestation,
  TEEVerificationResult,
  CodeHashPin,
  TEEStatus,
  TEEAgentState,
  TEEStats,
  TEEConfig,
  TEEAttestationResponse,
  TEEAgentResponse,
  TEEOverviewItem,
  TEEEnclaveProvider,
} from './types.js';

export { DEFAULT_TEE_CONFIG } from './types.js';

// Enclave
export {
  SimulatedEnclave,
  getEnclave,
  generateSimulatedReport,
  generateCodeHash,
} from './enclave.js';

// Verifier
export { TEEVerifier, computeTEETrustWeight } from './verifier.js';

// Service
export {
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
  buildTEEAttestationResponse,
  computeTEEStats,
  seedSimulatedTEE,
} from './service.js';
