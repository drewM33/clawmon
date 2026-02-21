import type { ReputationTier } from '../types';
import { REPUTATION_TIER_COLORS, REPUTATION_TIER_LABELS } from '../types';

interface ReputationBadgeProps {
  tier: ReputationTier;
  size?: 'sm' | 'md';
}

const TIER_ICONS: Record<ReputationTier, string> = {
  claw: '\u{1F980}',    // crab
  lobster: '\u{1F99E}', // lobster
  whale: '\u{1F40B}',   // whale
};

export default function ReputationBadge({ tier, size = 'sm' }: ReputationBadgeProps) {
  const color = REPUTATION_TIER_COLORS[tier];
  const label = REPUTATION_TIER_LABELS[tier];
  const icon = TIER_ICONS[tier];

  return (
    <span
      className={`reputation-badge reputation-badge-${size}`}
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      <span className="reputation-badge-icon">{icon}</span>
      {label}
    </span>
  );
}
