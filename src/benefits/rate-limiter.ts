/**
 * Trusted ClawMon — Tier-Based Rate Limiter (Phase 6)
 *
 * Express middleware that enforces rate limits based on a skill's
 * benefit tier (derived from boost level).
 *
 * Tiers:
 *   None   → 10 req/min
 *   Bronze → 100 req/min
 *   Silver → 500 req/min
 *   Gold   → 2000 req/min
 */

import type { Request, Response, NextFunction } from 'express';
import type { BenefitTierName } from './types.js';
import { BENEFIT_CONFIGS } from './types.js';

// ---------------------------------------------------------------------------
// In-Memory Rate Tracking
// ---------------------------------------------------------------------------

interface RateEntry {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000; // 1 minute window

// skillId → RateEntry
const rateBuckets = new Map<string, RateEntry>();

// ---------------------------------------------------------------------------
// Core Rate Check
// ---------------------------------------------------------------------------

/**
 * Check if a request should be rate-limited.
 * @param skillId - The skill being accessed
 * @param tier - The skill's benefit tier
 * @returns { allowed, remaining, limit, resetMs }
 */
export function checkRateLimit(
  skillId: string,
  tier: BenefitTierName,
): { allowed: boolean; remaining: number; limit: number; resetMs: number } {
  const config = BENEFIT_CONFIGS[tier] ?? BENEFIT_CONFIGS.none;
  const limit = config.rateLimitPerMin;
  const now = Date.now();

  let entry = rateBuckets.get(skillId);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // Start new window
    entry = { count: 0, windowStart: now };
    rateBuckets.set(skillId, entry);
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  const resetMs = entry.windowStart + WINDOW_MS - now;

  return {
    allowed: entry.count <= limit,
    remaining,
    limit,
    resetMs,
  };
}

// ---------------------------------------------------------------------------
// Express Middleware Factory
// ---------------------------------------------------------------------------

/**
 * Create Express middleware that rate-limits based on benefit tier.
 *
 * Usage:
 *   app.use('/api/skills/invoke/:skillId', benefitRateLimiter(getTierFn));
 *
 * @param getTier - Function to resolve a skill's current benefit tier.
 *                  Should return the tier name based on skillId.
 */
export function benefitRateLimiter(
  getTier: (skillId: string) => BenefitTierName | Promise<BenefitTierName>,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawId = req.params.skillId || req.params.id;
    const skillId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!skillId) {
      next();
      return;
    }

    const tier = await getTier(skillId);
    const { allowed, remaining, limit, resetMs } = checkRateLimit(skillId, tier);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
    res.setHeader('X-Benefit-Tier', tier);

    if (!allowed) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        tier,
        limit,
        retryAfterMs: resetMs,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clear expired rate limit entries (call periodically).
 */
export function cleanupExpiredEntries(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of rateBuckets) {
    if (now - entry.windowStart >= WINDOW_MS * 2) {
      rateBuckets.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * Reset all rate limit state (for testing).
 */
export function resetRateLimits(): void {
  rateBuckets.clear();
}
