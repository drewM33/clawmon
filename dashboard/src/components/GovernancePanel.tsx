import { useState, useMemo } from 'react';
import {
  useGovernanceStats,
  useGovernanceProposals,
  useGovernanceParameters,
  useProposalDetail,
} from '../hooks/useApi';
import {
  ProposalStatus,
  VoteType,
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_COLORS,
  PARAMETER_CATEGORY_LABELS,
  PARAMETER_CATEGORY_COLORS,
} from '../types';
import type {
  ProposalListItem,
  GovernableParameter,
  ParameterCategory,
} from '../types';

type Tab = 'proposals' | 'parameters' | 'detail';
type ProposalFilter = 'all' | 'active' | 'queued' | 'executed' | 'defeated' | 'cancelled';

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ended';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(ts: number): string {
  if (ts === 0) return '—';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function VoteBar({ forVotes, againstVotes, quorumReached }: { forVotes: number; againstVotes: number; quorumReached: boolean }) {
  const total = forVotes + againstVotes;
  if (total === 0) {
    return (
      <div className="vote-bar-container">
        <div className="vote-bar empty">
          <span className="vote-bar-label">No votes yet</span>
        </div>
      </div>
    );
  }

  const forPct = (forVotes / total) * 100;
  const againstPct = 100 - forPct;

  return (
    <div className="vote-bar-container">
      <div className="vote-bar">
        <div
          className="vote-bar-for"
          style={{ width: `${forPct}%` }}
          title={`For: ${forVotes.toFixed(4)} ETH (${forPct.toFixed(1)}%)`}
        />
        <div
          className="vote-bar-against"
          style={{ width: `${againstPct}%` }}
          title={`Against: ${againstVotes.toFixed(4)} ETH (${againstPct.toFixed(1)}%)`}
        />
      </div>
      <div className="vote-bar-labels">
        <span className="vote-for-label">{forVotes.toFixed(3)} ETH For</span>
        {quorumReached && <span className="quorum-badge">Quorum</span>}
        <span className="vote-against-label">{againstVotes.toFixed(3)} ETH Against</span>
      </div>
    </div>
  );
}

export default function GovernancePanel() {
  const { data: stats, loading: statsLoading } = useGovernanceStats();
  const { data: proposals, loading: proposalsLoading } = useGovernanceProposals();
  const { data: parameters, loading: paramsLoading } = useGovernanceParameters();
  const [tab, setTab] = useState<Tab>('proposals');
  const [filter, setFilter] = useState<ProposalFilter>('all');
  const [selectedProposalId, setSelectedProposalId] = useState<number | undefined>(undefined);
  const { data: proposalDetail, loading: detailLoading } = useProposalDetail(selectedProposalId);

  const loading = statsLoading || proposalsLoading || paramsLoading;

  const filteredProposals = useMemo(() => {
    if (filter === 'all') return proposals;
    const statusMap: Record<string, ProposalStatus> = {
      active: ProposalStatus.Active,
      queued: ProposalStatus.Queued,
      executed: ProposalStatus.Executed,
      defeated: ProposalStatus.Defeated,
      cancelled: ProposalStatus.Cancelled,
    };
    return proposals.filter(p => p.status === statusMap[filter]);
  }, [proposals, filter]);

  const paramsByCategory = useMemo(() => {
    const grouped: Record<ParameterCategory, GovernableParameter[]> = {
      scoring: [], staking: [], slashing: [], insurance: [],
      review: [], tee: [], 'cross-chain': [],
    };
    for (const p of parameters) {
      grouped[p.category].push(p);
    }
    return grouped;
  }, [parameters]);

  if (loading) return <div className="loading">Loading governance data...</div>;

  return (
    <div className="governance-panel">
      <div className="governance-header">
        <h2>Governance</h2>
        <p className="subtitle">
          Proposal and voting system for protocol parameter changes — owner-gated creation with community stake-weighted voting
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="governance-stats-grid">
          <div className="governance-stat-card">
            <div className="governance-stat-value">{stats.totalProposals}</div>
            <div className="governance-stat-label">Total Proposals</div>
          </div>
          <div className="governance-stat-card active">
            <div className="governance-stat-value">{stats.activeProposals}</div>
            <div className="governance-stat-label">Active</div>
          </div>
          <div className="governance-stat-card queued">
            <div className="governance-stat-value">{stats.queuedProposals}</div>
            <div className="governance-stat-label">Queued</div>
          </div>
          <div className="governance-stat-card executed">
            <div className="governance-stat-value">{stats.executedProposals}</div>
            <div className="governance-stat-label">Executed</div>
          </div>
          <div className="governance-stat-card">
            <div className="governance-stat-value">{stats.totalVotesCast}</div>
            <div className="governance-stat-label">Votes Cast</div>
          </div>
          <div className="governance-stat-card">
            <div className="governance-stat-value">{stats.participationRate}%</div>
            <div className="governance-stat-label">Quorum Rate</div>
          </div>
        </div>
      )}

      {/* Status Distribution Bar */}
      {stats && stats.totalProposals > 0 && (
        <div className="proposal-dist-bar">
          {stats.activeProposals > 0 && (
            <div
              className="proposal-dist-segment"
              style={{
                width: `${(stats.activeProposals / stats.totalProposals) * 100}%`,
                backgroundColor: PROPOSAL_STATUS_COLORS[ProposalStatus.Active],
              }}
              title={`Active: ${stats.activeProposals}`}
            >
              <span className="proposal-dist-label">Active</span>
            </div>
          )}
          {stats.queuedProposals > 0 && (
            <div
              className="proposal-dist-segment"
              style={{
                width: `${(stats.queuedProposals / stats.totalProposals) * 100}%`,
                backgroundColor: PROPOSAL_STATUS_COLORS[ProposalStatus.Queued],
              }}
              title={`Queued: ${stats.queuedProposals}`}
            >
              <span className="proposal-dist-label">Queued</span>
            </div>
          )}
          {stats.executedProposals > 0 && (
            <div
              className="proposal-dist-segment"
              style={{
                width: `${(stats.executedProposals / stats.totalProposals) * 100}%`,
                backgroundColor: PROPOSAL_STATUS_COLORS[ProposalStatus.Executed],
              }}
              title={`Executed: ${stats.executedProposals}`}
            >
              <span className="proposal-dist-label">Executed</span>
            </div>
          )}
          {stats.defeatedProposals > 0 && (
            <div
              className="proposal-dist-segment"
              style={{
                width: `${(stats.defeatedProposals / stats.totalProposals) * 100}%`,
                backgroundColor: PROPOSAL_STATUS_COLORS[ProposalStatus.Defeated],
              }}
              title={`Defeated: ${stats.defeatedProposals}`}
            >
              <span className="proposal-dist-label">Defeated</span>
            </div>
          )}
          {stats.cancelledProposals > 0 && (
            <div
              className="proposal-dist-segment"
              style={{
                width: `${(stats.cancelledProposals / stats.totalProposals) * 100}%`,
                backgroundColor: PROPOSAL_STATUS_COLORS[ProposalStatus.Cancelled],
              }}
              title={`Cancelled: ${stats.cancelledProposals}`}
            >
              <span className="proposal-dist-label">Cancelled</span>
            </div>
          )}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="governance-tabs">
        <button
          className={`governance-tab ${tab === 'proposals' ? 'active' : ''}`}
          onClick={() => { setTab('proposals'); setSelectedProposalId(undefined); }}
        >
          Proposals ({proposals.length})
        </button>
        <button
          className={`governance-tab ${tab === 'parameters' ? 'active' : ''}`}
          onClick={() => { setTab('parameters'); setSelectedProposalId(undefined); }}
        >
          Parameters ({parameters.length})
        </button>
        {selectedProposalId !== undefined && (
          <button
            className={`governance-tab ${tab === 'detail' ? 'active' : ''}`}
            onClick={() => setTab('detail')}
          >
            Proposal #{selectedProposalId}
          </button>
        )}
      </div>

      {/* Proposals Tab */}
      {tab === 'proposals' && (
        <>
          <div className="proposal-filter-bar">
            {(['all', 'active', 'queued', 'executed', 'defeated', 'cancelled'] as ProposalFilter[]).map(f => (
              <button
                key={f}
                className={`proposal-filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="proposal-list">
            {filteredProposals.length === 0 ? (
              <div className="no-data">No proposals match filter</div>
            ) : (
              filteredProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className={`proposal-card status-${proposal.status}`}
                  onClick={() => {
                    setSelectedProposalId(proposal.id);
                    setTab('detail');
                  }}
                >
                  <div className="proposal-card-header">
                    <div className="proposal-card-left">
                      <span className="proposal-id">#{proposal.id}</span>
                      <span
                        className="proposal-status-badge"
                        style={{
                          color: PROPOSAL_STATUS_COLORS[proposal.status],
                          borderColor: `${PROPOSAL_STATUS_COLORS[proposal.status]}40`,
                        }}
                      >
                        {proposal.statusLabel}
                      </span>
                      <span className="proposal-param-key">{proposal.paramKey}</span>
                    </div>
                    <div className="proposal-card-right">
                      {proposal.status === ProposalStatus.Active && (
                        <span className="proposal-time-remaining">
                          {formatTimeRemaining(proposal.timeRemaining)} left
                        </span>
                      )}
                      {proposal.status === ProposalStatus.Queued && (
                        <span className="proposal-time-remaining queued">
                          Executes in {formatTimeRemaining(proposal.timeRemaining)}
                        </span>
                      )}
                      <span className="proposal-voters">{proposal.voterCount} voters</span>
                    </div>
                  </div>
                  <div className="proposal-card-description">
                    {proposal.description.slice(0, 150)}
                    {proposal.description.length > 150 ? '...' : ''}
                  </div>
                  <VoteBar
                    forVotes={proposal.forVotes}
                    againstVotes={proposal.againstVotes}
                    quorumReached={proposal.quorumReached}
                  />
                  <div className="proposal-card-meta">
                    <span className="proposal-date">Created {formatDate(proposal.createdAt)}</span>
                    <span className="proposal-approval">
                      {proposal.approvalRate}% approval
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Parameters Tab */}
      {tab === 'parameters' && (
        <div className="parameters-section">
          {(Object.entries(paramsByCategory) as [ParameterCategory, GovernableParameter[]][])
            .filter(([, params]) => params.length > 0)
            .map(([category, params]) => (
              <div key={category} className="param-category-group">
                <div className="param-category-header">
                  <span
                    className="param-category-badge"
                    style={{
                      color: PARAMETER_CATEGORY_COLORS[category],
                      borderColor: `${PARAMETER_CATEGORY_COLORS[category]}40`,
                    }}
                  >
                    {PARAMETER_CATEGORY_LABELS[category]}
                  </span>
                  <span className="param-category-count">{params.length} parameters</span>
                </div>
                <div className="param-list">
                  {params.map(param => (
                    <div key={param.key} className="param-card">
                      <div className="param-card-header">
                        <span className="param-key">{param.key}</span>
                        <span className="param-value">{param.displayValue}</span>
                      </div>
                      <div className="param-description">{param.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Proposal Detail Tab */}
      {tab === 'detail' && selectedProposalId !== undefined && (
        <div className="proposal-detail">
          {detailLoading ? (
            <div className="loading">Loading proposal detail...</div>
          ) : proposalDetail ? (
            <>
              <div className="proposal-detail-header">
                <div className="proposal-detail-title">
                  <span className="proposal-id">Proposal #{proposalDetail.id}</span>
                  <span
                    className="proposal-status-badge large"
                    style={{
                      color: PROPOSAL_STATUS_COLORS[proposalDetail.status],
                      borderColor: `${PROPOSAL_STATUS_COLORS[proposalDetail.status]}40`,
                    }}
                  >
                    {PROPOSAL_STATUS_LABELS[proposalDetail.status]}
                  </span>
                </div>
              </div>

              {/* Parameter Change Card */}
              <div className="param-change-card">
                <div className="param-change-header">Parameter Change</div>
                <div className="param-change-body">
                  <div className="param-change-key">{proposalDetail.paramKey}</div>
                  <div className="param-change-values">
                    <div className="param-change-old">
                      <span className="param-change-label">Current</span>
                      <span className="param-change-val">{proposalDetail.parameter.displayValue}</span>
                    </div>
                    <span className="param-change-arrow">→</span>
                    <div className="param-change-new">
                      <span className="param-change-label">Proposed</span>
                      <span className="param-change-val highlight">
                        {proposalDetail.parameter.unit === 'bps'
                          ? `${(proposalDetail.newValue / 100).toFixed(2)}%`
                          : proposalDetail.parameter.unit === 'ether'
                            ? `${proposalDetail.newValue} ETH`
                            : proposalDetail.parameter.unit === 'seconds'
                              ? proposalDetail.newValue >= 86400
                                ? `${(proposalDetail.newValue / 86400).toFixed(0)} days`
                                : `${(proposalDetail.newValue / 3600).toFixed(0)} hours`
                              : String(proposalDetail.newValue)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="proposal-detail-description">
                <h3>Rationale</h3>
                <p>{proposalDetail.description}</p>
              </div>

              {/* Vote Summary */}
              <div className="vote-summary">
                <h3>Voting Results</h3>
                <VoteBar
                  forVotes={proposalDetail.forVotes}
                  againstVotes={proposalDetail.againstVotes}
                  quorumReached={proposalDetail.quorumReached}
                />
                <div className="vote-summary-meta">
                  <span>{proposalDetail.voterCount} voters</span>
                  <span>{(proposalDetail.forVotes + proposalDetail.againstVotes).toFixed(4)} ETH total weight</span>
                  <span>Deadline: {formatDate(proposalDetail.votingDeadline)}</span>
                  {proposalDetail.executionTime > 0 && (
                    <span>Execution: {formatDate(proposalDetail.executionTime)}</span>
                  )}
                </div>
              </div>

              {/* Vote List */}
              {proposalDetail.votes.length > 0 && (
                <div className="vote-list-section">
                  <h3>Individual Votes</h3>
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th className="col-name">Voter</th>
                          <th className="col-status">Vote</th>
                          <th className="col-stake">Weight</th>
                          <th className="col-time">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proposalDetail.votes.map((vote, i) => (
                          <tr key={i} className={`vote-row ${vote.voteType === VoteType.For ? 'vote-for' : 'vote-against'}`}>
                            <td className="col-name">
                              <span className="voter-address">{vote.voter.slice(0, 10)}...{vote.voter.slice(-6)}</span>
                            </td>
                            <td className="col-status">
                              <span className={`vote-type-badge ${vote.voteType === VoteType.For ? 'for' : 'against'}`}>
                                {vote.voteType === VoteType.For ? 'FOR' : 'AGAINST'}
                              </span>
                            </td>
                            <td className="col-stake">
                              {vote.weight.toFixed(4)} ETH
                            </td>
                            <td className="col-time">
                              {formatDate(vote.timestamp)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div className="proposal-timeline">
                <h3>Timeline</h3>
                <div className="timeline-items">
                  <div className="timeline-item completed">
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <span className="timeline-label">Created</span>
                      <span className="timeline-date">{formatDate(proposalDetail.createdAt)}</span>
                    </div>
                  </div>
                  <div className={`timeline-item ${proposalDetail.voterCount > 0 ? 'completed' : ''}`}>
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <span className="timeline-label">Voting ({proposalDetail.voterCount} votes)</span>
                      <span className="timeline-date">Ends {formatDate(proposalDetail.votingDeadline)}</span>
                    </div>
                  </div>
                  <div className={`timeline-item ${proposalDetail.status === ProposalStatus.Queued || proposalDetail.status === ProposalStatus.Executed ? 'completed' : ''}`}>
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <span className="timeline-label">Queued (1-day timelock)</span>
                      {proposalDetail.executionTime > 0 && (
                        <span className="timeline-date">Unlocks {formatDate(proposalDetail.executionTime)}</span>
                      )}
                    </div>
                  </div>
                  <div className={`timeline-item ${proposalDetail.status === ProposalStatus.Executed ? 'completed' : ''}`}>
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <span className="timeline-label">
                        {proposalDetail.status === ProposalStatus.Executed ? 'Executed' :
                         proposalDetail.status === ProposalStatus.Cancelled ? 'Cancelled' :
                         proposalDetail.status === ProposalStatus.Defeated ? 'Defeated' :
                         'Pending Execution'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="no-data">Proposal not found</div>
          )}
        </div>
      )}

      {/* Governance Info */}
      <div className="governance-info">
        <h3>Governance Rules</h3>
        <div className="governance-rules">
          <div className="governance-rule">
            <div className="governance-rule-icon">01</div>
            <div className="governance-rule-label">Owner Proposes</div>
            <div className="governance-rule-desc">Protocol owner creates proposals to change system parameters</div>
          </div>
          <div className="governance-rule">
            <div className="governance-rule-icon">02</div>
            <div className="governance-rule-label">Community Votes</div>
            <div className="governance-rule-desc">Stakers vote with stake-weighted power during the 3-day voting period</div>
          </div>
          <div className="governance-rule">
            <div className="governance-rule-icon">03</div>
            <div className="governance-rule-label">Quorum + Majority</div>
            <div className="governance-rule-desc">0.05 ETH minimum quorum and simple majority required to pass</div>
          </div>
          <div className="governance-rule">
            <div className="governance-rule-icon">04</div>
            <div className="governance-rule-label">1-Day Timelock</div>
            <div className="governance-rule-desc">Passed proposals are queued with a 1-day delay before execution</div>
          </div>
        </div>
      </div>
    </div>
  );
}
