/**
 * Trusted ClawMon — On-Chain Feedback Reader
 *
 * Reads identity registrations and feedback submissions from the
 * MessageLog contract on Monad, then parses them into typed
 * domain objects for the scoring engine.
 */

import { readMessages, Topic, type DecodedMessage } from '../monad/message-log.js';
import type {
  Feedback,
  RegisterMessage,
  FeedbackMessage,
  RevokeFeedbackMessage,
  OnChainMessage,
} from './types.js';

// ---------------------------------------------------------------------------
// In-memory cache (write-through for reliability)
// ---------------------------------------------------------------------------

/** Cached identity registrations keyed by agentId */
const identityCache = new Map<string, RegisterMessage>();

/** Cached feedback entries keyed by feedback ID */
const feedbackCache = new Map<string, Feedback>();

/** Set of revoked feedback IDs */
const revokedIds = new Set<string>();

/** Last-read sequence numbers per topic */
const lastSequence = new Map<string, number>();

// ---------------------------------------------------------------------------
// Identity Reading
// ---------------------------------------------------------------------------

/**
 * Read all identity registrations from the Identity topic
 * on the MessageLog contract.
 * Returns a Map of agentId -> RegisterMessage.
 *
 * @param _topicIdOrAddress - Unused (kept for API compatibility). Contract
 *   address is read from MESSAGELOG_CONTRACT_ADDRESS env var.
 */
export async function readIdentities(
  _topicIdOrAddress?: string,
): Promise<Map<string, RegisterMessage>> {
  const cacheKey = 'identity';
  const afterSeq = lastSequence.get(cacheKey) ?? 0;

  const messages = await readMessages<RegisterMessage>(Topic.Identity, {
    afterSequence: afterSeq > 0 ? afterSeq : undefined,
  });

  for (const msg of messages) {
    if (msg.payload.type === 'register') {
      identityCache.set(msg.payload.agentId, {
        ...msg.payload,
        timestamp: msg.payload.timestamp ?? msg.timestamp,
      });
    }
    lastSequence.set(cacheKey, msg.sequenceNumber);
  }

  return new Map(identityCache);
}

// ---------------------------------------------------------------------------
// Feedback Reading
// ---------------------------------------------------------------------------

/**
 * Read all feedback from the Feedback topic on the MessageLog contract.
 * Handles revocations by marking feedback as revoked.
 * Returns a flat array of Feedback objects.
 *
 * @param _topicIdOrAddress - Unused (kept for API compatibility).
 */
export async function readFeedback(
  _topicIdOrAddress?: string,
): Promise<Feedback[]> {
  const cacheKey = 'feedback';
  const afterSeq = lastSequence.get(cacheKey) ?? 0;

  const messages = await readMessages<OnChainMessage & Record<string, unknown>>(
    Topic.Feedback,
    { afterSequence: afterSeq > 0 ? afterSeq : undefined },
  );

  for (const msg of messages) {
    if (msg.payload.type === 'feedback') {
      const fb = msg.payload as unknown as FeedbackMessage;
      const feedbackId = `feedback:${msg.sequenceNumber}`;

      feedbackCache.set(feedbackId, {
        id: feedbackId,
        agentId: fb.agentId,
        clientAddress: fb.clientAddress,
        value: fb.value,
        valueDecimals: fb.valueDecimals ?? 0,
        tag1: fb.tag1,
        tag2: fb.tag2,
        endpoint: fb.endpoint,
        timestamp: fb.timestamp ?? msg.timestamp,
        sequenceNumber: msg.sequenceNumber,
        revoked: false,
      });
    } else if (msg.payload.type === 'revoke_feedback') {
      const revoke = msg.payload as unknown as RevokeFeedbackMessage;
      revokedIds.add(revoke.feedbackId);

      // Mark cached entry as revoked
      const existing = feedbackCache.get(revoke.feedbackId);
      if (existing) {
        existing.revoked = true;
      }
    }

    lastSequence.set(cacheKey, msg.sequenceNumber);
  }

  // Apply revocations and return
  return Array.from(feedbackCache.values()).map((fb) => ({
    ...fb,
    revoked: fb.revoked || revokedIds.has(fb.id),
  }));
}

/**
 * Read feedback for a specific agent.
 */
export async function readAgentFeedback(
  feedbackTopicId: string,
  agentId: string,
): Promise<Feedback[]> {
  const allFeedback = await readFeedback(feedbackTopicId);
  return allFeedback.filter((f) => f.agentId === agentId);
}

// ---------------------------------------------------------------------------
// Local Cache Operations (for write-through / offline mode)
// ---------------------------------------------------------------------------

/**
 * Add feedback directly to the local cache.
 * Used for write-through caching: when we submit on-chain, we also
 * cache locally so the scoring engine doesn't have to wait for
 * block confirmation.
 */
export function cacheFeedback(feedback: Feedback): void {
  feedbackCache.set(feedback.id, feedback);
}

/**
 * Add multiple feedback entries to the local cache.
 */
export function cacheFeedbackBatch(feedbackList: Feedback[]): void {
  for (const fb of feedbackList) {
    feedbackCache.set(fb.id, fb);
  }
}

/**
 * Add an identity registration to the local cache.
 */
export function cacheIdentity(registration: RegisterMessage): void {
  identityCache.set(registration.agentId, registration);
}

/**
 * Get all cached feedback (no on-chain read).
 * Useful when operating in offline/local-only mode.
 */
export function getCachedFeedback(): Feedback[] {
  return Array.from(feedbackCache.values());
}

/**
 * Get cached feedback for a specific agent (no on-chain read).
 */
export function getCachedAgentFeedback(agentId: string): Feedback[] {
  return Array.from(feedbackCache.values()).filter(
    (f) => f.agentId === agentId,
  );
}

/**
 * Get all cached identities (no on-chain read).
 */
export function getCachedIdentities(): Map<string, RegisterMessage> {
  return new Map(identityCache);
}

/**
 * Clear all caches. Used in tests.
 */
export function clearCaches(): void {
  identityCache.clear();
  feedbackCache.clear();
  revokedIds.clear();
  lastSequence.clear();
}
