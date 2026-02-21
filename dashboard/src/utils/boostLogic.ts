/**
 * Boost economy logic: malicious vs featured skills.
 *
 * - Malicious: Boost a flagged / high-risk skill → your stake can be slashed.
 * - Featured: Boost a vetted, high-tier skill → unlock curator perks.
 */

import type { AgentSummary, BoostStatus, TrustTier } from '../types';

const FEATURED_TIERS: TrustTier[] = ['AAA', 'AA', 'A'];
const MIN_FEATURED_SCORE = 75;
const MIN_FEATURED_REVIEWS = 10;

/** Skill is considered malicious: flagged, sybil, or high risk. Boosting = penalty via slashing. */
export function isMaliciousSkill(
  agent: Pick<AgentSummary, 'flagged' | 'isSybil'>,
  boost?: Pick<BoostStatus, 'riskTier'> | null
): boolean {
  if (agent.flagged) return true;
  if (agent.isSybil) return true;
  if (boost?.riskTier === 'HIGH') return true;
  return false;
}

/** Skill is featured: high tier, vetted, quality signals. Boosting unlocks perks. */
export function isFeaturedSkill(agent: {
  flagged: boolean;
  isSybil: boolean;
  hardenedTier: string;
  hardenedScore: number;
  feedbackCount: number;
}): boolean {
  if (agent.flagged || agent.isSybil) return false;
  if (!FEATURED_TIERS.includes(agent.hardenedTier as TrustTier)) return false;
  if (agent.hardenedScore < MIN_FEATURED_SCORE) return false;
  if (agent.feedbackCount < MIN_FEATURED_REVIEWS) return false;
  return true;
}

/** Curator perks unlocked when boosting featured skills. */
export const FEATURED_BOOST_PERKS = [
  { id: 'accuracy', label: 'Accuracy bonus', desc: 'Weighted votes count more toward curator score' },
  { id: 'yield', label: 'Yield multiplier', desc: 'Higher conviction yield on featured picks' },
  { id: 'badge', label: 'Curator badge', desc: 'Featured Curator badge on profile' },
  { id: 'discovery', label: 'Discovery boost', desc: 'Early visibility into new featured skills' },
] as const;

/** Warnings shown when attempting to boost a malicious skill. */
export const MALICIOUS_BOOST_WARNINGS = [
  'Your stake can be fully slashed if this skill is confirmed malicious',
  'Delegated stake follows the skill — victims may claim from the slash pool',
  'Only boost skills you have vetted and trust',
] as const;
