/**
 * Trusted ClawMon — ERC-8004 Contract Client
 *
 * Interfaces with the deployed ERC-8004 IdentityRegistry and ReputationRegistry
 * contracts on Monad. Uses the same provider/signer pattern as the existing
 * Monad client (src/monad/client.ts).
 *
 * Contract addresses (Monad Testnet):
 *   IdentityRegistry:  0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 */

import { ethers } from 'ethers';
import { getProvider, getSigner } from '../monad/client.js';
import {
  ERC8004_MONAD_TESTNET,
  ERC8004_MONAD_MAINNET,
} from './types.js';
import type {
  OnChainFeedback,
  FeedbackSummary8004,
  ProofOfPayment,
  FeedbackFile,
} from './types.js';

// ---------------------------------------------------------------------------
// ABIs (minimal — only the functions we call)
// ---------------------------------------------------------------------------

const IDENTITY_ABI = [
  'function register(string agentURI) external returns (uint256 agentId)',
  'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)',
  'function register() external returns (uint256 agentId)',
  'function setAgentURI(uint256 agentId, string newURI) external',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
  'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature) external',
  'function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)',
  'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function transferFrom(address from, address to, uint256 tokenId) external',

  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)',
];

const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external',
  'function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external',
  'function appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex, string responseURI, bytes32 responseHash) external',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) external view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) external view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function getClients(uint256 agentId) external view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64)',
  'function getIdentityRegistry() external view returns (address)',
  'function getResponseCount(uint256 agentId, address clientAddress, uint64 feedbackIndex, address[] responders) external view returns (uint64 count)',

  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)',
];

// ---------------------------------------------------------------------------
// Contract instances
// ---------------------------------------------------------------------------

const USE_MAINNET = process.env.ERC8004_USE_MAINNET === 'true';
const addresses = USE_MAINNET ? ERC8004_MONAD_MAINNET : ERC8004_MONAD_TESTNET;

let _identityRead: ethers.Contract | null = null;
let _identityWrite: ethers.Contract | null = null;
let _reputationRead: ethers.Contract | null = null;
let _reputationWrite: ethers.Contract | null = null;

function getIdentityRead(): ethers.Contract {
  if (!_identityRead) {
    _identityRead = new ethers.Contract(addresses.identityRegistry, IDENTITY_ABI, getProvider());
  }
  return _identityRead;
}

function getIdentityWrite(): ethers.Contract {
  if (!_identityWrite) {
    _identityWrite = new ethers.Contract(addresses.identityRegistry, IDENTITY_ABI, getSigner());
  }
  return _identityWrite;
}

function getReputationRead(): ethers.Contract {
  if (!_reputationRead) {
    _reputationRead = new ethers.Contract(addresses.reputationRegistry, REPUTATION_ABI, getProvider());
  }
  return _reputationRead;
}

function getReputationWrite(): ethers.Contract {
  if (!_reputationWrite) {
    _reputationWrite = new ethers.Contract(addresses.reputationRegistry, REPUTATION_ABI, getSigner());
  }
  return _reputationWrite;
}

// ---------------------------------------------------------------------------
// Identity Registry — Read
// ---------------------------------------------------------------------------

export async function getAgentURI(agentId: number): Promise<string> {
  return getIdentityRead().tokenURI(agentId);
}

export async function getAgentOwner(agentId: number): Promise<string> {
  return getIdentityRead().ownerOf(agentId);
}

export async function getAgentWallet(agentId: number): Promise<string> {
  return getIdentityRead().getAgentWallet(agentId);
}

export async function getAgentMetadata(agentId: number, key: string): Promise<string> {
  return getIdentityRead().getMetadata(agentId, key);
}

export async function getRegistryName(): Promise<string> {
  return getIdentityRead().name();
}

// ---------------------------------------------------------------------------
// Identity Registry — Write
// ---------------------------------------------------------------------------

/**
 * Register a new agent on the ERC-8004 IdentityRegistry.
 * Returns the minted agentId (ERC-721 tokenId).
 */
export async function registerAgent(agentURI: string): Promise<{
  agentId: number;
  txHash: string;
}> {
  const contract = getIdentityWrite();
  const tx = await contract['register(string)'](agentURI);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: ethers.Log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === 'Registered');

  const agentId = event ? Number(event.args.agentId) : -1;

  return { agentId, txHash: receipt.hash };
}

/**
 * Transfer agent NFT to a new owner.
 * Used after auto-registration to move ownership away from the deployer
 * so real users aren't blocked by the self-feedback check.
 */
export async function transferAgent(agentId: number, to: string): Promise<string> {
  const contract = getIdentityWrite();
  const signer = getSigner();
  const tx = await contract.transferFrom(signer.address, to, agentId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Update the agentURI for an existing agent.
 */
export async function setAgentURI(agentId: number, newURI: string): Promise<string> {
  const tx = await getIdentityWrite().setAgentURI(agentId, newURI);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ---------------------------------------------------------------------------
// Reputation Registry — Read
// ---------------------------------------------------------------------------

export async function readFeedback(
  agentId: number,
  clientAddress: string,
  feedbackIndex: number,
): Promise<OnChainFeedback> {
  const result = await getReputationRead().readFeedback(agentId, clientAddress, feedbackIndex);
  return {
    agentId,
    clientAddress,
    feedbackIndex,
    value: Number(result.value),
    valueDecimals: Number(result.valueDecimals),
    tag1: result.tag1,
    tag2: result.tag2,
    isRevoked: result.isRevoked,
  };
}

export async function readAllFeedback(
  agentId: number,
  clientAddresses: string[] = [],
  tag1 = '',
  tag2 = '',
  includeRevoked = false,
): Promise<OnChainFeedback[]> {
  const result = await getReputationRead().readAllFeedback(
    agentId, clientAddresses, tag1, tag2, includeRevoked,
  );

  const entries: OnChainFeedback[] = [];
  for (let i = 0; i < result.clients.length; i++) {
    entries.push({
      agentId,
      clientAddress: result.clients[i],
      feedbackIndex: Number(result.feedbackIndexes[i]),
      value: Number(result.values[i]),
      valueDecimals: Number(result.valueDecimals[i]),
      tag1: result.tag1s[i],
      tag2: result.tag2s[i],
      isRevoked: result.revokedStatuses[i],
    });
  }
  return entries;
}

export async function getFeedbackSummary(
  agentId: number,
  clientAddresses: string[],
  tag1 = '',
  tag2 = '',
): Promise<FeedbackSummary8004> {
  const result = await getReputationRead().getSummary(agentId, clientAddresses, tag1, tag2);
  return {
    agentId,
    count: Number(result.count),
    summaryValue: Number(result.summaryValue),
    summaryValueDecimals: Number(result.summaryValueDecimals),
  };
}

export async function getClients(agentId: number): Promise<string[]> {
  return getReputationRead().getClients(agentId);
}

export async function getLastFeedbackIndex(
  agentId: number,
  clientAddress: string,
): Promise<number> {
  return Number(await getReputationRead().getLastIndex(agentId, clientAddress));
}

// ---------------------------------------------------------------------------
// Reputation Registry — Write
// ---------------------------------------------------------------------------

/**
 * Submit feedback to the ERC-8004 ReputationRegistry.
 *
 * The feedbackURI should point to a JSON file containing the full feedback
 * payload including proofOfPayment (x402 receipt) and executionProof.
 */
export async function giveFeedback(params: {
  agentId: number;
  value: number;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
}): Promise<{ txHash: string; feedbackIndex: number }> {
  const {
    agentId,
    value,
    valueDecimals = 0,
    tag1 = '',
    tag2 = '',
    endpoint = '',
    feedbackURI = '',
    feedbackHash = ethers.ZeroHash,
  } = params;

  const contract = getReputationWrite();
  const tx = await contract.giveFeedback(
    agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash,
  );
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((log: ethers.Log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === 'NewFeedback');

  const feedbackIndex = event ? Number(event.args.feedbackIndex) : -1;

  return { txHash: receipt.hash, feedbackIndex };
}

/**
 * Revoke previously submitted feedback.
 */
export async function revokeFeedback(
  agentId: number,
  feedbackIndex: number,
): Promise<string> {
  const tx = await getReputationWrite().revokeFeedback(agentId, feedbackIndex);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Append a response to existing feedback (e.g., spam flag, refund proof).
 */
export async function appendResponse(params: {
  agentId: number;
  clientAddress: string;
  feedbackIndex: number;
  responseURI: string;
  responseHash?: string;
}): Promise<string> {
  const tx = await getReputationWrite().appendResponse(
    params.agentId,
    params.clientAddress,
    params.feedbackIndex,
    params.responseURI,
    params.responseHash || ethers.ZeroHash,
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the agentRegistry string for Monad testnet.
 * Format: eip155:{chainId}:{identityRegistryAddress}
 */
export function getAgentRegistry(): string {
  const chainId = USE_MAINNET ? '10143' : '10143'; // Monad testnet chainId
  return `eip155:${chainId}:${addresses.identityRegistry}`;
}

/**
 * Build a compliant off-chain feedback file with proofOfPayment.
 */
export function buildFeedbackFile(params: {
  agentId: number;
  clientAddress: string;
  value: number;
  valueDecimals?: number;
  tag1?: string;
  proofOfPayment: ProofOfPayment;
  executionProof?: {
    outputHash: string;
    clawmonSignature: string;
    timestamp: number;
  };
  endpoint?: string;
  mcpTool?: string;
}): FeedbackFile {
  return {
    agentRegistry: getAgentRegistry(),
    agentId: params.agentId,
    clientAddress: `eip155:10143:${params.clientAddress}`,
    createdAt: new Date().toISOString(),
    value: params.value,
    valueDecimals: params.valueDecimals ?? 0,
    tag1: params.tag1,
    endpoint: params.endpoint,
    mcp: params.mcpTool ? { tool: params.mcpTool } : undefined,
    proofOfPayment: params.proofOfPayment,
    executionProof: params.executionProof,
  };
}

/**
 * Get contract addresses being used.
 */
export function getContractAddresses() {
  return { ...addresses };
}

/**
 * Reset contract instances (for testing or reconnection).
 */
export function resetClients(): void {
  _identityRead = null;
  _identityWrite = null;
  _reputationRead = null;
  _reputationWrite = null;
}
