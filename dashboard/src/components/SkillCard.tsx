import { Gem, ShieldCheck, Link2, AlertTriangle, Users } from 'lucide-react';
import TierBadge from './TierBadge';
import type { AgentSummary } from '../types';

interface SkillCardProps {
  agent: AgentSummary;
  onClick: () => void;
  isUpdated?: boolean;
}

export default function SkillCard({ agent, onClick, isUpdated }: SkillCardProps) {
  const scoreColor = agent.hardenedScore >= 75 ? 'var(--success)'
    : agent.hardenedScore >= 50 ? 'var(--warning)'
    : 'var(--danger)';

  const scorePercent = Math.min(100, Math.max(0, agent.hardenedScore));

  return (
    <div
      className={`skill-card${agent.flagged ? ' flagged' : ''}${agent.isSybil ? ' sybil' : ''}${isUpdated ? ' ws-flash' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      aria-label={`${agent.name} — score ${agent.hardenedScore.toFixed(1)}, tier ${agent.hardenedTier}`}
    >
      <div className="skill-card-header">
        <div className="skill-card-identity">
          <span className="skill-card-name">{agent.name}</span>
          <span className="skill-card-publisher">{agent.publisher}</span>
        </div>
        <TierBadge tier={agent.hardenedTier} size="md" />
      </div>

      <p className="skill-card-desc">{agent.description}</p>

      <div className="skill-card-stats">
        <div className="skill-card-score">
          Score <strong>{agent.hardenedScore.toFixed(1)}</strong>
        </div>
        <span className="skill-card-reviews">{agent.feedbackCount} reviews</span>
        {agent.scoreDelta !== 0 && (
          <span className={`skill-card-delta ${agent.scoreDelta > 0 ? 'negative' : 'positive'}`}>
            {agent.scoreDelta > 0 ? '-' : '+'}{Math.abs(agent.scoreDelta).toFixed(1)}
          </span>
        )}
      </div>

      <div className="skill-card-badges">
        {agent.isStaked && agent.totalStakeEth > 0 && (
          <span className="skill-card-badge stake">
            <Gem className="badge-icon" />
            {agent.totalStakeEth.toFixed(3)} MON
          </span>
        )}
        {agent.teeTier3Active && (
          <span className="skill-card-badge tee">
            <ShieldCheck className="badge-icon" />
            TEE verified
          </span>
        )}
        {agent.attestationStatus === 'active' && (
          <span className="skill-card-badge onchain">
            <Link2 className="badge-icon" />
            On-chain
          </span>
        )}
        {agent.flagged && (
          <span className="skill-card-badge malicious">
            <AlertTriangle className="badge-icon" />
            Flagged
          </span>
        )}
        {agent.isSybil && (
          <span className="skill-card-badge sybil-warn">
            <Users className="badge-icon" />
            SYBIL RING
          </span>
        )}
      </div>

      <div className="skill-card-bar">
        <div
          className="skill-card-bar-fill"
          style={{
            width: `${scorePercent}%`,
            background: scoreColor,
          }}
        />
      </div>
    </div>
  );
}
