/**
 * Trusted ClawMon — On-Chain Weighted Scoring
 *
 * Integrates on-chain signals as weight factors in the scoring engine.
 * Feedback from addresses with stronger on-chain history (more
 * transactions, higher balance) carries more weight in trust score
 * computation.
 *
 * This creates a cost barrier for sybil attacks: fake reviewer accounts
 * have low transaction counts, zero balances, and no on-chain history,
 * so their feedback is naturally discounted even before graph analysis
 * or velocity mitigations kick in.
 *
 * Signal integration:
 *   - Feedback weight = base_weight * on_chain_trust_weight
 *   - Where on_chain_trust_weight is computed from tx count, balance,
 *     and registration status
 *   - Empty/new accounts get ~0.5x weight (penalty)
 *   - Active accounts with balance get ~1.0x (neutral)
 *   - Well-established accounts get up to ~1.5x (bonus)
 */

import type { Feedback, FeedbackSummary } from './types.js';
import { scoreToTier, tierToAccessDecision, emptySummary } from './types.js';
import { computeWeightedAverage } from './engine.js';

// ---------------------------------------------------------------------------
// On-Chain Data & Signal Types (formerly in ethereum/on-chain-signals.ts)
// ---------------------------------------------------------------------------

/**
 * Raw on-chain data for an address.
 */
export interface OnChainData {
  /** The queried address */
  address: string;
  /** Network the data was read from */
  network: string;
  /** Total number of transactions sent by this address */
  transactionCount: number;
  /** Balance in wei (as string for precision) */
  balanceWei: string;
  /** Balance as a floating point number */
  balanceEth: number;
  /** Whether this address contains contract code */
  isContract: boolean;
  /** Whether the address is registered as an agent */
  isRegisteredAgent: boolean;
  /** Block number at time of query (for freshness tracking) */
  queriedAtBlock: number;
  /** Timestamp of the query */
  queriedAt: number;
}

/**
 * Computed trust signals derived from on-chain data.
 * Each signal is a 0.0-1.0 score where 1.0 = maximum trust signal.
 */
export interface OnChainSignals {
  /** Source data this was computed from */
  source: OnChainData;
  /** Activity signal: based on transaction count (0.0-1.0) */
  activityScore: number;
  /** Wealth signal: based on balance (0.0-1.0) */
  wealthScore: number;
  /** Identity signal: is a registered agent (0 or 1) */
  identityScore: number;
  /** Contract signal: penalty for being a contract */
  isEOA: boolean;
  /** Composite trust weight (0.0-2.0) */
  trustWeight: number;
  /** Human-readable summary of the address profile */
  profile: AddressProfile;
}

/**
 * Human-readable categorization of an address.
 */
export type AddressProfile =
  | 'whale'
  | 'active_user'
  | 'casual_user'
  | 'new_account'
  | 'empty_account'
  | 'contract'
  | 'unknown';

/**
 * Configuration for on-chain signal weight computation.
 */
export interface OnChainSignalConfig {
  /** Enable/disable the on-chain signal weighting */
  enabled: boolean;
  /** Weight of the activity score in the composite (0.0-1.0) */
  activityWeight: number;
  /** Weight of the wealth score in the composite (0.0-1.0) */
  wealthWeight: number;
  /** Weight of the identity score in the composite (0.0-1.0) */
  identityWeight: number;
  /** Transaction count for maximum activity score */
  maxTransactionCount: number;
  /** Balance for maximum wealth score (in native token) */
  maxBalanceEth: number;
  /** Penalty multiplier for contract addresses (0.0-1.0) */
  contractPenalty: number;
}

/** Default signal config */
export const DEFAULT_SIGNAL_CONFIG: OnChainSignalConfig = {
  enabled: true,
  activityWeight: 0.4,
  wealthWeight: 0.3,
  identityWeight: 0.3,
  maxTransactionCount: 100,
  maxBalanceEth: 10.0,
  contractPenalty: 0.5,
};

/**
 * Compute trust signals from raw on-chain data.
 */
export function computeSignals(
  data: OnChainData,
  config: OnChainSignalConfig = DEFAULT_SIGNAL_CONFIG,
): OnChainSignals {
  const activityScore = data.transactionCount === 0
    ? 0
    : Math.min(1.0, Math.log10(data.transactionCount + 1) / Math.log10(config.maxTransactionCount + 1));

  const wealthScore = data.balanceEth <= 0
    ? 0
    : Math.min(1.0, Math.log10(data.balanceEth * 100 + 1) / Math.log10(config.maxBalanceEth * 100 + 1));

  const identityScore = data.isRegisteredAgent ? 1.0 : 0.0;

  const rawWeight =
    activityScore * config.activityWeight +
    wealthScore * config.wealthWeight +
    identityScore * config.identityWeight;

  const contractMultiplier = data.isContract ? config.contractPenalty : 1.0;
  const trustWeight = (0.5 + rawWeight) * contractMultiplier;
  const profile = classifyProfile(data);

  return {
    source: data,
    activityScore,
    wealthScore,
    identityScore,
    isEOA: !data.isContract,
    trustWeight,
    profile,
  };
}

function classifyProfile(data: OnChainData): AddressProfile {
  if (data.isContract) return 'contract';
  if (data.transactionCount === 0 && data.balanceEth === 0) return 'empty_account';
  if (data.transactionCount <= 2) return 'new_account';
  if (data.balanceEth >= 1.0 && data.transactionCount >= 50) return 'whale';
  if (data.transactionCount >= 20) return 'active_user';
  return 'casual_user';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OnChainWeightedConfig {
  /** Enable/disable on-chain signal weighting */
  enabled: boolean;
  /** Signal computation config (thresholds, weights) */
  signalConfig: OnChainSignalConfig;
  /** Minimum weight floor */
  minWeight: number;
  /** Maximum weight cap */
  maxWeight: number;
}

export const DEFAULT_ON_CHAIN_WEIGHTED_CONFIG: OnChainWeightedConfig = {
  enabled: true,
  signalConfig: DEFAULT_SIGNAL_CONFIG,
  minWeight: 0.3,
  maxWeight: 2.0,
};

// ---------------------------------------------------------------------------
// On-Chain Weighted Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a feedback summary weighted by on-chain signals.
 */
export function computeOnChainWeightedSummary(
  feedback: Feedback[],
  onChainDataMap: Map<string, OnChainData>,
  config: OnChainWeightedConfig = DEFAULT_ON_CHAIN_WEIGHTED_CONFIG,
): FeedbackSummary {
  if (feedback.length === 0) {
    return emptySummary(feedback[0]?.agentId ?? 'unknown');
  }

  const agentId = feedback[0].agentId;
  const active = feedback.filter((f) => !f.revoked);

  if (active.length === 0) {
    return emptySummary(agentId);
  }

  if (!config.enabled) {
    const sum = active.reduce((acc, f) => acc + f.value, 0);
    const avg = sum / active.length;
    const tier = scoreToTier(avg);
    return {
      agentId,
      feedbackCount: active.length,
      summaryValue: Math.round(avg * 100) / 100,
      summaryValueDecimals: 2,
      tier,
      accessDecision: tierToAccessDecision(tier),
    };
  }

  const weights = new Map<string, number>();

  for (const f of active) {
    const onChainData = onChainDataMap.get(f.clientAddress);

    if (onChainData) {
      const signals = computeSignals(onChainData, config.signalConfig);
      const clamped = Math.max(
        config.minWeight,
        Math.min(config.maxWeight, signals.trustWeight),
      );
      weights.set(f.id, clamped);
    } else {
      weights.set(f.id, 1.0);
    }
  }

  const avg = computeWeightedAverage(active, weights);
  const tier = scoreToTier(avg);

  return {
    agentId,
    feedbackCount: active.length,
    summaryValue: Math.round(avg * 100) / 100,
    summaryValueDecimals: 2,
    tier,
    accessDecision: tierToAccessDecision(tier),
  };
}

// ---------------------------------------------------------------------------
// Simulated On-Chain Data (for offline / demo mode)
// ---------------------------------------------------------------------------

/**
 * Generate simulated on-chain data for a reviewer address.
 */
export function simulateOnChainData(
  address: string,
  network: string = 'monad-testnet',
): OnChainData {
  const lowerAddr = address.toLowerCase();

  if (lowerAddr.startsWith('sybil') || lowerAddr.startsWith('fake') || lowerAddr.startsWith('attacker')) {
    return {
      address,
      network,
      transactionCount: Math.floor(Math.random() * 2),
      balanceWei: '0',
      balanceEth: 0,
      isContract: false,
      isRegisteredAgent: false,
      queriedAtBlock: 0,
      queriedAt: Date.now(),
    };
  }

  if (lowerAddr.startsWith('veteran') || lowerAddr.startsWith('established') || lowerAddr.startsWith('community')) {
    return {
      address,
      network,
      transactionCount: 50 + Math.floor(Math.random() * 200),
      balanceWei: ethersToWei(0.5 + Math.random() * 5),
      balanceEth: 0.5 + Math.random() * 5,
      isContract: false,
      isRegisteredAgent: Math.random() > 0.5,
      queriedAtBlock: 0,
      queriedAt: Date.now(),
    };
  }

  if (lowerAddr.startsWith('whale')) {
    return {
      address,
      network,
      transactionCount: 200 + Math.floor(Math.random() * 500),
      balanceWei: ethersToWei(10 + Math.random() * 100),
      balanceEth: 10 + Math.random() * 100,
      isContract: false,
      isRegisteredAgent: true,
      queriedAtBlock: 0,
      queriedAt: Date.now(),
    };
  }

  const txCount = Math.floor(Math.random() * 50) + 5;
  const balance = Math.random() * 2;
  return {
    address,
    network,
    transactionCount: txCount,
    balanceWei: ethersToWei(balance),
    balanceEth: balance,
    isContract: false,
    isRegisteredAgent: Math.random() > 0.7,
    queriedAtBlock: 0,
    queriedAt: Date.now(),
  };
}

/**
 * Generate simulated on-chain data for a batch of addresses.
 */
export function simulateOnChainDataBatch(
  addresses: string[],
  network: string = 'monad-testnet',
): Map<string, OnChainData> {
  const map = new Map<string, OnChainData>();
  for (const addr of addresses) {
    map.set(addr, simulateOnChainData(addr, network));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare scoring with and without on-chain weighting.
 */
export function compareOnChainWeighting(
  feedback: Feedback[],
  onChainDataMap: Map<string, OnChainData>,
  config: OnChainWeightedConfig = DEFAULT_ON_CHAIN_WEIGHTED_CONFIG,
): {
  unweighted: FeedbackSummary;
  onChainWeighted: FeedbackSummary;
  delta: number;
  weightBreakdown: Array<{
    clientAddress: string;
    feedbackValue: number;
    trustWeight: number;
    profile: string;
  }>;
} {
  const active = feedback.filter((f) => !f.revoked);
  const sum = active.reduce((acc, f) => acc + f.value, 0);
  const avg = active.length > 0 ? sum / active.length : 0;
  const tier = scoreToTier(avg);
  const unweighted: FeedbackSummary = {
    agentId: active[0]?.agentId ?? 'unknown',
    feedbackCount: active.length,
    summaryValue: Math.round(avg * 100) / 100,
    summaryValueDecimals: 2,
    tier,
    accessDecision: tierToAccessDecision(tier),
  };

  const onChainWeighted = computeOnChainWeightedSummary(
    feedback,
    onChainDataMap,
    config,
  );

  const weightBreakdown = active.map((f) => {
    const data = onChainDataMap.get(f.clientAddress);
    const signals = data
      ? computeSignals(data, config.signalConfig)
      : null;
    return {
      clientAddress: f.clientAddress,
      feedbackValue: f.value,
      trustWeight: signals ? signals.trustWeight : 1.0,
      profile: signals ? signals.profile : 'unknown',
    };
  });

  return {
    unweighted,
    onChainWeighted,
    delta: unweighted.summaryValue - onChainWeighted.summaryValue,
    weightBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ethersToWei(eth: number): string {
  return BigInt(Math.floor(eth * 1e18)).toString();
}
