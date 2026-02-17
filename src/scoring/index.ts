/**
 * Trusted ClawMon — Scoring module barrel export
 */

// Types
export type {
  Feedback,
  FeedbackSummary,
  TrustTier,
  AccessDecision,
  OnChainMessage,
  MessageType,
  HCSMessage,
  HCSMessageType,
  RegisterMessage,
  FeedbackMessage,
  RevokeFeedbackMessage,
  UpdateAuthMessage,
} from './types.js';

export {
  scoreToTier,
  tierToAccessDecision,
  emptySummary,
  TIER_THRESHOLDS,
  MIN_FEEDBACK_COUNT,
} from './types.js';

// Naive engine
export {
  computeSummary,
  computeAllSummaries,
  rankAgents,
  computeWeightedAverage,
  groupByAgent,
  tierDescription,
} from './engine.js';

// Hardened engine
export {
  computeHardenedSummary,
  computeAllHardenedSummaries,
  compareScoring,
} from './hardened.js';

// Reader
export {
  readIdentities,
  readFeedback,
  readAgentFeedback,
  cacheFeedback,
  cacheFeedbackBatch,
  cacheIdentity,
  getCachedFeedback,
  getCachedAgentFeedback,
  getCachedIdentities,
  clearCaches,
} from './reader.js';

// On-chain weighted scoring
export type { OnChainWeightedConfig, OnChainData, OnChainSignals, OnChainSignalConfig, AddressProfile } from './on-chain-weighted.js';
export {
  computeOnChainWeightedSummary,
  compareOnChainWeighting,
  simulateOnChainData,
  simulateOnChainDataBatch,
  computeSignals,
  DEFAULT_ON_CHAIN_WEIGHTED_CONFIG,
  DEFAULT_SIGNAL_CONFIG,
} from './on-chain-weighted.js';
