import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAttestationOverview, useAttestationStats } from '../hooks/useApi';
import TierBadge from './TierBadge';
import type { AttestationOverviewItem, TrustTier, AttestationStatus } from '../types';
import { ATTESTATION_STATUS_COLORS, ATTESTATION_STATUS_LABELS, TIER_COLORS } from '../types';

type FilterMode = 'all' | 'active' | 'stale' | 'revoked' | 'none';

export default function AttestationPanel() {
  const { data: overview, loading: overviewLoading } = useAttestationOverview();
  const { data: stats, loading: statsLoading } = useAttestationStats();
  const [filter, setFilter] = useState<FilterMode>('all');
  const navigate = useNavigate();

  const loading = overviewLoading || statsLoading;

  const filtered = useMemo(() => {
    if (filter === 'all') return overview;
    return overview.filter(a => a.status === filter);
  }, [overview, filter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      const statusOrder: Record<AttestationStatus, number> = { active: 0, stale: 1, revoked: 2, none: 3 };
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      return (b.score ?? 0) - (a.score ?? 0);
    }),
    [filtered],
  );

  if (loading) return <div className="loading">Loading attestation data...</div>;

  return (
    <div className="attestation-panel">
      <div className="attestation-header">
        <h2>Cross-Chain Attestations</h2>
        <p className="subtitle">
          Trust score attestations published on Monad — verifiable on-chain
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="attestation-stats-grid">
          <div className="attestation-stat-card">
            <div className="attestation-stat-value">{stats.totalAttested}</div>
            <div className="attestation-stat-label">Agents Attested</div>
          </div>
          <div className="attestation-stat-card active">
            <div className="attestation-stat-value" style={{ color: ATTESTATION_STATUS_COLORS.active }}>
              {stats.activeCount}
            </div>
            <div className="attestation-stat-label">Active (Fresh)</div>
          </div>
          <div className="attestation-stat-card stale">
            <div className="attestation-stat-value" style={{ color: ATTESTATION_STATUS_COLORS.stale }}>
              {stats.staleCount}
            </div>
            <div className="attestation-stat-label">Stale ({'>'}24h)</div>
          </div>
          <div className="attestation-stat-card revoked">
            <div className="attestation-stat-value" style={{ color: ATTESTATION_STATUS_COLORS.revoked }}>
              {stats.revokedCount}
            </div>
            <div className="attestation-stat-label">Revoked</div>
          </div>
          <div className="attestation-stat-card">
            <div className="attestation-stat-value">{stats.avgScore}</div>
            <div className="attestation-stat-label">Avg Score</div>
          </div>
          <div className="attestation-stat-card">
            <div className="attestation-stat-value" style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {stats.unAttestedCount}
            </div>
            <div className="attestation-stat-label">Not Attested</div>
          </div>
        </div>
      )}

      {/* Bridge Info Banner */}
      {stats && (
        <div className="bridge-info-banner">
          <div className="bridge-info-item">
            <span className="bridge-info-label">Source Chain</span>
            <span className="bridge-info-value chain-badge monad">
              {stats.sourceChain}
            </span>
          </div>
          <div className="bridge-info-item">
            <span className="bridge-info-label">Target Chain</span>
<span className="bridge-info-value chain-badge monad">
            Monad
          </span>
          </div>
          <div className="bridge-info-item">
            <span className="bridge-info-label">Contract</span>
            <span className="bridge-info-value" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>
              {stats.contractAddress.length > 20
                ? `${stats.contractAddress.slice(0, 8)}...${stats.contractAddress.slice(-6)}`
                : stats.contractAddress}
            </span>
          </div>
          <div className="bridge-info-item">
            <span className="bridge-info-label">Last Bridge Run</span>
            <span className="bridge-info-value">
              {stats.lastBridgeRun > 0
                ? new Date(stats.lastBridgeRun).toLocaleTimeString()
                : 'Never'}
            </span>
          </div>
        </div>
      )}

      {/* Tier Distribution */}
      {stats && Object.keys(stats.tierDistribution).length > 0 && (
        <div className="attestation-tier-dist">
          {Object.entries(stats.tierDistribution)
            .sort(([, a], [, b]) => b - a)
            .map(([tier, count]) => {
              const pct = (count / stats.totalAttested) * 100;
              const tierColor = TIER_COLORS[tier as TrustTier] ?? '#6b6b7b';
              return (
                <div
                  key={tier}
                  className="tier-dist-segment"
                  style={{
                    width: `${Math.max(pct, 3)}%`,
                    backgroundColor: tierColor,
                  }}
                  title={`${tier}: ${count} agents (${pct.toFixed(1)}%)`}
                >
                  <span className="tier-dist-label">{tier}</span>
                </div>
              );
            })}
        </div>
      )}

      {/* Filter Bar */}
      <div className="filter-bar">
        {(['all', 'active', 'stale', 'revoked', 'none'] as const).map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : ATTESTATION_STATUS_LABELS[f as AttestationStatus]}
            <span className="filter-count">
              {f === 'all'
                ? overview.length
                : overview.filter(a => a.status === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* Attestation Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="col-name">Agent</th>
              <th className="col-attestation-status">Status</th>
              <th className="col-score">Score</th>
              <th className="col-tier">Tier</th>
              <th className="col-source">Source</th>
              <th className="col-freshness">Freshness</th>
              <th className="col-reviews">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr
                key={item.agentId}
                className={`agent-row ${item.revoked ? 'revoked' : ''}`}
                onClick={() => navigate(`/agent/${encodeURIComponent(item.agentId)}`)}
              >
                <td className="col-name">
                  <span className="agent-name">{item.agentId}</span>
                </td>
                <td className="col-attestation-status">
                  <AttestationStatusBadge status={item.status} />
                </td>
                <td className="col-score">
                  {item.score !== null ? (
                    <span className="score-value">{item.score.toFixed(1)}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-tier">
                  {item.tier ? (
                    <TierBadge tier={item.tier as TrustTier} size="sm" />
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-source">
                  {item.sourceChain ? (
                    <span className="chain-badge monad" style={{ fontSize: '0.65rem' }}>
                      {item.sourceChain}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-freshness">
                  {item.attestedAt ? (
                    <FreshnessIndicator attestedAt={item.attestedAt} isFresh={item.isFresh} />
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-reviews">{item.feedbackCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AttestationStatusBadge({ status }: { status: AttestationStatus }) {
  const color = ATTESTATION_STATUS_COLORS[status];
  const label = ATTESTATION_STATUS_LABELS[status];

  return (
    <span
      className="attestation-status-badge"
      style={{
        color,
        borderColor: `${color}40`,
        backgroundColor: `${color}15`,
      }}
    >
      <span
        className="status-dot"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function FreshnessIndicator({ attestedAt, isFresh }: { attestedAt: number; isFresh: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - attestedAt;
  const hours = Math.floor(ageSeconds / 3600);
  const minutes = Math.floor((ageSeconds % 3600) / 60);

  let timeStr: string;
  if (hours > 24) {
    timeStr = `${Math.floor(hours / 24)}d ago`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes}m ago`;
  } else {
    timeStr = `${minutes}m ago`;
  }

  return (
    <span style={{ color: isFresh ? ATTESTATION_STATUS_COLORS.active : ATTESTATION_STATUS_COLORS.stale }}>
      {timeStr}
    </span>
  );
}
