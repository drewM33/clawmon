/**
 * Trusted ClawMon — Monad module barrel export
 */

export { getProvider, getSigner, getOperatorAddress, getRpcUrl, checkHealth, closeClient } from './client.js';
export {
  Topic,
  submitMessage,
  readMessages,
  readPayloads,
  getTopicInfo,
  isConfigured,
  getContractAddress,
} from './message-log.js';
export type { DecodedMessage } from './message-log.js';
export {
  createTestWallet,
  createTestWallets,
  generateSimulatedAddress,
  generateSimulatedAddresses,
} from './accounts.js';
export type { TestAccount } from './accounts.js';
