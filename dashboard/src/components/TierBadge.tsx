import type { TrustTier } from '../types';
import { TIER_COLORS, TIER_BG_COLORS } from '../types';

interface TierBadgeProps {
  tier: TrustTier;
  size?: 'sm' | 'md' | 'lg';
}

export default function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const color = TIER_COLORS[tier];
  const bg = TIER_BG_COLORS[tier];

  const sizeClasses = {
    sm: { fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px' },
    md: { fontSize: '0.75rem', padding: '2px 8px', borderRadius: '6px' },
    lg: { fontSize: '0.9rem', padding: '4px 12px', borderRadius: '8px' },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        color,
        backgroundColor: bg,
        border: `1px solid ${color}40`,
        letterSpacing: '0.05em',
        ...sizeClasses[size],
      }}
    >
      {tier}
    </span>
  );
}
