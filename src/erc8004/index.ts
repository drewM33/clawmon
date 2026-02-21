/**
 * Trusted ClawMon — ERC-8004 Integration
 *
 * Client for the ERC-8004 IdentityRegistry and ReputationRegistry
 * contracts deployed on Monad. Provides agent registration, feedback
 * submission with proofOfPayment, and on-chain reputation reads.
 */

export {
  ERC8004_MONAD_TESTNET,
  ERC8004_MONAD_MAINNET,
} from './types.js';

export type {
  AgentRegistrationFile,
  AgentService,
  AgentRegistration,
  ProofOfPayment,
  FeedbackFile,
  OnChainFeedback,
  FeedbackSummary8004,
  MetadataEntry,
} from './types.js';

export {
  // Identity Registry — Read
  getAgentURI,
  getAgentOwner,
  getAgentWallet,
  getAgentMetadata,
  getRegistryName,

  // Identity Registry — Write
  registerAgent,
  transferAgent,
  setAgentURI,

  // Reputation Registry — Read
  readFeedback,
  readAllFeedback,
  getFeedbackSummary,
  getClients,
  getLastFeedbackIndex,

  // Reputation Registry — Write
  giveFeedback,
  revokeFeedback,
  appendResponse,

  // Helpers
  getAgentRegistry,
  buildFeedbackFile,
  getContractAddresses,
  resetClients,
} from './client.js';
