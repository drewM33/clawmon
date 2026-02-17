/**
 * Trusted ClawMon — WebSocket Event Types (Phase 7)
 *
 * Defines the event types that flow through the internal EventEmitter
 * and are broadcast to connected WebSocket dashboard clients.
 */

// ---------------------------------------------------------------------------
// Event type discriminators
// ---------------------------------------------------------------------------

export type WSEventType =
  | 'feedback:new'
  | 'feedback:revoked'
  | 'score:updated'
  | 'staking:event'
  | 'agent:registered'
  | 'stats:updated'
  | 'graph:updated'
  | 'leaderboard:updated'
  | 'payment:processed'
  | 'governance:proposal'
  | 'governance:vote'
  | 'connection:init';

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface FeedbackNewEvent {
  type: 'feedback:new';
  payload: {
    id: string;
    agentId: string;
    clientAddress: string;
    value: number;
    tag1?: string;
    timestamp: number;
  };
}

export interface FeedbackRevokedEvent {
  type: 'feedback:revoked';
  payload: {
    feedbackId: string;
    agentId: string;
    timestamp: number;
  };
}

export interface ScoreUpdatedEvent {
  type: 'score:updated';
  payload: {
    agentId: string;
    naiveScore: number;
    hardenedScore: number;
    stakeWeightedScore: number;
    naiveTier: string;
    hardenedTier: string;
    stakeWeightedTier: string;
    scoreDelta: number;
    feedbackCount: number;
  };
}

export interface StakingEventPayload {
  type: 'staking:event';
  payload: {
    eventType: 'stake' | 'unstake' | 'slash' | 'delegate';
    agentId: string;
    amountEth: number;
    timestamp: number;
  };
}

export interface AgentRegisteredEvent {
  type: 'agent:registered';
  payload: {
    agentId: string;
    name: string;
    publisher: string;
    category: string;
    timestamp: number;
  };
}

export interface StatsUpdatedEvent {
  type: 'stats:updated';
  payload: {
    totalAgents: number;
    totalFeedback: number;
    uniqueReviewers: number;
    sybilClustersDetected: number;
  };
}

export interface LeaderboardUpdatedEvent {
  type: 'leaderboard:updated';
  payload: {
    agents: Array<{
      agentId: string;
      naiveScore: number;
      hardenedScore: number;
      hardenedTier: string;
      stakeWeightedScore: number;
      scoreDelta: number;
      feedbackCount: number;
    }>;
  };
}

export interface GraphUpdatedEvent {
  type: 'graph:updated';
  payload: {
    nodeCount: number;
    edgeCount: number;
    sybilClusterCount: number;
  };
}

export interface PaymentProcessedEvent {
  type: 'payment:processed';
  payload: {
    paymentId: string;
    agentId: string;
    caller: string;
    amount: number;
    trustTier: string;
    publisherPayout: number;
    protocolPayout: number;
    insurancePayout: number;
    timestamp: number;
  };
}

export interface ConnectionInitEvent {
  type: 'connection:init';
  payload: {
    serverTime: number;
    connectedClients: number;
  };
}

export interface GovernanceProposalEvent {
  type: 'governance:proposal';
  payload: {
    proposalId: number;
    paramKey: string;
    action: 'created' | 'queued' | 'executed' | 'cancelled' | 'defeated';
    description: string;
    timestamp: number;
  };
}

export interface GovernanceVoteEvent {
  type: 'governance:vote';
  payload: {
    proposalId: number;
    voter: string;
    voteType: 'for' | 'against';
    weight: number;
    timestamp: number;
  };
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type WSEvent =
  | FeedbackNewEvent
  | FeedbackRevokedEvent
  | ScoreUpdatedEvent
  | StakingEventPayload
  | AgentRegisteredEvent
  | StatsUpdatedEvent
  | LeaderboardUpdatedEvent
  | GraphUpdatedEvent
  | PaymentProcessedEvent
  | GovernanceProposalEvent
  | GovernanceVoteEvent
  | ConnectionInitEvent;

// ---------------------------------------------------------------------------
// Internal emitter event map
// ---------------------------------------------------------------------------

export interface TrustHubEvents {
  'feedback:new': [FeedbackNewEvent];
  'feedback:revoked': [FeedbackRevokedEvent];
  'score:updated': [ScoreUpdatedEvent];
  'staking:event': [StakingEventPayload];
  'agent:registered': [AgentRegisteredEvent];
  'stats:updated': [StatsUpdatedEvent];
  'leaderboard:updated': [LeaderboardUpdatedEvent];
  'graph:updated': [GraphUpdatedEvent];
  'payment:processed': [PaymentProcessedEvent];
  'governance:proposal': [GovernanceProposalEvent];
  'governance:vote': [GovernanceVoteEvent];
}
