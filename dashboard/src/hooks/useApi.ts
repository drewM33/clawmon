import { useState, useEffect, useCallback } from 'react';
import type {
  AgentSummary,
  AgentDetail,
  GraphData,
  Stats,
  StakingOverviewItem,
  SlashRecord,
  StakingStats,
  AgentStakingDetail,
  BoostStatus,
  AttestationOverviewItem,
  AttestationStats,
  AttestationDetail,
  InsuranceStats,
  InsuranceClaim,
  InsurancePoolState,
  AgentInsurance,
  TEEOverviewItem,
  TEEStats,
  TEEAgentDetail,
  PaymentOverviewItem,
  PaymentStats,
  PaymentActivity,
  PaymentTrustSignal,
  GovernanceStats,
  ProposalListItem,
  ProposalDetail,
  GovernableParameter,
  ParameterCategory,
  UserReputationResponse,
  CuratorLeaderboardEntry,
} from '../types';
import { API_BASE } from '../config/env';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function useLeaderboard() {
  const [data, setData] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<AgentSummary[]>('/leaderboard')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error, setData };
}

export function useAgentDetail(agentId: string | undefined) {
  const [data, setData] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchJson<AgentDetail>(`/agents/${encodeURIComponent(agentId)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  return { data, loading, error };
}

export function useGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    fetchJson<GraphData>('/graph')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, setData, refetch };
}

export function useStats() {
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Stats>('/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error, setData };
}

// ---------------------------------------------------------------------------
// Staking Hooks (Phase 4)
// ---------------------------------------------------------------------------

export function useStakingOverview() {
  const [data, setData] = useState<StakingOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<StakingOverviewItem[]>('/staking/overview')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useSlashHistory() {
  const [data, setData] = useState<SlashRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<SlashRecord[]>('/staking/slashes')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useStakingStats() {
  const [data, setData] = useState<StakingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<StakingStats>('/staking/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useAgentStaking(agentId: string | undefined) {
  const [data, setData] = useState<AgentStakingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);

  const refetch = useCallback(() => setRefetchCount((c) => c + 1), []);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchJson<AgentStakingDetail>(`/staking/${encodeURIComponent(agentId)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId, refetchCount]);

  return { data, loading, error, refetch };
}

export function useBoostOverview() {
  const [data, setData] = useState<BoostStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<BoostStatus[]>('/boost/overview')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Attestation Hooks (Phase 5)
// ---------------------------------------------------------------------------

export function useAttestationOverview() {
  const [data, setData] = useState<AttestationOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<AttestationOverviewItem[]>('/attestation/overview')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useAttestationStats() {
  const [data, setData] = useState<AttestationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<AttestationStats>('/attestation/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useAgentAttestation(agentId: string | undefined) {
  const [data, setData] = useState<AttestationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchJson<AttestationDetail>(`/attestation/${encodeURIComponent(agentId)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Insurance Pool Hooks (Phase 6)
// ---------------------------------------------------------------------------

export function useInsuranceStats() {
  const [data, setData] = useState<InsuranceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<InsuranceStats>('/insurance/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useInsuranceClaims() {
  const [data, setData] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<InsuranceClaim[]>('/insurance/claims')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useInsurancePool() {
  const [data, setData] = useState<InsurancePoolState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<InsurancePoolState>('/insurance/pool')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useAgentInsurance(agentId: string | undefined) {
  const [data, setData] = useState<AgentInsurance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchJson<AgentInsurance>(`/insurance/${encodeURIComponent(agentId)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// TEE Attestation Hooks (Phase 8)
// ---------------------------------------------------------------------------

export function useTEEOverview() {
  const [data, setData] = useState<TEEOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<TEEOverviewItem[]>('/tee/overview')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useTEEStats() {
  const [data, setData] = useState<TEEStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<TEEStats>('/tee/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useAgentTEE(agentId: string | undefined) {
  const [data, setData] = useState<TEEAgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchJson<TEEAgentDetail>(`/tee/${encodeURIComponent(agentId)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// x402 Payment Hooks (Phase 9)
// ---------------------------------------------------------------------------

export function usePaymentStats() {
  const [data, setData] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<PaymentStats>('/payments/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function usePaymentOverview() {
  const [data, setData] = useState<PaymentOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<PaymentOverviewItem[]>('/payments/overview')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function usePaymentActivity() {
  const [data, setData] = useState<PaymentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<PaymentActivity[]>('/payments/activity')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useAgentPayment(agentId: string | undefined) {
  const [data, setData] = useState<{ profile: PaymentOverviewItem; trustSignal: PaymentTrustSignal } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetchJson<{ profile: PaymentOverviewItem; trustSignal: PaymentTrustSignal }>(`/payments/${encodeURIComponent(agentId)}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  return { data, loading, error };
}

export interface CallerPaymentVerification {
  agentId: string;
  caller: string;
  totalPayments: number;
  verified: boolean;
  receipts: Array<{
    paymentId: string;
    amount: number;
    timestamp: number;
    trustTier: string;
  }>;
}

export function useCallerPaymentVerification(agentId: string | undefined, caller: string | undefined) {
  const [data, setData] = useState<CallerPaymentVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !caller) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchJson<CallerPaymentVerification>(
      `/payments/${encodeURIComponent(agentId)}/caller/${encodeURIComponent(caller)}`
    )
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId, caller]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Governance Hooks (Phase 10)
// ---------------------------------------------------------------------------

export function useGovernanceStats() {
  const [data, setData] = useState<GovernanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<GovernanceStats>('/governance/stats')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useGovernanceProposals() {
  const [data, setData] = useState<ProposalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    fetchJson<ProposalListItem[]>('/governance/proposals')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

export function useProposalDetail(proposalId: number | undefined) {
  const [data, setData] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (proposalId === undefined) return;
    setLoading(true);
    fetchJson<ProposalDetail>(`/governance/proposals/${proposalId}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [proposalId]);

  return { data, loading, error };
}

export function useGovernanceParameters() {
  const [data, setData] = useState<GovernableParameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<GovernableParameter[]>('/governance/parameters')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

export function useGovernanceParametersByCategory() {
  const [data, setData] = useState<Record<ParameterCategory, GovernableParameter[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Record<ParameterCategory, GovernableParameter[]>>('/governance/parameters/categories')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Reputation Tier Hooks
// ---------------------------------------------------------------------------

export function useUserReputation(address: string | undefined) {
  const [data, setData] = useState<UserReputationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setLoading(false); return; }
    fetchJson<UserReputationResponse>(`/reputation/${address}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [address]);

  return { data, loading, error, setData };
}

export function useCuratorLeaderboard(limit = 50) {
  const [data, setData] = useState<CuratorLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<CuratorLeaderboardEntry[]>(`/reputation/leaderboard?limit=${limit}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [limit]);

  return { data, loading, error };
}
