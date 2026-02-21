import { Gem, ShieldCheck, Link2, AlertTriangle, Users, Wallet, Zap } from 'lucide-react';
import TierBadge from './TierBadge';
import BoostGiftButton from './BoostGiftButton';
import type { AgentSummary, BoostStatus } from '../types';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface SkillCardProps {
  agent: AgentSummary;
  boost?: BoostStatus;
  onClick: () => void;
  onBoostClick?: () => void;
  isUpdated?: boolean;
}

export default function SkillCard({ agent, boost, onClick, onBoostClick, isUpdated }: SkillCardProps) {
  const scoreColor = agent.hardenedScore >= 75 ? 'var(--success)'
    : agent.hardenedScore >= 50 ? 'var(--warning)'
    : 'var(--danger)';

  const scorePercent = Math.min(100, Math.max(0, agent.hardenedScore));
  const isRegistered = ETH_ADDRESS_RE.test(agent.publisher);

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
        <div className="skill-card-header-right">
          {onBoostClick && (
            <BoostGiftButton onBoostClick={onBoostClick} />
          )}
          <TierBadge tier={agent.hardenedTier} size="md" />
        </div>
      </div>

      <p className="skill-card-desc">{agent.description}</p>

      <div className="skill-card-stats">
        <div className="skill-card-score">
          Score <strong>{agent.hardenedScore.toFixed(1)}</strong>
        </div>
        <span className="skill-card-reviews">{agent.feedbackCount} signals</span>
        {agent.scoreDelta !== 0 && (
          <span className={`skill-card-delta ${agent.scoreDelta > 0 ? 'negative' : 'positive'}`}>
            {agent.scoreDelta > 0 ? '-' : '+'}{Math.abs(agent.scoreDelta).toFixed(1)}
          </span>
        )}
      </div>

      <div className="skill-card-badges">
        {isRegistered ? (
          <span className="skill-card-badge onchain">
            <Wallet className="badge-icon" />
            Registered
          </span>
        ) : (
          <span className="skill-card-badge" style={{ opacity: 0.5 }}>
            No bond
          </span>
        )}
        {agent.isStaked && agent.totalStakeEth > 0 && (
          <span className="skill-card-badge stake">
            <Gem className="badge-icon" />
            {agent.totalStakeEth.toFixed(3)} MON
          </span>
        )}
        {boost?.configured && boost.exists && (
          <span className={`skill-card-badge boost level-${Math.max(0, Math.min(3, boost.trustLevel))}`}>
            <Zap className="badge-icon" />
            Boost L{boost.trustLevel}
          </span>
        )}
        {agent.teeTier3Active && (
          <span className="skill-card-badge tee">
            <ShieldCheck className="badge-icon" />
            TEE attested
          </span>
        )}
        {agent.attestationStatus === 'active' && (
          <span className="skill-card-badge onchain">
            <Link2 className="badge-icon" />
            On-chain proof
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
