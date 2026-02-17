/**
 * Trusted ClawMon — Monad MessageLog Client
 *
 * Wraps the MessageLog smart contract deployed on Monad.
 * Provides typed functions for submitting and reading messages,
 * replacing the Hedera HCS topic operations.
 *
 * Usage:
 *   import { submitMessage, readMessages } from './message-log.js';
 */

import { ethers } from 'ethers';
import { getProvider, getSigner } from './client.js';

// ---------------------------------------------------------------------------
// Topic Enum (matches Solidity Topic enum)
// ---------------------------------------------------------------------------

export enum Topic {
  Identity = 0,
  Feedback = 1,
}

// ---------------------------------------------------------------------------
// ABI (minimal — only the functions we use)
// ---------------------------------------------------------------------------

const MESSAGE_LOG_ABI = [
  'function submitMessage(uint8 topic, string calldata payload) external returns (uint256 sequenceNumber)',
  'function getMessage(uint8 topic, uint256 seqNum) external view returns (tuple(string payload, address sender, uint64 timestamp, uint256 sequenceNumber))',
  'function getMessageCount(uint8 topic) external view returns (uint256)',
  'function getMessageBatch(uint8 topic, uint256 fromSeq, uint256 toSeq) external view returns (tuple(string payload, address sender, uint64 timestamp, uint256 sequenceNumber)[])',
  'function getTopicMemo(uint8 topic) external view returns (string)',
  'event MessageSubmitted(uint8 indexed topic, uint256 indexed sequenceNumber, address indexed sender, uint64 timestamp, string payload)',
];

// ---------------------------------------------------------------------------
// Contract Instance
// ---------------------------------------------------------------------------

const MESSAGE_LOG_ADDRESS = process.env.MESSAGELOG_CONTRACT_ADDRESS || '';

let _readContract: ethers.Contract | null = null;
let _writeContract: ethers.Contract | null = null;

function getReadContract(): ethers.Contract | null {
  if (!MESSAGE_LOG_ADDRESS) return null;
  if (!_readContract) {
    _readContract = new ethers.Contract(
      MESSAGE_LOG_ADDRESS,
      MESSAGE_LOG_ABI,
      getProvider(),
    );
  }
  return _readContract;
}

function getWriteContract(): ethers.Contract | null {
  if (!MESSAGE_LOG_ADDRESS) return null;
  if (!_writeContract) {
    _writeContract = new ethers.Contract(
      MESSAGE_LOG_ADDRESS,
      MESSAGE_LOG_ABI,
      getSigner(),
    );
  }
  return _writeContract;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decoded message from the MessageLog contract */
export interface DecodedMessage<T = Record<string, unknown>> {
  sequenceNumber: number;
  timestamp: number;
  sender: string;
  topic: Topic;
  payload: T;
}

// ---------------------------------------------------------------------------
// Message Submission
// ---------------------------------------------------------------------------

/**
 * Submit a JSON message to the MessageLog contract.
 * Returns the sequence number assigned.
 */
export async function submitMessage(
  topic: Topic,
  message: Record<string, unknown>,
): Promise<{ sequenceNumber: number; timestamp: number }> {
  const contract = getWriteContract();
  if (!contract) {
    throw new Error(
      'MessageLog contract not configured. Set MESSAGELOG_CONTRACT_ADDRESS in .env',
    );
  }

  const payload = {
    ...message,
    timestamp: message.timestamp ?? Date.now(),
  };

  const jsonPayload = JSON.stringify(payload);

  if (jsonPayload.length > 24_576) {
    throw new Error(
      `Message too large (${jsonPayload.length} bytes, max 24576). ` +
        'Consider splitting or using a content-addressed reference.',
    );
  }

  const tx = await contract.submitMessage(topic, jsonPayload);
  const receipt = await tx.wait();

  // Parse the sequence number from the event
  const event = receipt.logs
    .map((log: ethers.Log) => {
      try {
        return contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((e: ethers.LogDescription | null) => e?.name === 'MessageSubmitted');

  const sequenceNumber = event ? Number(event.args.sequenceNumber) : 0;
  const timestamp = payload.timestamp as number;

  return { sequenceNumber, timestamp };
}

// ---------------------------------------------------------------------------
// Message Reading
// ---------------------------------------------------------------------------

/**
 * Read all messages from a topic on the MessageLog contract.
 * Uses paginated batch reads of up to 100 messages at a time.
 *
 * @param topic - The topic to read from
 * @param options.afterSequence - Only return messages after this sequence number
 * @param options.limit - Max total messages to return (default: all)
 */
export async function readMessages<T = Record<string, unknown>>(
  topic: Topic,
  options?: {
    afterSequence?: number;
    limit?: number;
  },
): Promise<DecodedMessage<T>[]> {
  const contract = getReadContract();
  if (!contract) return [];

  const totalCount = Number(await contract.getMessageCount(topic));
  if (totalCount === 0) return [];

  const startSeq = (options?.afterSequence ?? 0) + 1;
  if (startSeq > totalCount) return [];

  const messages: DecodedMessage<T>[] = [];
  const maxMessages = options?.limit ?? totalCount;
  const batchSize = 100;

  let currentSeq = startSeq;

  while (currentSeq <= totalCount && messages.length < maxMessages) {
    const endSeq = Math.min(currentSeq + batchSize - 1, totalCount);

    const batch = await contract.getMessageBatch(topic, currentSeq, endSeq);

    for (const msg of batch) {
      if (messages.length >= maxMessages) break;

      try {
        const payload = JSON.parse(msg.payload) as T;

        messages.push({
          sequenceNumber: Number(msg.sequenceNumber),
          timestamp: Number(msg.timestamp) * 1000, // convert to ms
          sender: msg.sender,
          topic,
          payload,
        });
      } catch {
        console.warn(
          `Skipping non-JSON message #${msg.sequenceNumber} on topic ${topic}`,
        );
      }
    }

    currentSeq = endSeq + 1;
  }

  return messages;
}

/**
 * Read messages and return only the payloads.
 * Convenience wrapper around readMessages.
 */
export async function readPayloads<T = Record<string, unknown>>(
  topic: Topic,
  options?: {
    afterSequence?: number;
    limit?: number;
  },
): Promise<T[]> {
  const messages = await readMessages<T>(topic, options);
  return messages.map((m) => m.payload);
}

// ---------------------------------------------------------------------------
// Topic Info
// ---------------------------------------------------------------------------

/**
 * Get message count and memo for a topic.
 */
export async function getTopicInfo(topic: Topic): Promise<{
  topic: Topic;
  memo: string;
  messageCount: number;
} | null> {
  const contract = getReadContract();
  if (!contract) return null;

  try {
    const [count, memo] = await Promise.all([
      contract.getMessageCount(topic),
      contract.getTopicMemo(topic),
    ]);

    return {
      topic,
      memo,
      messageCount: Number(count),
    };
  } catch {
    return null;
  }
}

/**
 * Check if the MessageLog contract is configured and accessible.
 */
export function isConfigured(): boolean {
  return MESSAGE_LOG_ADDRESS.length > 0;
}

/**
 * Get the contract address (for display).
 */
export function getContractAddress(): string {
  return MESSAGE_LOG_ADDRESS;
}
