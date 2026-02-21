import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeaderboard } from '../hooks/useApi';
import { useWSEvent } from '../hooks/useWebSocket';
import TierBadge from './TierBadge';
import type { AgentSummary, TrustTier, WSLeaderboardUpdate, WSScoreUpdate } from '../types';
import { STAKE_TIER_COLORS, ATTESTATION_STATUS_COLORS } from '../types';

type SortKey = 'rank' | 'name' | 'naiveScore' | 'hardenedScore' | 'delta' | 'feedbackCount' | 'totalStake' | 'attestation';
type SortDir = 'asc' | 'desc';

export default function Leaderboard() {
  const { data: agents, loading, error, setData: setAgents } = useLeaderboard();
  const [sortKey, setSortKey] = useState<SortKey>('hardenedScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState<'all' | 'legitimate' | 'flagged' | 'sybil'>('all');
  const [updatedAgentIds, setUpdatedAgentIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  // Live-update individual agent scores via WebSocket
  useWSEvent('score:updated', useCallback((event) => {
    const update: WSScoreUpdate = event.payload;
    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.agentId !== update.agentId) return agent;
        return {
          ...agent,
          naiveScore: update.naiveScore,
          hardenedScore: update.hardenedScore,
          hardenedTier: update.hardenedTier as TrustTier,
          stakeWeightedScore: update.stakeWeightedScore,
          scoreDelta: update.scoreDelta,
          feedbackCount: update.feedbackCount,
        };
      }),
    );
    // Flash the updated row briefly
    setUpdatedAgentIds((prev) => new Set(prev).add(update.agentId));
    setTimeout(() => {
      setUpdatedAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(update.agentId);
        return next;
      });
    }, 1500);
  }, [setAgents]));

  const filtered = useMemo(() => {
    let list = [...agents];
    if (filter === 'legitimate') list = list.filter(a => !a.flagged && !a.isSybil);
    if (filter === 'flagged') list = list.filter(a => a.flagged);
    if (filter === 'sybil') list = list.filter(a => a.isSybil);
    return list;
  }, [agents, filter]);

  const sorted = useMemo(() => {
    const compare = (a: AgentSummary, b: AgentSummary): number => {
      let va: string | number, vb: string | number;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'naiveScore': va = a.naiveScore; vb = b.naiveScore; break;
        case 'hardenedScore': va = a.hardenedScore; vb = b.hardenedScore; break;
        case 'delta': va = a.scoreDelta; vb = b.scoreDelta; break;
        case 'feedbackCount': va = a.feedbackCount; vb = b.feedbackCount; break;
        case 'totalStake': va = a.totalStakeEth ?? 0; vb = b.totalStakeEth ?? 0; break;
        case 'attestation': {
          const order = { active: 3, stale: 2, revoked: 1, none: 0 };
          va = order[a.attestationStatus] ?? 0;
          vb = order[b.attestationStatus] ?? 0;
          break;
        }
        default: va = a.hardenedScore; vb = b.hardenedScore;
      }
      if (typeof va === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      }
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    };
    return [...filtered].sort(compare);
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  if (loading) return <div className="loading">Loading leaderboard...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  const AttestationDot = ({ status }: { status: string }) => {
    const color = ATTESTATION_STATUS_COLORS[status as keyof typeof ATTESTATION_STATUS_COLORS] ?? '#6b6b7b';
    const labels: Record<string, string> = {
      active: 'On-chain ✓',
      stale: 'Stale',
      revoked: 'Revoked',
      none: '—',
    };
    return (
      <span
        className="attestation-dot"
        title={`Cross-chain attestation: ${status}`}
        style={{ color }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: color,
            marginRight: 4,
          }}
        />
        <span style={{ fontSize: '0.7rem' }}>{labels[status] ?? status}</span>
      </span>
    );
  };

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <h2>Agent Trust Leaderboard</h2>
        <p className="subtitle">Ranked by hardened score — mitigations applied</p>
      </div>

      <div className="filter-bar">
        {(['all', 'legitimate', 'flagged', 'sybil'] as const).map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All Agents' :
             f === 'legitimate' ? 'Legitimate' :
             f === 'flagged' ? 'Flagged' : 'Sybil'}
            <span className="filter-count">
              {f === 'all' ? agents.length :
               f === 'legitimate' ? agents.filter(a => !a.flagged && !a.isSybil).length :
               f === 'flagged' ? agents.filter(a => a.flagged).length :
               agents.filter(a => a.isSybil).length}
            </span>
          </button>
        ))}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="col-rank" onClick={() => toggleSort('rank')}>#</th>
              <th className="col-name sortable" onClick={() => toggleSort('name')}>
                Agent{sortIndicator('name')}
              </th>
              <th className="col-category">Category</th>
              <th className="col-score sortable" onClick={() => toggleSort('naiveScore')}>
                Naive{sortIndicator('naiveScore')}
              </th>
              <th className="col-score sortable" onClick={() => toggleSort('hardenedScore')}>
                Hardened{sortIndicator('hardenedScore')}
              </th>
              <th className="col-delta sortable" onClick={() => toggleSort('delta')}>
                Delta{sortIndicator('delta')}
              </th>
              <th className="col-tier">Tier</th>
              <th className="col-stake sortable" onClick={() => toggleSort('totalStake')}>
                Stake{sortIndicator('totalStake')}
              </th>
              <th className="col-attestation sortable" onClick={() => toggleSort('attestation')}>
                Attested{sortIndicator('attestation')}
              </th>
              <th className="col-reviews sortable" onClick={() => toggleSort('feedbackCount')}>
                Reviews{sortIndicator('feedbackCount')}
              </th>
              <th className="col-flags">Flags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent, i) => (
              <tr
                key={agent.agentId}
                className={`agent-row ${agent.flagged ? 'flagged' : ''} ${agent.isSybil ? 'sybil' : ''} ${updatedAgentIds.has(agent.agentId) ? 'ws-updated' : ''}`}
                onClick={() => navigate(`/agent/${encodeURIComponent(agent.agentId)}`)}
              >
                <td className="col-rank">{i + 1}</td>
                <td className="col-name">
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-publisher">{agent.publisher}</span>
                </td>
                <td className="col-category">
                  <span className="category-tag">{agent.category}</span>
                </td>
                <td className="col-score">
                  <span className="score-value">{agent.naiveScore.toFixed(1)}</span>
                </td>
                <td className="col-score">
                  <span className="score-value hardened">{agent.hardenedScore.toFixed(1)}</span>
                </td>
                <td className="col-delta">
                  {agent.scoreDelta > 0 ? (
                    <span className="delta-negative">-{agent.scoreDelta.toFixed(1)}</span>
                  ) : agent.scoreDelta < 0 ? (
                    <span className="delta-positive">+{Math.abs(agent.scoreDelta).toFixed(1)}</span>
                  ) : (
                    <span className="delta-neutral">0</span>
                  )}
                </td>
                <td className="col-tier">
                  <TierBadge tier={agent.hardenedTier} size="sm" />
                </td>
                <td className="col-stake">
                  {agent.isStaked ? (
                    <span
                      className="stake-val"
                      style={{ color: STAKE_TIER_COLORS[agent.stakeTier ?? 0] }}
                    >
                      {agent.totalStakeEth?.toFixed(3) ?? '0'}
                    </span>
                  ) : (
                    <span className="stake-val" style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-attestation">
                  <AttestationDot status={agent.attestationStatus} />
                </td>
                <td className="col-reviews">{agent.feedbackCount}</td>
                <td className="col-flags">
                  {agent.flagged && <span className="flag-badge malicious" title="Known malicious">MAL</span>}
                  {agent.isSybil && <span className="flag-badge sybil" title="Sybil cluster">SYB</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
