import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInsuranceStats, useInsuranceClaims, useInsurancePool } from '../hooks/useApi';
import { CLAIM_STATUS_LABELS, CLAIM_STATUS_COLORS } from '../types';
import type { InsuranceClaim } from '../types';

type Tab = 'claims' | 'payouts';
type Filter = 'all' | 'pending' | 'paid' | 'rejected';

export default function InsurancePanel() {
  const { data: stats, loading: statsLoading } = useInsuranceStats();
  const { data: claims, loading: claimsLoading } = useInsuranceClaims();
  const { data: pool, loading: poolLoading } = useInsurancePool();
  const [tab, setTab] = useState<Tab>('claims');
  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();

  const loading = statsLoading || claimsLoading || poolLoading;

  const filteredClaims = useMemo(() => {
    if (filter === 'all') return claims;
    if (filter === 'pending') return claims.filter(c => c.status === 0);
    if (filter === 'paid') return claims.filter(c => c.status === 3);
    if (filter === 'rejected') return claims.filter(c => c.status === 2);
    return claims;
  }, [claims, filter]);

  const paidClaims = useMemo(
    () => claims.filter(c => c.status === 3).sort((a, b) => b.paidAt - a.paidAt),
    [claims],
  );

  const poolPercentUsed = useMemo(() => {
    if (!pool || pool.totalDepositedEth === 0) return 0;
    return (pool.totalPaidOutEth / pool.totalDepositedEth) * 100;
  }, [pool]);

  if (loading) return <div className="loading">Loading insurance pool data...</div>;

  return (
    <div className="insurance-panel">
      <div className="insurance-header">
        <h2>Insurance Pool</h2>
        <p className="subtitle">
          Community insurance funded by 30% of slash proceeds — compensates users harmed by malicious skills
        </p>
      </div>

      {/* Pool Balance Hero */}
      {pool && (
        <div className="pool-hero">
          <div className="pool-balance-card">
            <div className="pool-balance-label">Pool Balance</div>
            <div className="pool-balance-value">{pool.poolBalanceEth.toFixed(4)} ETH</div>
            <div className="pool-balance-bar">
              <div
                className="pool-balance-bar-fill"
                style={{ width: `${Math.min(100, 100 - poolPercentUsed)}%` }}
              />
              <div
                className="pool-balance-bar-used"
                style={{ width: `${Math.min(100, poolPercentUsed)}%` }}
              />
            </div>
            <div className="pool-balance-meta">
              <span>{pool.totalDepositedEth.toFixed(4)} deposited</span>
              <span>{pool.totalPaidOutEth.toFixed(4)} paid out</span>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="insurance-stats-grid">
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.totalClaims}</div>
            <div className="insurance-stat-label">Total Claims</div>
          </div>
          <div className="insurance-stat-card pending">
            <div className="insurance-stat-value">{stats.pendingClaims}</div>
            <div className="insurance-stat-label">Pending</div>
          </div>
          <div className="insurance-stat-card paid">
            <div className="insurance-stat-value">{stats.paidClaims}</div>
            <div className="insurance-stat-label">Paid Out</div>
          </div>
          <div className="insurance-stat-card rejected">
            <div className="insurance-stat-value">{stats.rejectedClaims}</div>
            <div className="insurance-stat-label">Rejected</div>
          </div>
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.avgPayoutEth.toFixed(4)} ETH</div>
            <div className="insurance-stat-label">Avg Payout</div>
          </div>
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">
              {stats.coverageRatio >= 1
                ? `${stats.coverageRatio.toFixed(1)}x`
                : `${(stats.coverageRatio * 100).toFixed(1)}%`}
            </div>
            <div className="insurance-stat-label">Pool / Staked</div>
          </div>
        </div>
      )}

      {/* Claim Status Distribution Bar */}
      {stats && stats.totalClaims > 0 && (
        <div className="claim-dist-bar">
          {stats.pendingClaims > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.pendingClaims / stats.totalClaims) * 100}%`,
                backgroundColor: CLAIM_STATUS_COLORS[0],
              }}
              title={`Pending: ${stats.pendingClaims} claims`}
            >
              <span className="claim-dist-label">Pending</span>
            </div>
          )}
          {stats.paidClaims > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.paidClaims / stats.totalClaims) * 100}%`,
                backgroundColor: CLAIM_STATUS_COLORS[3],
              }}
              title={`Paid: ${stats.paidClaims} claims`}
            >
              <span className="claim-dist-label">Paid</span>
            </div>
          )}
          {stats.approvedClaims > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.approvedClaims / stats.totalClaims) * 100}%`,
                backgroundColor: CLAIM_STATUS_COLORS[1],
              }}
              title={`Approved: ${stats.approvedClaims} claims`}
            >
              <span className="claim-dist-label">Approved</span>
            </div>
          )}
          {stats.rejectedClaims > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.rejectedClaims / stats.totalClaims) * 100}%`,
                backgroundColor: CLAIM_STATUS_COLORS[2],
              }}
              title={`Rejected: ${stats.rejectedClaims} claims`}
            >
              <span className="claim-dist-label">Rejected</span>
            </div>
          )}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="insurance-tabs">
        <button
          className={`insurance-tab ${tab === 'claims' ? 'active' : ''}`}
          onClick={() => setTab('claims')}
        >
          Active Claims ({claims.length})
        </button>
        <button
          className={`insurance-tab ${tab === 'payouts' ? 'active' : ''}`}
          onClick={() => setTab('payouts')}
        >
          Payout History ({paidClaims.length})
        </button>
      </div>

      {/* Claims Tab */}
      {tab === 'claims' && (
        <>
          {/* Filter Bar */}
          <div className="claim-filter-bar">
            {(['all', 'pending', 'paid', 'rejected'] as Filter[]).map(f => (
              <button
                key={f}
                className={`claim-filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th className="col-id">ID</th>
                  <th className="col-name">Agent</th>
                  <th className="col-stake">Claimed</th>
                  <th className="col-stake">Payout</th>
                  <th className="col-status">Status</th>
                  <th className="col-votes">Votes</th>
                  <th className="col-time">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {filteredClaims.map((claim) => (
                  <tr
                    key={claim.id}
                    className={`claim-row status-${claim.status}`}
                    onClick={() => navigate(`/agent/${encodeURIComponent(claim.agentId)}`)}
                  >
                    <td className="col-id">
                      <span className="claim-id">#{claim.id}</span>
                    </td>
                    <td className="col-name">
                      <span className="agent-name">{claim.agentId}</span>
                    </td>
                    <td className="col-stake">
                      <span className="claim-amount">{claim.amountEth.toFixed(4)} ETH</span>
                    </td>
                    <td className="col-stake">
                      {claim.payoutAmountEth > 0 ? (
                        <span className="claim-payout">{claim.payoutAmountEth.toFixed(4)} ETH</span>
                      ) : (
                        <span className="claim-no-payout">—</span>
                      )}
                    </td>
                    <td className="col-status">
                      <span
                        className="claim-status-badge"
                        style={{
                          color: CLAIM_STATUS_COLORS[claim.status],
                          borderColor: `${CLAIM_STATUS_COLORS[claim.status]}40`,
                        }}
                      >
                        {CLAIM_STATUS_LABELS[claim.status]}
                      </span>
                    </td>
                    <td className="col-votes">
                      <span className="votes-approve" title="Approve votes">{claim.approveVotes}</span>
                      <span className="votes-separator">/</span>
                      <span className="votes-reject" title="Reject votes">{claim.rejectVotes}</span>
                    </td>
                    <td className="col-time">
                      <span className="claim-time">
                        {new Date(claim.submittedAt * 1000).toLocaleDateString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredClaims.length === 0 && (
              <div className="no-data">No claims match filter</div>
            )}
          </div>
        </>
      )}

      {/* Payout History Tab */}
      {tab === 'payouts' && (
        <div className="payout-history">
          {paidClaims.length === 0 ? (
            <div className="no-data">No payouts recorded</div>
          ) : (
            <div className="payout-list">
              {paidClaims.map((claim) => (
                <div
                  key={claim.id}
                  className="payout-card"
                  onClick={() => navigate(`/agent/${encodeURIComponent(claim.agentId)}`)}
                >
                  <div className="payout-card-header">
                    <span className="payout-agent">{claim.agentId}</span>
                    <span className="payout-amount">{claim.payoutAmountEth.toFixed(4)} ETH</span>
                  </div>
                  <div className="payout-details">
                    <span className="payout-claimed">
                      Claimed: {claim.amountEth.toFixed(4)} ETH
                    </span>
                    <span className="payout-ratio">
                      ({((claim.payoutAmountEth / claim.amountEth) * 100).toFixed(0)}% of claim)
                    </span>
                  </div>
                  <div className="payout-meta">
                    <span className="payout-time">
                      Paid: {new Date(claim.paidAt * 1000).toLocaleDateString()}
                    </span>
                    <span className="payout-claimant">
                      To: {claim.claimant.slice(0, 12)}...
                    </span>
                    <span className="payout-votes">
                      Votes: {claim.approveVotes} approve / {claim.rejectVotes} reject
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Funding Source Info */}
      <div className="insurance-funding-info">
        <h3>Funding Sources</h3>
        <div className="funding-sources">
          <div className="funding-source">
            <div className="funding-source-pct">30%</div>
            <div className="funding-source-label">of Slash Proceeds</div>
            <div className="funding-source-desc">Every slash distributes 30% to the insurance pool automatically</div>
          </div>
          <div className="funding-source">
            <div className="funding-source-pct">5%</div>
            <div className="funding-source-label">of Treasury Revenue</div>
            <div className="funding-source-desc">Ongoing protocol revenue contribution</div>
          </div>
          <div className="funding-source">
            <div className="funding-source-pct">50%</div>
            <div className="funding-source-label">Max Payout Cap</div>
            <div className="funding-source-desc">No single claim can exceed 50% of pool balance</div>
          </div>
        </div>
      </div>
    </div>
  );
}
