import { useParams, useNavigate } from 'react-router-dom';
import { useAgentDetail, useAgentStaking, useAgentAttestation } from '../hooks/useApi';
import TierBadge from './TierBadge';
import FeedbackForm from './FeedbackForm';
import DemoVideoUpload from './DemoVideoUpload';
import type { TrustTier, AttestationStatus } from '../types';
import { TIER_COLORS, STAKE_TIER_COLORS, STAKE_TIER_LABELS, ATTESTATION_STATUS_COLORS, ATTESTATION_STATUS_LABELS } from '../types';

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agent, loading, error } = useAgentDetail(id);
  const { data: staking } = useAgentStaking(id);
  const { data: attestation } = useAgentAttestation(id);

  if (loading) return <div className="loading">Loading agent details...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!agent) return <div className="error">Agent not found</div>;

  const maxFlag = Math.max(
    agent.mitigationFlags.sybilMutual,
    agent.mitigationFlags.velocityBurst,
    agent.mitigationFlags.temporalDecay,
    agent.mitigationFlags.newSubmitter,
    agent.mitigationFlags.anomalyBurst,
    1,
  );

  const scoreDiff = agent.naiveScore - agent.hardenedScore;
  const hardenedColor = TIER_COLORS[agent.hardenedTier];
  const naiveColor = TIER_COLORS[agent.naiveTier];

  // Build feedback timeline data
  const sortedFb = [...agent.feedback]
    .filter(f => !f.revoked)
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="agent-detail">
      <button className="back-btn" onClick={() => navigate('/')}>
        ← Back to Leaderboard
      </button>

      <div className="detail-header">
        <div className="detail-title-row">
          <h1>{agent.name}</h1>
          <TierBadge tier={agent.hardenedTier} size="lg" />
          {agent.flagged && <span className="flag-badge malicious large">MALICIOUS</span>}
          {agent.isSybil && <span className="flag-badge sybil large">SYBIL</span>}
        </div>
        <p className="detail-publisher">by {agent.publisher} · {agent.category}</p>
        <p className="detail-description">{agent.description}</p>
        <p className="detail-auth">
          Feedback Auth: <span className="auth-open">{agent.feedbackAuthPolicy}</span>
        </p>
      </div>

      <div className="detail-grid">
        {/* Score Comparison Card */}
        <div className="detail-card score-comparison">
          <h3>Score Breakdown</h3>
          <div className="score-bars">
            <div className="score-row">
              <span className="score-label">Naive Score</span>
              <div className="score-bar-track">
                <div
                  className="score-bar-fill naive"
                  style={{ width: `${agent.naiveScore}%`, backgroundColor: naiveColor }}
                />
              </div>
              <span className="score-number">{agent.naiveScore.toFixed(1)}</span>
              <TierBadge tier={agent.naiveTier} size="sm" />
            </div>
            <div className="score-row">
              <span className="score-label">Hardened Score</span>
              <div className="score-bar-track">
                <div
                  className="score-bar-fill hardened"
                  style={{ width: `${agent.hardenedScore}%`, backgroundColor: hardenedColor }}
                />
              </div>
              <span className="score-number">{agent.hardenedScore.toFixed(1)}</span>
              <TierBadge tier={agent.hardenedTier} size="sm" />
            </div>
          </div>
          <div className="score-delta-display">
            {scoreDiff > 0 ? (
              <span className="delta-negative">
                Mitigations reduced score by {scoreDiff.toFixed(1)} points
              </span>
            ) : scoreDiff < 0 ? (
              <span className="delta-positive">
                Mitigations increased score by {Math.abs(scoreDiff).toFixed(1)} points
              </span>
            ) : (
              <span className="delta-neutral">No mitigation impact</span>
            )}
          </div>
          <div className="score-meta">
            <div className="meta-item">
              <span className="meta-label">On-Chain Weight</span>
              <span className="meta-value">{agent.onChainWeight.toFixed(2)}x</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Total Reviews</span>
              <span className="meta-value">{agent.feedbackCount}</span>
            </div>
          </div>
        </div>

        {/* Mitigation Flags Card */}
        <div className="detail-card mitigation-flags">
          <h3>Mitigation Flags</h3>
          <div className="flag-list">
            {[
              { label: 'Sybil Mutual Feedback', count: agent.mitigationFlags.sybilMutual, color: '#ef4444' },
              { label: 'Velocity Burst', count: agent.mitigationFlags.velocityBurst, color: '#f97316' },
              { label: 'Temporal Decay', count: agent.mitigationFlags.temporalDecay, color: '#eab308' },
              { label: 'New Submitter Discount', count: agent.mitigationFlags.newSubmitter, color: '#3b82f6' },
              { label: 'Anomaly Burst', count: agent.mitigationFlags.anomalyBurst, color: '#a855f7' },
            ].map(flag => (
              <div key={flag.label} className="flag-row">
                <span className="flag-label">{flag.label}</span>
                <div className="flag-bar-track">
                  <div
                    className="flag-bar-fill"
                    style={{
                      width: `${(flag.count / maxFlag) * 100}%`,
                      backgroundColor: flag.color,
                    }}
                  />
                </div>
                <span className="flag-count" style={{ color: flag.count > 0 ? flag.color : '#6b7280' }}>
                  {flag.count}
                </span>
              </div>
            ))}
          </div>
          {agent.mitigationFlags.sybilMutual > 0 && (
            <p className="flag-note">
              {agent.mitigationFlags.sybilMutual} feedback entries flagged as part of a sybil mutual feedback ring
            </p>
          )}
        </div>

        {/* Feedback Timeline Card */}
        <div className="detail-card feedback-timeline">
          <h3>Feedback Timeline ({sortedFb.length} reviews)</h3>
          <div className="timeline-chart">
            {sortedFb.length > 0 ? (
              <svg viewBox={`0 0 600 200`} className="timeline-svg">
                {/* Background grid */}
                {[0, 25, 50, 75, 100].map(y => (
                  <g key={y}>
                    <line
                      x1={40} y1={180 - y * 1.6}
                      x2={580} y2={180 - y * 1.6}
                      stroke="#374151" strokeWidth={0.5}
                    />
                    <text x={35} y={184 - y * 1.6} textAnchor="end" fontSize={9} fill="#6b7280">{y}</text>
                  </g>
                ))}
                {/* Data points and line */}
                {sortedFb.map((fb, i) => {
                  const x = 40 + (i / Math.max(sortedFb.length - 1, 1)) * 540;
                  const y = 180 - fb.value * 1.6;
                  const nextFb = sortedFb[i + 1];
                  const nextX = nextFb ? 40 + ((i + 1) / Math.max(sortedFb.length - 1, 1)) * 540 : x;
                  const nextY = nextFb ? 180 - nextFb.value * 1.6 : y;
                  return (
                    <g key={fb.id}>
                      {nextFb && (
                        <line x1={x} y1={y} x2={nextX} y2={nextY} stroke="#4b5563" strokeWidth={1} />
                      )}
                      <circle
                        cx={x} cy={y} r={3}
                        fill={fb.value >= 70 ? '#22c55e' : fb.value >= 40 ? '#f59e0b' : '#ef4444'}
                      />
                    </g>
                  );
                })}
              </svg>
            ) : (
              <p className="no-data">No feedback data available</p>
            )}
          </div>
        </div>

        {/* Staking Card (Phase 4) */}
        <div className="detail-card staking-info">
          <h3>Staking & Economic Trust</h3>
          {staking && staking.isStaked && staking.stake ? (
            <>
              <div className="staking-detail-grid">
                <div className="staking-detail-item">
                  <span className="meta-label">Publisher Stake</span>
                  <span className="meta-value">{staking.stake.stakeAmountEth.toFixed(4)} ETH</span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Delegated</span>
                  <span className="meta-value">{staking.stake.delegatedStakeEth.toFixed(4)} ETH</span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Total Stake</span>
                  <span className="meta-value" style={{ fontSize: '1.1rem' }}>
                    {staking.stake.totalStakeEth.toFixed(4)} ETH
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Stake Tier</span>
                  <span
                    className="stake-tier-badge"
                    style={{
                      color: STAKE_TIER_COLORS[staking.stake.tier ?? 0],
                      borderColor: `${STAKE_TIER_COLORS[staking.stake.tier ?? 0]}40`,
                    }}
                  >
                    {STAKE_TIER_LABELS[staking.stake.tier ?? 0]}
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Status</span>
                  <span className={staking.stake.active ? 'status-active' : 'status-inactive'}>
                    {staking.stake.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Staked Since</span>
                  <span className="meta-value" style={{ fontSize: '0.78rem' }}>
                    {new Date(staking.stake.stakedAt * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Slash History */}
              {staking.slashHistory.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <h4 style={{ fontSize: '0.75rem', color: 'var(--danger)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Slash History ({staking.slashHistory.length})
                  </h4>
                  {staking.slashHistory.map((slash, i) => (
                    <div key={i} className="slash-card" style={{ marginBottom: '6px' }}>
                      <div className="slash-card-header">
                        <span className="slash-reason" style={{ margin: 0 }}>{slash.reason}</span>
                        <span className="slash-amount">-{slash.amountEth.toFixed(4)} ETH</span>
                      </div>
                      <span className="slash-time">
                        {new Date(slash.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="no-data" style={{ padding: '20px' }}>
              <span style={{ fontSize: '1.5rem', display: 'block', marginBottom: '8px' }}>No Stake</span>
              <span style={{ color: 'var(--text-muted)' }}>
                This agent has not staked collateral. Trust is reputation-only (Tier 1).
              </span>
            </div>
          )}
        </div>

        {/* Cross-Chain Attestation Card (Phase 5) */}
        <div className="detail-card attestation-info">
          <h3>Cross-Chain Attestation</h3>
          {attestation && attestation.status !== 'none' && attestation.record ? (
            <>
              <div className="attestation-status-header">
                <span
                  className="attestation-status-badge-lg"
                  style={{
                    color: ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus],
                    borderColor: `${ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus]}40`,
                    backgroundColor: `${ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus]}15`,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus],
                      marginRight: 6,
                    }}
                  />
                  {ATTESTATION_STATUS_LABELS[attestation.status as AttestationStatus]}
                </span>
                {attestation.record.revoked && (
                  <span className="flag-badge malicious" style={{ marginLeft: 8 }}>REVOKED</span>
                )}
              </div>
              <div className="staking-detail-grid" style={{ marginTop: '12px' }}>
                <div className="staking-detail-item">
                  <span className="meta-label">On-Chain Score</span>
                  <span className="meta-value">{attestation.record.score}</span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">On-Chain Tier</span>
                  <TierBadge tier={attestation.record.tier as TrustTier} size="sm" />
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Source Chain</span>
                  <span className="chain-badge monad" style={{ fontSize: '0.65rem' }}>
                    {attestation.record.sourceChain}
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Target Chain</span>
                  <span className="chain-badge monad" style={{ fontSize: '0.65rem' }}>
                    Monad
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Attested At</span>
                  <span className="meta-value" style={{ fontSize: '0.78rem' }}>
                    {new Date(attestation.record.attestedAt * 1000).toLocaleString()}
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Freshness</span>
                  <span
                    className="meta-value"
                    style={{
                      color: attestation.record.isFresh
                        ? ATTESTATION_STATUS_COLORS.active
                        : ATTESTATION_STATUS_COLORS.stale,
                    }}
                  >
                    {attestation.ageSeconds >= 0
                      ? formatAge(attestation.ageSeconds)
                      : '—'}
                  </span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Feedback Used</span>
                  <span className="meta-value">{attestation.record.feedbackCount}</span>
                </div>
                <div className="staking-detail-item">
                  <span className="meta-label">Attestation Count</span>
                  <span className="meta-value">{attestation.attestationCount}</span>
                </div>
              </div>
              {attestation.record.agentIdHash && (
                <div style={{ marginTop: '12px', fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  Agent Hash: {attestation.record.agentIdHash}
                </div>
              )}
            </>
          ) : (
            <div className="no-data" style={{ padding: '20px' }}>
              <span style={{ fontSize: '1.5rem', display: 'block', marginBottom: '8px' }}>No Attestation</span>
              <span style={{ color: 'var(--text-muted)' }}>
                This agent does not have an on-chain attestation yet.
                {agent.isSybil && ' Sybil agents are excluded from cross-chain attestation.'}
                {agent.flagged && !agent.isSybil && ' Flagged agents may have revoked attestations.'}
              </span>
            </div>
          )}
        </div>

        {/* Recent Feedback Card */}
        <div className="detail-card recent-feedback">
          <h3>Recent Feedback</h3>
          <div className="feedback-list">
            {sortedFb.slice(-10).reverse().map(fb => (
              <div key={fb.id} className="feedback-item">
                <span className={`fb-value ${fb.value >= 70 ? 'positive' : fb.value >= 40 ? 'neutral' : 'negative'}`}>
                  {fb.value}
                </span>
                <span className="fb-address">{fb.clientAddress}</span>
                <span className="fb-time">{new Date(fb.timestamp).toLocaleDateString()}</span>
              </div>
            ))}
            {sortedFb.length === 0 && <p className="no-data">No feedback yet</p>}
          </div>
        </div>
      </div>

      {/* Demo Video Upload (gated behind wallet auth) */}
      <DemoVideoUpload agentId={agent.name} />

      {/* Feedback Submission (gated behind wallet auth) */}
      {agent.feedbackAuthPolicy === 'open' && (
        <FeedbackForm agentId={agent.name} />
      )}
    </div>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes}m ago`;
  return `${minutes}m ago`;
}
