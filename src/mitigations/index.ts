/**
 * Trusted ClawMon — Mitigations barrel export
 */

export type {
  MitigationConfig,
  MitigationResult,
  MitigationFlag,
} from './types.js';

export {
  DEFAULT_MITIGATION_CONFIG,
  DISABLED_MITIGATION_CONFIG,
} from './types.js';

export {
  detectMutualFeedback,
  applyGraphAnalysis,
  detectSybilClusters,
} from './graph.js';

export type { MutualPair } from './graph.js';

export {
  detectVelocitySpikes,
  detectBehavioralShift,
  detectNewSubmitterBurst,
  applyVelocityMitigations,
} from './velocity.js';
