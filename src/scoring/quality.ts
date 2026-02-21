/**
 * Trusted ClawMon — Markdown Quality Scoring
 *
 * Evaluates the documentation quality of a skill's SKILL.md file
 * using a structured rubric. Well-documented skills earn a trust
 * score boost, incentivizing publishers to write clear, complete docs.
 *
 * Scoring rubric (0–10 points, applied as trust score boost):
 *   - Has description (2 pts)
 *   - Has usage examples (2 pts)
 *   - Has configuration/setup section (1 pt)
 *   - Has error handling / limitations noted (1 pt)
 *   - Has auth/permissions documented (1 pt)
 *   - Sufficient length (> 200 chars = 1 pt, > 500 chars = 2 pts)
 *   - Has frontmatter / metadata (1 pt)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityScore {
  agentId: string;
  totalPoints: number;
  maxPoints: number;
  boost: number;
  breakdown: QualityBreakdown;
}

export interface QualityBreakdown {
  hasDescription: boolean;
  hasExamples: boolean;
  hasSetup: boolean;
  hasLimitations: boolean;
  hasAuth: boolean;
  lengthScore: number;
  hasFrontmatter: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const QUALITY_MAX_POINTS = 10;
export const QUALITY_BOOST_MAX = 5;

// ---------------------------------------------------------------------------
// In-Memory Cache
// ---------------------------------------------------------------------------

const qualityScores = new Map<string, QualityScore>();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score the documentation quality of a skill's markdown content.
 */
export function scoreMarkdownQuality(agentId: string, markdown: string): QualityScore {
  const lower = markdown.toLowerCase();
  let points = 0;

  const hasDescription = lower.includes('description') ||
    lower.includes('## about') ||
    lower.includes('## overview') ||
    (markdown.length > 100 && /^#\s+.+/m.test(markdown));

  const hasExamples = lower.includes('example') ||
    lower.includes('usage') ||
    lower.includes('```');

  const hasSetup = lower.includes('setup') ||
    lower.includes('install') ||
    lower.includes('configuration') ||
    lower.includes('getting started');

  const hasLimitations = lower.includes('limitation') ||
    lower.includes('caveat') ||
    lower.includes('known issue') ||
    lower.includes('error');

  const hasAuth = lower.includes('auth') ||
    lower.includes('permission') ||
    lower.includes('api key') ||
    lower.includes('credential') ||
    lower.includes('token');

  const hasFrontmatter = markdown.trimStart().startsWith('---');

  if (hasDescription) points += 2;
  if (hasExamples) points += 2;
  if (hasSetup) points += 1;
  if (hasLimitations) points += 1;
  if (hasAuth) points += 1;
  if (hasFrontmatter) points += 1;

  let lengthScore = 0;
  if (markdown.length > 500) lengthScore = 2;
  else if (markdown.length > 200) lengthScore = 1;
  points += lengthScore;

  points = Math.min(QUALITY_MAX_POINTS, points);
  const boost = (points / QUALITY_MAX_POINTS) * QUALITY_BOOST_MAX;

  const score: QualityScore = {
    agentId,
    totalPoints: points,
    maxPoints: QUALITY_MAX_POINTS,
    boost: Math.round(boost * 100) / 100,
    breakdown: {
      hasDescription,
      hasExamples,
      hasSetup,
      hasLimitations,
      hasAuth,
      lengthScore,
      hasFrontmatter,
    },
  };

  qualityScores.set(agentId, score);
  return score;
}

/**
 * Get cached quality score for an agent, or null if not scored yet.
 */
export function getQualityScore(agentId: string): QualityScore | null {
  return qualityScores.get(agentId) ?? null;
}

/**
 * Get all cached quality scores.
 */
export function getAllQualityScores(): QualityScore[] {
  return Array.from(qualityScores.values());
}

/**
 * Get the quality boost for an agent (0 if not scored).
 */
export function getQualityBoost(agentId: string): number {
  return qualityScores.get(agentId)?.boost ?? 0;
}
