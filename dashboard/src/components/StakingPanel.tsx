import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStakingOverview, useSlashHistory, useStakingStats } from '../hooks/useApi';
import { STAKE_TIER_COLORS, STAKE_TIER_LABELS } from '../types';
import type { StakingOverviewItem, SlashRecord } from '../types';

type Tab = 'overview' | 'slashes';

export default function StakingPanel() {
  const { data: overview, loading: overviewLoading } = useStakingOverview();
  const { data: slashes, loading: slashLoading } = useSlashHistory();
  const { data: stats, loading: statsLoading } = useStakingStats();
  const [tab, setTab] = useState<Tab>('overview');
  const navigate = useNavigate();

  const loading = overviewLoading || slashLoading || statsLoading;

  const maxStake = useMemo(
    () => Math.max(...(overview.map(o => o.totalStakeEth)), 0.01),
    [overview],
  );

  if (loading) return <div className="loading">Loading staking data...</div>;

  return (
    <div className="staking-panel">
      <div className="staking-header">
        <h2>Staking & Slashing</h2>
        <p className="subtitle">
          Crypto-economic security — agents stake MON as collateral, slashed for misbehavior
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="staking-stats-grid">
          <div className="staking-stat-card">
            <div className="staking-stat-value">{stats.totalAgentsStaked}</div>
            <div className="staking-stat-label">Agents Staked</div>
          </div>
          <div className="staking-stat-card">
            <div className="staking-stat-value">{stats.totalStakedEth.toFixed(3)} MON</div>
            <div className="staking-stat-label">Total Staked</div>
          </div>
          <div className="staking-stat-card slash">
            <div className="staking-stat-value">{stats.totalSlashEvents}</div>
            <div className="staking-stat-label">Slash Events</div>
          </div>
          <div className="staking-stat-card slash">
            <div className="staking-stat-value">{stats.totalSlashedEth.toFixed(4)} MON</div>
            <div className="staking-stat-label">Total Slashed</div>
          </div>
        </div>
      )}

      {/* Tier Distribution */}
      {stats && (
        <div className="tier-dist-bar">
          {Object.entries(stats.tierDistribution).map(([tier, count]) => {
            const tierNum = tier === 'Tier2Low' ? 1 : tier === 'Tier2Mid' ? 2 : tier === 'Tier2High' ? 3 : 0;
            if (count === 0 || tierNum === 0) return null;
            const pct = (count / stats.totalAgentsStaked) * 100;
            return (
              <div
                key={tier}
                className="tier-dist-segment"
                style={{
                  width: `${pct}%`,
                  backgroundColor: STAKE_TIER_COLORS[tierNum],
                }}
                title={`${STAKE_TIER_LABELS[tierNum]}: ${count} agents`}
              >
                <span className="tier-dist-label">{STAKE_TIER_LABELS[tierNum]?.split(' — ')[1] || tier}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="staking-tabs">
        <button
          className={`staking-tab ${tab === 'overview' ? 'active' : ''}`}
          onClick={() => setTab('overview')}
        >
          Staked Agents ({overview.length})
        </button>
        <button
          className={`staking-tab ${tab === 'slashes' ? 'active' : ''}`}
          onClick={() => setTab('slashes')}
        >
          Slash History ({slashes.length})
        </button>
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th className="col-name">Agent</th>
                <th className="col-stake">Publisher Stake</th>
                <th className="col-stake">Delegated</th>
                <th className="col-stake">Total</th>
                <th className="col-tier">Tier</th>
                <th className="col-status">Status</th>
                <th className="col-slashes">Slashes</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((item) => (
                <tr
                  key={item.agentId}
                  className={`agent-row ${item.slashCount > 0 ? 'slashed' : ''}`}
                  onClick={() => navigate(`/agent/${encodeURIComponent(item.agentId)}`)}
                >
                  <td className="col-name">
                    <span className="agent-name">{item.agentId}</span>
                  </td>
                  <td className="col-stake">
                    <div className="stake-cell">
                      <div className="stake-bar-track">
                        <div
                          className="stake-bar-fill publisher"
                          style={{ width: `${(item.stakeAmountEth / maxStake) * 100}%` }}
                        />
                      </div>
                      <span className="stake-val">{item.stakeAmountEth.toFixed(4)}</span>
                    </div>
                  </td>
                  <td className="col-stake">
                    <div className="stake-cell">
                      <div className="stake-bar-track">
                        <div
                          className="stake-bar-fill delegated"
                          style={{ width: `${(item.delegatedStakeEth / maxStake) * 100}%` }}
                        />
                      </div>
                      <span className="stake-val">{item.delegatedStakeEth.toFixed(4)}</span>
                    </div>
                  </td>
                  <td className="col-stake">
                    <span className="stake-total">{item.totalStakeEth.toFixed(4)}</span>
                  </td>
                  <td className="col-tier">
                    <span
                      className="stake-tier-badge"
                      style={{
                        color: STAKE_TIER_COLORS[item.tier],
                        borderColor: `${STAKE_TIER_COLORS[item.tier]}40`,
                      }}
                    >
                      {item.tierLabel?.split(' — ')[1] || 'None'}
                    </span>
                  </td>
                  <td className="col-status">
                    {item.active ? (
                      <span className="status-active">Active</span>
                    ) : (
                      <span className="status-inactive">Inactive</span>
                    )}
                  </td>
                  <td className="col-slashes">
                    {item.slashCount > 0 ? (
                      <span className="slash-badge">
                        {item.slashCount} ({item.totalSlashedEth.toFixed(4)} MON)
                      </span>
                    ) : (
                      <span className="no-slash">Clean</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Slash History Tab */}
      {tab === 'slashes' && (
        <div className="slash-history">
          {slashes.length === 0 ? (
            <div className="no-data">No slash events recorded</div>
          ) : (
            <div className="slash-list">
              {slashes
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((slash, i) => (
                  <div key={i} className="slash-card">
                    <div className="slash-card-header">
                      <span className="slash-agent">{slash.agentId}</span>
                      <span className="slash-amount">-{slash.amountEth.toFixed(4)} MON</span>
                    </div>
                    <div className="slash-reason">{slash.reason}</div>
                    <div className="slash-meta">
                      <span className="slash-time">
                        {new Date(slash.timestamp * 1000).toLocaleDateString()}
                      </span>
                      <span className="slash-reporter">
                        Reporter: {slash.reporter.slice(0, 10)}...
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
