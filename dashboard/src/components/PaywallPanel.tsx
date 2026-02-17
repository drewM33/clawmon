import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaymentStats, usePaymentOverview, usePaymentActivity } from '../hooks/useApi';
import { TIER_COLORS, TIER_BAND_COLORS, TIER_BAND_LABELS } from '../types';
import type { PaymentOverviewItem, TrustTier } from '../types';

type Tab = 'overview' | 'activity' | 'revenue';
type TierFilter = 'all' | 'premium' | 'standard' | 'budget';

function getTierBand(tier: TrustTier): 'premium' | 'standard' | 'budget' {
  if (['AAA', 'AA', 'A'].includes(tier)) return 'premium';
  if (['BBB', 'BB', 'B'].includes(tier)) return 'standard';
  return 'budget';
}

export default function PaywallPanel() {
  const { data: stats, loading: statsLoading } = usePaymentStats();
  const { data: overview, loading: overviewLoading } = usePaymentOverview();
  const { data: activity, loading: activityLoading } = usePaymentActivity();
  const [tab, setTab] = useState<Tab>('overview');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const navigate = useNavigate();

  const loading = statsLoading || overviewLoading || activityLoading;

  const filteredOverview = useMemo(() => {
    if (tierFilter === 'all') return overview;
    return overview.filter(p => getTierBand(p.trustTier) === tierFilter);
  }, [overview, tierFilter]);

  const revenueTotal = useMemo(() => {
    if (!stats) return 0;
    return stats.revenueByTier.premium + stats.revenueByTier.standard + stats.revenueByTier.budget;
  }, [stats]);

  if (loading) return <div className="loading">Loading x402 payment data...</div>;

  return (
    <div className="insurance-panel">
      <div className="insurance-header">
        <h2>x402 Paywall</h2>
        <p className="subtitle">
          Per-use micropayments for skill invocations — pricing influenced by trust tier, fees fund protocol + insurance
        </p>
      </div>

      {/* Revenue Hero */}
      {stats && (
        <div className="pool-hero">
          <div className="pool-balance-card">
            <div className="pool-balance-label">Total Protocol Revenue</div>
            <div className="pool-balance-value">{stats.totalRevenueEth.toFixed(4)} MON</div>
            <div className="pool-balance-bar">
              {revenueTotal > 0 && (
                <>
                  <div
                    className="pool-balance-bar-fill"
                    style={{
                      width: `${(stats.totalPublisherPayoutsEth / revenueTotal) * 100}%`,
                      backgroundColor: '#22c55e',
                    }}
                    title={`Publisher: ${stats.totalPublisherPayoutsEth.toFixed(4)} MON`}
                  />
                  <div
                    className="pool-balance-bar-fill"
                    style={{
                      width: `${(stats.totalProtocolRevenueEth / revenueTotal) * 100}%`,
                      backgroundColor: '#3b82f6',
                    }}
                    title={`Protocol: ${stats.totalProtocolRevenueEth.toFixed(4)} MON`}
                  />
                  <div
                    className="pool-balance-bar-used"
                    style={{
                      width: `${(stats.totalInsuranceContributionsEth / revenueTotal) * 100}%`,
                      backgroundColor: '#f59e0b',
                    }}
                    title={`Insurance: ${stats.totalInsuranceContributionsEth.toFixed(4)} MON`}
                  />
                </>
              )}
            </div>
            <div className="pool-balance-meta">
              <span style={{ color: '#22c55e' }}>
                {stats.totalPublisherPayoutsEth.toFixed(4)} publishers (80%)
              </span>
              <span style={{ color: '#3b82f6' }}>
                {stats.totalProtocolRevenueEth.toFixed(4)} protocol (10%)
              </span>
              <span style={{ color: '#f59e0b' }}>
                {stats.totalInsuranceContributionsEth.toFixed(4)} insurance (10%)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="insurance-stats-grid">
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.totalPayments.toLocaleString()}</div>
            <div className="insurance-stat-label">Total Payments</div>
          </div>
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.registeredSkillCount}</div>
            <div className="insurance-stat-label">Skills Registered</div>
          </div>
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.uniqueCallers}</div>
            <div className="insurance-stat-label">Unique Callers</div>
          </div>
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.avgPaymentEth.toFixed(4)} MON</div>
            <div className="insurance-stat-label">Avg Payment</div>
          </div>
          <div className="insurance-stat-card" style={{ borderColor: '#f59e0b40' }}>
            <div className="insurance-stat-value" style={{ color: '#f59e0b' }}>
              {stats.stakingYieldApr > 0 ? `${stats.stakingYieldApr.toFixed(1)}%` : 'N/A'}
            </div>
            <div className="insurance-stat-label">Staking Yield APR</div>
          </div>
          <div className="insurance-stat-card">
            <div className="insurance-stat-value">{stats.activeSkillCount}</div>
            <div className="insurance-stat-label">Active Skills</div>
          </div>
        </div>
      )}

      {/* Revenue by Tier Distribution Bar */}
      {stats && revenueTotal > 0 && (
        <div className="claim-dist-bar">
          {stats.revenueByTier.premium > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.revenueByTier.premium / revenueTotal) * 100}%`,
                backgroundColor: TIER_BAND_COLORS.premium,
              }}
              title={`Premium: ${stats.revenueByTier.premium.toFixed(4)} MON`}
            >
              <span className="claim-dist-label">Premium</span>
            </div>
          )}
          {stats.revenueByTier.standard > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.revenueByTier.standard / revenueTotal) * 100}%`,
                backgroundColor: TIER_BAND_COLORS.standard,
              }}
              title={`Standard: ${stats.revenueByTier.standard.toFixed(4)} MON`}
            >
              <span className="claim-dist-label">Standard</span>
            </div>
          )}
          {stats.revenueByTier.budget > 0 && (
            <div
              className="claim-dist-segment"
              style={{
                width: `${(stats.revenueByTier.budget / revenueTotal) * 100}%`,
                backgroundColor: TIER_BAND_COLORS.budget,
              }}
              title={`Budget: ${stats.revenueByTier.budget.toFixed(4)} MON`}
            >
              <span className="claim-dist-label">Budget</span>
            </div>
          )}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="insurance-tabs">
        <button
          className={`insurance-tab ${tab === 'overview' ? 'active' : ''}`}
          onClick={() => setTab('overview')}
        >
          Skill Pricing ({overview.length})
        </button>
        <button
          className={`insurance-tab ${tab === 'activity' ? 'active' : ''}`}
          onClick={() => setTab('activity')}
        >
          Payment Activity ({activity.length})
        </button>
        <button
          className={`insurance-tab ${tab === 'revenue' ? 'active' : ''}`}
          onClick={() => setTab('revenue')}
        >
          Top Revenue ({stats?.topSkills.length ?? 0})
        </button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <>
          {/* Tier Filter */}
          <div className="claim-filter-bar">
            {(['all', 'premium', 'standard', 'budget'] as TierFilter[]).map(f => (
              <button
                key={f}
                className={`claim-filter-btn ${tierFilter === f ? 'active' : ''}`}
                onClick={() => setTierFilter(f)}
              >
                {f === 'all' ? 'All' : TIER_BAND_LABELS[f]}
              </button>
            ))}
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th className="col-name">Skill</th>
                  <th className="col-status">Tier</th>
                  <th className="col-stake">Base Price</th>
                  <th className="col-stake">Effective Price</th>
                  <th className="col-id">Payments</th>
                  <th className="col-stake">Revenue</th>
                  <th className="col-stake">Velocity</th>
                </tr>
              </thead>
              <tbody>
                {filteredOverview.map((item) => (
                  <tr
                    key={item.agentId}
                    className="claim-row"
                    onClick={() => navigate(`/agent/${encodeURIComponent(item.agentId)}`)}
                  >
                    <td className="col-name">
                      <span className="agent-name">{item.agentId}</span>
                      <span className="agent-publisher" style={{ display: 'block', fontSize: '0.75rem', opacity: 0.6 }}>
                        {item.publisher}
                      </span>
                    </td>
                    <td className="col-status">
                      <span
                        className="claim-status-badge"
                        style={{
                          color: TIER_COLORS[item.trustTier],
                          borderColor: `${TIER_COLORS[item.trustTier]}40`,
                        }}
                      >
                        {item.trustTier}
                      </span>
                      <span style={{ fontSize: '0.7rem', opacity: 0.5, marginLeft: '4px' }}>
                        {item.tierMultiplier}x
                      </span>
                    </td>
                    <td className="col-stake">
                      <span className="claim-amount">{item.basePriceEth.toFixed(4)}</span>
                    </td>
                    <td className="col-stake">
                      <span className="claim-payout">{item.effectivePriceEth.toFixed(4)}</span>
                    </td>
                    <td className="col-id">
                      <span>{item.totalPayments}</span>
                    </td>
                    <td className="col-stake">
                      <span className="claim-amount">{item.totalRevenueEth.toFixed(4)} MON</span>
                    </td>
                    <td className="col-stake">
                      <span style={{ color: item.paymentVelocity > 5 ? '#f59e0b' : '#8b8b9b' }}>
                        {item.paymentVelocity.toFixed(1)}/hr
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredOverview.length === 0 && (
              <div className="no-data">No skills match filter</div>
            )}
          </div>
        </>
      )}

      {/* Activity Tab */}
      {tab === 'activity' && (
        <div className="payout-history">
          {activity.length === 0 ? (
            <div className="no-data">No payment activity</div>
          ) : (
            <div className="payout-list">
              {activity.slice(0, 30).map((item) => (
                <div
                  key={item.paymentId}
                  className="payout-card"
                  onClick={() => navigate(`/agent/${encodeURIComponent(item.agentId)}`)}
                >
                  <div className="payout-card-header">
                    <span className="payout-agent">{item.agentId}</span>
                    <span className="payout-amount">{item.amount.toFixed(4)} MON</span>
                  </div>
                  <div className="payout-details">
                    <span
                      className="claim-status-badge"
                      style={{
                        color: TIER_COLORS[item.trustTier],
                        borderColor: `${TIER_COLORS[item.trustTier]}40`,
                        fontSize: '0.7rem',
                      }}
                    >
                      {item.trustTier}
                    </span>
                    <span className="payout-ratio" style={{ marginLeft: '8px' }}>
                      ID: {item.paymentId}
                    </span>
                  </div>
                  <div className="payout-meta">
                    <span className="payout-time">
                      {new Date(item.timestamp).toLocaleDateString()}
                    </span>
                    <span className="payout-claimant">
                      Caller: {item.caller.slice(0, 16)}...
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Revenue Tab */}
      {tab === 'revenue' && stats && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th className="col-id">Rank</th>
                <th className="col-name">Skill</th>
                <th className="col-stake">Revenue</th>
                <th className="col-id">Payments</th>
                <th className="col-stake">Avg/Payment</th>
              </tr>
            </thead>
            <tbody>
              {stats.topSkills.map((skill, idx) => (
                <tr
                  key={skill.agentId}
                  className="claim-row"
                  onClick={() => navigate(`/agent/${encodeURIComponent(skill.agentId)}`)}
                >
                  <td className="col-id">
                    <span className="claim-id" style={{
                      color: idx === 0 ? '#f59e0b' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#8b8b9b',
                    }}>
                      #{idx + 1}
                    </span>
                  </td>
                  <td className="col-name">
                    <span className="agent-name">{skill.agentId}</span>
                  </td>
                  <td className="col-stake">
                    <span className="claim-payout">{skill.revenueEth.toFixed(4)} MON</span>
                  </td>
                  <td className="col-id">
                    <span>{skill.paymentCount}</span>
                  </td>
                  <td className="col-stake">
                    <span className="claim-amount">
                      {skill.paymentCount > 0
                        ? (skill.revenueEth / skill.paymentCount).toFixed(4)
                        : '0.0000'} MON
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.topSkills.length === 0 && (
            <div className="no-data">No payment data available</div>
          )}
        </div>
      )}

      {/* Fee Structure Info */}
      <div className="insurance-funding-info">
        <h3>x402 Fee Structure</h3>
        <div className="funding-sources">
          <div className="funding-source">
            <div className="funding-source-pct">80%</div>
            <div className="funding-source-label">Skill Publisher</div>
            <div className="funding-source-desc">Majority share goes to the skill developer</div>
          </div>
          <div className="funding-source">
            <div className="funding-source-pct">10%</div>
            <div className="funding-source-label">Protocol Treasury</div>
            <div className="funding-source-desc">60% staking yields, 30% insurance, 10% operations</div>
          </div>
          <div className="funding-source">
            <div className="funding-source-pct">10%</div>
            <div className="funding-source-label">Insurance Pool</div>
            <div className="funding-source-desc">Direct contribution to victim compensation pool</div>
          </div>
        </div>
        <h3 style={{ marginTop: '1rem' }}>Tier-Based Pricing</h3>
        <div className="funding-sources">
          <div className="funding-source">
            <div className="funding-source-pct" style={{ color: TIER_BAND_COLORS.premium }}>2.0x</div>
            <div className="funding-source-label">Premium (AAA/AA/A)</div>
            <div className="funding-source-desc">High-trust skills command premium pricing</div>
          </div>
          <div className="funding-source">
            <div className="funding-source-pct" style={{ color: TIER_BAND_COLORS.standard }}>1.0x</div>
            <div className="funding-source-label">Standard (BBB/BB/B)</div>
            <div className="funding-source-desc">Base price for moderately trusted skills</div>
          </div>
          <div className="funding-source">
            <div className="funding-source-pct" style={{ color: TIER_BAND_COLORS.budget }}>0.5x</div>
            <div className="funding-source-label">Budget (CCC/CC/C)</div>
            <div className="funding-source-desc">Discounted or free for low-trust skills</div>
          </div>
        </div>
      </div>
    </div>
  );
}
