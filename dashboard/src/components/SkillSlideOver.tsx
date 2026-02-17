import { useEffect } from 'react';
import { X, AlertTriangle, Users, ShieldCheck, Link2 } from 'lucide-react';
import { useAgentDetail, useAgentStaking, useAgentAttestation } from '../hooks/useApi';
import TierBadge from './TierBadge';
import FeedbackForm from './FeedbackForm';
import DemoVideoUpload from './DemoVideoUpload';
import StakeActions from './StakeActions';
import type { TrustTier, AttestationStatus } from '../types';
import { TIER_COLORS, STAKE_TIER_COLORS, STAKE_TIER_LABELS, ATTESTATION_STATUS_COLORS, ATTESTATION_STATUS_LABELS } from '../types';

interface SkillSlideOverProps {
  agentId: string;
  onClose: () => void;
}

function formatAge(seconds: number): string {
  if (seconds < 0) return '\u2014';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes}m ago`;
  return `${minutes}m ago`;
}

export default function SkillSlideOver({ agentId, onClose }: SkillSlideOverProps) {
  const { data: agent, loading, error } = useAgentDetail(agentId);
  const { data: staking, refetch: refetchStaking } = useAgentStaking(agentId);
  const { data: attestation } = useAgentAttestation(agentId);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (loading) {
    return (
      <>
        <div className="slideover-backdrop" onClick={onClose} />
        <div className="slideover-panel" role="dialog" aria-modal="true" aria-label="Skill details loading">
          <div className="slideover-header">
            <span />
            <button className="slideover-close" onClick={onClose} aria-label="Close panel">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="loading" style={{ height: '200px' }}>Loading...</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <>
        <div className="slideover-backdrop" onClick={onClose} />
        <div className="slideover-panel" role="dialog" aria-modal="true" aria-label="Skill details error">
          <div className="slideover-header">
            <span />
            <button className="slideover-close" onClick={onClose} aria-label="Close panel">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="error" style={{ height: '200px' }}>{error || 'Agent not found'}</div>
        </div>
      </>
    );
  }

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

  const sortedFb = [...agent.feedback]
    .filter(f => !f.revoked)
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <>
      <div className="slideover-backdrop" onClick={onClose} />
      <div className="slideover-panel" role="dialog" aria-modal="true" aria-label={`${agent.name} details`}>
        <div className="slideover-header">
          <div className="slideover-title-group">
            <h2>{agent.name}</h2>
            <TierBadge tier={agent.hardenedTier} size="lg" />
            {agent.flagged && (
              <span className="flag-badge malicious large">
                <AlertTriangle className="w-3 h-3" style={{ marginRight: 2 }} />
                MALICIOUS
              </span>
            )}
            {agent.isSybil && (
              <span className="flag-badge sybil large">
                <Users className="w-3 h-3" style={{ marginRight: 2 }} />
                SYBIL
              </span>
            )}
          </div>
          <button className="slideover-close" onClick={onClose} aria-label="Close panel">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="slideover-body">
          <div className="slideover-meta">
            <span className="detail-publisher">by {agent.publisher} &middot; {agent.category}</span>
            <p className="detail-description">{agent.description}</p>
            <p className="detail-auth">
              Feedback Auth: <span className="auth-open">{agent.feedbackAuthPolicy}</span>
            </p>
          </div>

          {/* Score Comparison */}
          <div className="slideover-section">
            <h3>Score Breakdown</h3>
            <div className="score-bars">
              <div className="score-row">
                <span className="score-label">Naive Score</span>
                <div className="score-bar-track">
                  <div className="score-bar-fill naive" style={{ width: `${agent.naiveScore}%`, backgroundColor: naiveColor }} />
                </div>
                <span className="score-number">{agent.naiveScore.toFixed(1)}</span>
                <TierBadge tier={agent.naiveTier} size="sm" />
              </div>
              <div className="score-row">
                <span className="score-label">Hardened Score</span>
                <div className="score-bar-track">
                  <div className="score-bar-fill hardened" style={{ width: `${agent.hardenedScore}%`, backgroundColor: hardenedColor }} />
                </div>
                <span className="score-number">{agent.hardenedScore.toFixed(1)}</span>
                <TierBadge tier={agent.hardenedTier} size="sm" />
              </div>
            </div>
            <div className="score-delta-display">
              {scoreDiff > 0 ? (
                <span className="delta-negative">Mitigations reduced score by {scoreDiff.toFixed(1)} points</span>
              ) : scoreDiff < 0 ? (
                <span className="delta-positive">Mitigations increased score by {Math.abs(scoreDiff).toFixed(1)} points</span>
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

          {/* Mitigation Flags */}
          <div className="slideover-section">
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
                    <div className="flag-bar-fill" style={{ width: `${(flag.count / maxFlag) * 100}%`, backgroundColor: flag.color }} />
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

          {/* Feedback Timeline */}
          <div className="slideover-section">
            <h3>Feedback Timeline ({sortedFb.length} reviews)</h3>
            <div className="timeline-chart">
              {sortedFb.length > 0 ? (
                <svg viewBox="0 0 600 200" className="timeline-svg" role="img" aria-label="Feedback timeline chart">
                  {[0, 25, 50, 75, 100].map(y => (
                    <g key={y}>
                      <line x1={40} y1={180 - y * 1.6} x2={580} y2={180 - y * 1.6} stroke="var(--border-hover)" strokeWidth={0.5} />
                      <text x={35} y={184 - y * 1.6} textAnchor="end" fontSize={9} fill="var(--text-muted)">{y}</text>
                    </g>
                  ))}
                  {sortedFb.map((fb, i) => {
                    const x = 40 + (i / Math.max(sortedFb.length - 1, 1)) * 540;
                    const y = 180 - fb.value * 1.6;
                    const nextFb = sortedFb[i + 1];
                    const nextX = nextFb ? 40 + ((i + 1) / Math.max(sortedFb.length - 1, 1)) * 540 : x;
                    const nextY = nextFb ? 180 - nextFb.value * 1.6 : y;
                    return (
                      <g key={fb.id}>
                        {nextFb && <line x1={x} y1={y} x2={nextX} y2={nextY} stroke="var(--border-hover)" strokeWidth={1} />}
                        <circle cx={x} cy={y} r={3} fill={fb.value >= 70 ? 'var(--success)' : fb.value >= 40 ? 'var(--warning)' : 'var(--danger)'} />
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <p className="no-data">No feedback data available</p>
              )}
            </div>
          </div>

          {/* Demo Video Upload */}
          <DemoVideoUpload agentId={agent.name} />

          {/* Staking Info */}
          <div className="slideover-section">
            <h3>Staking &amp; Economic Trust</h3>
            {staking && staking.isStaked && staking.stake ? (
              <>
                <div className="staking-detail-grid">
                  <div className="staking-detail-item">
                    <span className="meta-label">Publisher Stake</span>
                    <span className="meta-value">{staking.stake.stakeAmountEth.toFixed(4)} MON</span>
                  </div>
                  <div className="staking-detail-item">
                    <span className="meta-label">Delegated</span>
                    <span className="meta-value">{staking.stake.delegatedStakeEth.toFixed(4)} MON</span>
                  </div>
                  <div className="staking-detail-item">
                    <span className="meta-label">Total Stake</span>
                    <span className="meta-value" style={{ fontSize: '1.1rem' }}>
                      {staking.stake.totalStakeEth.toFixed(4)} MON
                    </span>
                  </div>
                  <div className="staking-detail-item">
                    <span className="meta-label">Stake Tier</span>
                    <span className="stake-tier-badge" style={{
                      color: STAKE_TIER_COLORS[staking.stake.tier ?? 0],
                      borderColor: `${STAKE_TIER_COLORS[staking.stake.tier ?? 0]}40`,
                    }}>
                      {STAKE_TIER_LABELS[staking.stake.tier ?? 0]}
                    </span>
                  </div>
                </div>
                {staking.slashHistory.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <h4 style={{ fontSize: '0.75rem', color: 'var(--danger)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Slash History ({staking.slashHistory.length})
                    </h4>
                    {staking.slashHistory.map((slash, i) => (
                      <div key={i} className="slash-card" style={{ marginBottom: '6px' }}>
                        <div className="slash-card-header">
                          <span className="slash-reason" style={{ margin: 0 }}>{slash.reason}</span>
                          <span className="slash-amount">-{slash.amountEth.toFixed(4)} MON</span>
                        </div>
                        <span className="slash-time">{new Date(slash.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="no-data" style={{ padding: '20px' }}>
                <span style={{ fontSize: '1.2rem', display: 'block', marginBottom: '8px' }}>No Stake</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  This skill has not staked collateral. Trust is reputation-only (Tier 1).
                </span>
              </div>
            )}
            <StakeActions
              agentId={agentId}
              isStaked={!!(staking && staking.isStaked)}
              onTransactionConfirmed={refetchStaking}
            />
          </div>

          {/* Attestation Info */}
          <div className="slideover-section">
            <h3>Cross-Chain Attestation</h3>
            {attestation && attestation.status !== 'none' && attestation.record ? (
              <>
                <div className="attestation-status-header">
                  <span className="attestation-status-badge-lg" style={{
                    color: ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus],
                    borderColor: `${ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus]}40`,
                    backgroundColor: `${ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus]}15`,
                  }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      backgroundColor: ATTESTATION_STATUS_COLORS[attestation.status as AttestationStatus],
                      marginRight: 6,
                    }} />
                    {ATTESTATION_STATUS_LABELS[attestation.status as AttestationStatus]}
                  </span>
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
                    <span className="chain-badge monad" style={{ fontSize: '0.65rem' }}>{attestation.record.sourceChain}</span>
                  </div>
                  <div className="staking-detail-item">
                    <span className="meta-label">Freshness</span>
                    <span className="meta-value" style={{
                      color: attestation.record.isFresh ? ATTESTATION_STATUS_COLORS.active : ATTESTATION_STATUS_COLORS.stale,
                    }}>
                      {attestation.ageSeconds >= 0 ? formatAge(attestation.ageSeconds) : '\u2014'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="no-data" style={{ padding: '20px' }}>
                <span style={{ fontSize: '1.2rem', display: 'block', marginBottom: '8px' }}>No Attestation</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  This skill does not have an on-chain attestation yet.
                </span>
              </div>
            )}
          </div>

          {/* Recent Feedback */}
          <div className="slideover-section">
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

          {/* Feedback Form */}
          {agent.feedbackAuthPolicy === 'open' && (
            <FeedbackForm agentId={agent.name} />
          )}
        </div>
      </div>
    </>
  );
}
