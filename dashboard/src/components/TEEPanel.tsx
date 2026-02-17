import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTEEOverview, useTEEStats } from '../hooks/useApi';
import type { TEEOverviewItem, TEEStatus } from '../types';
import { TEE_STATUS_COLORS, TEE_STATUS_LABELS } from '../types';

type FilterMode = 'all' | TEEStatus;

export default function TEEPanel() {
  const { data: overview, loading: overviewLoading } = useTEEOverview();
  const { data: stats, loading: statsLoading } = useTEEStats();
  const [filter, setFilter] = useState<FilterMode>('all');
  const navigate = useNavigate();

  const loading = overviewLoading || statsLoading;

  const filtered = useMemo(() => {
    if (filter === 'all') return overview;
    return overview.filter(a => a.status === filter);
  }, [overview, filter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      const statusOrder: Record<TEEStatus, number> = {
        verified: 0,
        stale: 1,
        mismatch: 2,
        failed: 3,
        unregistered: 4,
      };
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      return (b.trustWeight ?? 0) - (a.trustWeight ?? 0);
    }),
    [filtered],
  );

  if (loading) return <div className="loading">Loading TEE attestation data...</div>;

  return (
    <div className="tee-panel">
      <div className="tee-header">
        <h2>TEE Attestation — Hard Trust (Tier 3)</h2>
        <p className="subtitle">
          Cryptographic runtime verification via Trusted Execution Environment — proving agent code
          hasn't been modified and behavior is clean
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="tee-stats-grid">
          <div className="tee-stat-card">
            <div className="tee-stat-value">{stats.totalRegistered}</div>
            <div className="tee-stat-label">TEE Registered</div>
          </div>
          <div className="tee-stat-card verified">
            <div className="tee-stat-value" style={{ color: TEE_STATUS_COLORS.verified }}>
              {stats.verifiedCount}
            </div>
            <div className="tee-stat-label">Verified</div>
          </div>
          <div className="tee-stat-card tier3">
            <div className="tee-stat-value" style={{ color: '#a78bfa' }}>
              {stats.tier3ActiveCount}
            </div>
            <div className="tee-stat-label">Tier 3 Active</div>
          </div>
          <div className="tee-stat-card stale">
            <div className="tee-stat-value" style={{ color: TEE_STATUS_COLORS.stale }}>
              {stats.staleCount}
            </div>
            <div className="tee-stat-label">Stale</div>
          </div>
          <div className="tee-stat-card failed">
            <div className="tee-stat-value" style={{ color: TEE_STATUS_COLORS.failed }}>
              {stats.failedCount + stats.mismatchCount}
            </div>
            <div className="tee-stat-label">Failed / Mismatch</div>
          </div>
          <div className="tee-stat-card">
            <div className="tee-stat-value" style={{ color: 'var(--text-muted)' }}>
              {stats.unregisteredCount}
            </div>
            <div className="tee-stat-label">Unregistered</div>
          </div>
        </div>
      )}

      {/* Enclave Info Banner */}
      {stats && (
        <div className="tee-info-banner">
          <div className="tee-info-item">
            <span className="tee-info-label">Platform</span>
            <span className="tee-info-value chain-badge" style={{
              background: 'rgba(167, 139, 250, 0.15)',
              color: '#a78bfa',
              border: '1px solid rgba(167, 139, 250, 0.3)',
            }}>
              {stats.platformType.toUpperCase()}
            </span>
          </div>
          <div className="tee-info-item">
            <span className="tee-info-label">Avg Trust Weight</span>
            <span className="tee-info-value" style={{
              color: stats.avgTrustWeight > 1 ? '#22c55e' : 'var(--text-muted)',
            }}>
              {stats.avgTrustWeight.toFixed(2)}x
            </span>
          </div>
          <div className="tee-info-item">
            <span className="tee-info-label">Avg Exec Time</span>
            <span className="tee-info-value">
              {stats.avgExecutionTimeMs > 0
                ? `${(stats.avgExecutionTimeMs / 1000).toFixed(1)}s`
                : '—'}
            </span>
          </div>
          <div className="tee-info-item">
            <span className="tee-info-label">Total Attestations</span>
            <span className="tee-info-value">{stats.totalAttestations}</span>
          </div>
          <div className="tee-info-item">
            <span className="tee-info-label">Enclave Key</span>
            <span className="tee-info-value" style={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>
              {stats.enclavePublicKey.slice(0, 16)}...{stats.enclavePublicKey.slice(-8)}
            </span>
          </div>
        </div>
      )}

      {/* Trust Tier Distribution Bar */}
      {stats && stats.totalRegistered > 0 && (
        <div className="tee-tier-dist">
          {[
            { key: 'verified', count: stats.verifiedCount, color: TEE_STATUS_COLORS.verified, label: 'Verified' },
            { key: 'stale', count: stats.staleCount, color: TEE_STATUS_COLORS.stale, label: 'Stale' },
            { key: 'mismatch', count: stats.mismatchCount, color: TEE_STATUS_COLORS.mismatch, label: 'Mismatch' },
            { key: 'failed', count: stats.failedCount, color: TEE_STATUS_COLORS.failed, label: 'Failed' },
          ].filter(s => s.count > 0).map(segment => {
            const pct = (segment.count / stats.totalRegistered) * 100;
            return (
              <div
                key={segment.key}
                className="tier-dist-segment"
                style={{
                  width: `${Math.max(pct, 4)}%`,
                  backgroundColor: segment.color,
                }}
                title={`${segment.label}: ${segment.count} agents (${pct.toFixed(1)}%)`}
              >
                <span className="tier-dist-label">{segment.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter Bar */}
      <div className="filter-bar">
        {(['all', 'verified', 'stale', 'mismatch', 'failed', 'unregistered'] as const).map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : TEE_STATUS_LABELS[f as TEEStatus]}
            <span className="filter-count">
              {f === 'all'
                ? overview.length
                : overview.filter(a => a.status === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* TEE Attestation Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="col-name">Agent</th>
              <th className="col-tee-status">TEE Status</th>
              <th className="col-tier3">Tier 3</th>
              <th className="col-trust-weight">Trust Weight</th>
              <th className="col-code-hash">Code Hash</th>
              <th className="col-exec-time">Exec Time</th>
              <th className="col-api-calls">API Calls</th>
              <th className="col-errors">Errors</th>
              <th className="col-attestations">Attestations</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr
                key={item.agentId}
                className={`agent-row ${item.status === 'failed' || item.status === 'mismatch' ? 'flagged' : ''}`}
                onClick={() => navigate(`/agent/${encodeURIComponent(item.agentId)}`)}
              >
                <td className="col-name">
                  <span className="agent-name">{item.agentId}</span>
                </td>
                <td className="col-tee-status">
                  <TEEStatusBadge status={item.status} />
                </td>
                <td className="col-tier3">
                  {item.tier3Active ? (
                    <span className="tier3-badge active">TIER 3</span>
                  ) : (
                    <span className="tier3-badge inactive">—</span>
                  )}
                </td>
                <td className="col-trust-weight">
                  <span style={{
                    color: item.trustWeight > 1 ? '#22c55e' : item.trustWeight < 1 ? '#ef4444' : 'var(--text-muted)',
                    fontWeight: item.trustWeight !== 1 ? 600 : 400,
                  }}>
                    {item.trustWeight.toFixed(2)}x
                  </span>
                </td>
                <td className="col-code-hash">
                  {item.codeHash ? (
                    <CodeHashBadge
                      codeHash={item.codeHash}
                      pinnedHash={item.pinnedCodeHash}
                      match={item.codeHashMatch}
                    />
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-exec-time">
                  {item.executionTimeMs !== null ? (
                    <span style={{
                      color: item.executionTimeMs > 10000 ? '#f59e0b' : 'var(--text-primary)',
                    }}>
                      {(item.executionTimeMs / 1000).toFixed(1)}s
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-api-calls">
                  {item.apiCallCount !== null ? (
                    <span style={{
                      color: (item.apiCallCount ?? 0) > 20 ? '#f59e0b' : 'var(--text-primary)',
                    }}>
                      {item.apiCallCount}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-errors">
                  {item.errorCount !== null ? (
                    <span style={{
                      color: (item.errorCount ?? 0) > 0 ? '#ef4444' : '#22c55e',
                      fontWeight: (item.errorCount ?? 0) > 0 ? 600 : 400,
                    }}>
                      {item.errorCount}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td className="col-attestations">{item.attestationCount}</td>
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

function TEEStatusBadge({ status }: { status: TEEStatus }) {
  const color = TEE_STATUS_COLORS[status];
  const label = TEE_STATUS_LABELS[status];

  return (
    <span
      className="tee-status-badge"
      style={{
        color,
        borderColor: `${color}40`,
        backgroundColor: `${color}15`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.15rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 600,
        border: '1px solid',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

function CodeHashBadge({
  codeHash,
  pinnedHash,
  match,
}: {
  codeHash: string;
  pinnedHash: string | null;
  match: boolean;
}) {
  const color = match ? '#22c55e' : pinnedHash ? '#ef4444' : 'var(--text-muted)';
  const icon = match ? '\u2713' : pinnedHash ? '\u2717' : '?';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      <span style={{
        color,
        fontWeight: 700,
        fontSize: '0.8rem',
      }}>
        {icon}
      </span>
      <span style={{
        fontFamily: 'monospace',
        fontSize: '0.65rem',
        color: 'var(--text-muted)',
      }}>
        {codeHash.slice(0, 8)}...
      </span>
    </span>
  );
}
