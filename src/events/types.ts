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
  | 'feedback:agent'
  | 'score:updated'
  | 'staking:event'
  | 'agent:registered'
  | 'stats:updated'
  | 'graph:updated'
  | 'leaderboard:updated'
  | 'payment:processed'
  | 'governance:proposal'
  | 'governance:vote'
  | 'skill:published'
  | 'skill:boosted'
  | 'skill:slashed'
  | 'benefit:activated'
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
// Phase 7: New event types for publish, boost, slash, benefit flows
// ---------------------------------------------------------------------------

export interface AgentFeedbackEvent {
  type: 'feedback:agent';
  payload: {
    targetAgentId: string;
    reviewerAgentId: number;
    reviewerAddress: string;
    value: number;
    reviewerWeight: number;
    reviewerTier: string;
    timestamp: number;
  };
}

export interface SkillPublishedEvent {
  type: 'skill:published';
  payload: {
    skillId: number;
    publisher: string;
    clawhubSlug: string;
    trustLevel: number;
    stakedAmount: string;
    timestamp: number;
  };
}

export interface SkillBoostedEvent {
  type: 'skill:boosted';
  payload: {
    skillId: number;
    booster: string;
    amount: string;
    newTrustLevel: number;
    newBoostUnits: number;
    timestamp: number;
  };
}

export interface SkillSlashedEvent {
  type: 'skill:slashed';
  payload: {
    skillId: number;
    amount: string;
    reason: string;
    caseId: string;
    timestamp: number;
  };
}

export interface BenefitActivatedEvent {
  type: 'benefit:activated';
  payload: {
    skillId: number;
    oldTier: string;
    newTier: string;
    timestamp: number;
  };
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type WSEvent =
  | FeedbackNewEvent
  | FeedbackRevokedEvent
  | AgentFeedbackEvent
  | ScoreUpdatedEvent
  | StakingEventPayload
  | AgentRegisteredEvent
  | StatsUpdatedEvent
  | LeaderboardUpdatedEvent
  | GraphUpdatedEvent
  | PaymentProcessedEvent
  | GovernanceProposalEvent
  | GovernanceVoteEvent
  | SkillPublishedEvent
  | SkillBoostedEvent
  | SkillSlashedEvent
  | BenefitActivatedEvent
  | ConnectionInitEvent;

// ---------------------------------------------------------------------------
// Internal emitter event map
// ---------------------------------------------------------------------------

export interface TrustHubEvents {
  'feedback:new': [FeedbackNewEvent];
  'feedback:revoked': [FeedbackRevokedEvent];
  'feedback:agent': [AgentFeedbackEvent];
  'score:updated': [ScoreUpdatedEvent];
  'staking:event': [StakingEventPayload];
  'agent:registered': [AgentRegisteredEvent];
  'stats:updated': [StatsUpdatedEvent];
  'leaderboard:updated': [LeaderboardUpdatedEvent];
  'graph:updated': [GraphUpdatedEvent];
  'payment:processed': [PaymentProcessedEvent];
  'governance:proposal': [GovernanceProposalEvent];
  'governance:vote': [GovernanceVoteEvent];
  'skill:published': [SkillPublishedEvent];
  'skill:boosted': [SkillBoostedEvent];
  'skill:slashed': [SkillSlashedEvent];
  'benefit:activated': [BenefitActivatedEvent];
}
