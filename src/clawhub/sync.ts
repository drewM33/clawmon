/**
 * Trusted ClawMon — ClawHub Sync Orchestrator
 *
 * Discovery and enrichment are decoupled to avoid ClawHub rate limits:
 *
 *   syncFromClawHub() — Phase 1+2 only. Runs explore + search to discover
 *   all skills and caches them immediately with generic publishers. New
 *   skills are queued for background enrichment.
 *
 *   enrichPendingSkills() — Phase 3. Runs on a separate timer (every 5 min)
 *   and inspects queued skills in small batches with throttling. Updates
 *   cached identities with real owner/wallet data as it goes.
 *
 * Chain-registered identities always take precedence. ClawHub-sourced
 * skills fill the catalog for skills not yet registered on-chain.
 */

import { fetchAllSkills, enrichSkillsBatch, resolveCli } from './client.js';
import { cacheIdentity, getCachedIdentities } from '../scoring/reader.js';
import { registerSkillOnChain } from '../payments/x402.js';
import type { RegisterMessage } from '../scoring/types.js';
import type { ClawHubSkill, ClawHubSyncResult } from './types.js';

/** In-memory store of enriched skill data (keyed by slug) */
const enrichedSkillCache = new Map<string, ClawHubSkill>();

/** Skills that were cached without enrichment and need inspect */
const pendingEnrichment = new Set<string>();

const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ENRICHMENT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENRICH_PER_CYCLE = 100;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let enrichTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncResult: ClawHubSyncResult | null = null;

/**
 * Map a ClawHubSkill to a RegisterMessage for the identity cache.
 *
 * Priority: wallet address (from SKILL.md frontmatter) > owner handle
 * (GitHub username via inspect) > generic "clawhub" fallback.
 */
function toRegisterMessage(skill: ClawHubSkill): RegisterMessage {
  return {
    type: 'register',
    agentId: skill.slug,
    name: skill.name,
    publisher: skill.walletAddress ?? skill.owner?.handle ?? skill.publisher,
    category: skill.category,
    description: skill.description || `ClawHub skill: ${skill.name}`,
    feedbackAuthPolicy: 'open',
    timestamp: Date.now(),
  };
}

/**
 * Discover all skills from ClawHub and cache identities immediately.
 * New skills are queued for background enrichment — this function does
 * NOT run inspect calls, so it completes in ~25 seconds and never
 * hits ClawHub rate limits.
 */
export async function syncFromClawHub(): Promise<ClawHubSyncResult> {
  const start = Date.now();
  let skills: ClawHubSkill[];

  try {
    skills = await fetchAllSkills();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [clawhub] Sync failed: ${msg}`);
    const result: ClawHubSyncResult = {
      total: 0,
      newlyAdded: 0,
      skippedExisting: 0,
      inspected: 0,
      inspectErrors: 0,
      walletsFound: 0,
      errors: 1,
      durationMs: Date.now() - start,
    };
    lastSyncResult = result;
    return result;
  }

  const existingIdentities = getCachedIdentities();

  let newlyAdded = 0;
  let skippedExisting = 0;

  for (const skill of skills) {
    if (existingIdentities.has(skill.slug)) {
      skippedExisting++;
      continue;
    }
    enrichedSkillCache.set(skill.slug, skill);
    cacheIdentity(toRegisterMessage(skill));
    pendingEnrichment.add(skill.slug);
    newlyAdded++;
  }

  const result: ClawHubSyncResult = {
    total: skills.length,
    newlyAdded,
    skippedExisting,
    inspected: 0,
    inspectErrors: 0,
    walletsFound: 0,
    errors: 0,
    durationMs: Date.now() - start,
  };
  lastSyncResult = result;

  if (newlyAdded > 0) {
    console.log(
      `  [clawhub] Discovered ${newlyAdded} new skills (${skippedExisting} existing) in ${result.durationMs}ms — queued for enrichment`,
    );
  } else {
    console.log(`  [clawhub] No new skills (${skills.length} total, all cached)`);
  }

  return result;
}

/**
 * Enrich pending skills with inspect data (owner identity, SKILL.md, wallet).
 * Runs in small batches with throttling to stay under ClawHub rate limits.
 * Updates cached identities in place when wallet/owner data is found.
 */
export async function enrichPendingSkills(): Promise<void> {
  if (pendingEnrichment.size === 0) return;

  let cliPath: string | null = null;
  try {
    cliPath = await resolveCli();
  } catch {
    console.warn('  [clawhub] CLI not available — skipping enrichment cycle');
    return;
  }

  const slugs = Array.from(pendingEnrichment).slice(0, MAX_ENRICH_PER_CYCLE);
  const skills = slugs
    .map((slug) => enrichedSkillCache.get(slug))
    .filter((s): s is ClawHubSkill => s !== undefined);

  if (skills.length === 0) {
    for (const slug of slugs) pendingEnrichment.delete(slug);
    return;
  }

  console.log(
    `  [clawhub] Enriching ${skills.length} skills (${pendingEnrichment.size} total pending)...`,
  );

  const result = await enrichSkillsBatch(cliPath, skills, 2, (done, total, _slug, _hasWallet) => {
    if (done % 25 === 0 || done === total) {
      console.log(`  [clawhub] Enrich progress: ${done}/${total}`);
    }
  });

  let updated = 0;
  let registered = 0;
  for (const skill of result.enriched) {
    pendingEnrichment.delete(skill.slug);
    if (skill.owner || skill.walletAddress) {
      enrichedSkillCache.set(skill.slug, skill);
      cacheIdentity(toRegisterMessage(skill));
      updated++;

      // Auto-register on SkillPaywall when a valid ETH address is found
      if (skill.walletAddress && /^0x[0-9a-fA-F]{40}$/.test(skill.walletAddress)) {
        registerSkillOnChain(skill.slug, skill.walletAddress, 'BBB').catch(() => {});
        registered++;
      }
    }
  }

  console.log(
    `  [clawhub] Enrichment: ${result.inspected} owners, ${result.walletsFound} wallets, ${updated} identities updated, ${registered} on-chain registrations (${pendingEnrichment.size} remaining)`,
  );
}

/**
 * Get enriched skill data by slug, or undefined if not yet inspected.
 */
export function getEnrichedSkill(slug: string): ClawHubSkill | undefined {
  return enrichedSkillCache.get(slug);
}

/**
 * Get all enriched skills from the cache.
 */
export function getAllEnrichedSkills(): ClawHubSkill[] {
  return Array.from(enrichedSkillCache.values());
}

/**
 * Start periodic polling:
 *   - Full registry re-scan every `intervalMs` (default: 6 hours)
 *   - Background enrichment every 5 minutes until backlog clears
 */
export function startClawHubPolling(
  intervalMs: number = DEFAULT_SYNC_INTERVAL_MS,
): void {
  if (pollTimer) return;

  // Background enrichment timer — clears itself when queue is empty
  if (pendingEnrichment.size > 0) {
    console.log(
      `  [clawhub] ${pendingEnrichment.size} skills queued for background enrichment (every ${ENRICHMENT_INTERVAL_MS / 1000}s)`,
    );
    enrichTimer = setInterval(async () => {
      if (pendingEnrichment.size === 0) {
        if (enrichTimer) clearInterval(enrichTimer);
        enrichTimer = null;
        console.log('  [clawhub] Background enrichment complete — all skills inspected');
        return;
      }
      try {
        await enrichPendingSkills();
      } catch (err) {
        console.error(
          '  [clawhub] Enrichment error:',
          err instanceof Error ? err.message : err,
        );
      }
    }, ENRICHMENT_INTERVAL_MS);
  }

  pollTimer = setInterval(async () => {
    try {
      await syncFromClawHub();
    } catch (err) {
      console.error(
        '  [clawhub] Poll error:',
        err instanceof Error ? err.message : err,
      );
    }
  }, intervalMs);

  console.log(
    `  [clawhub] Registry polling started (every ${(intervalMs / 1000 / 60 / 60).toFixed(1)}h)`,
  );
}

/**
 * Stop all periodic polling.
 */
export function stopClawHubPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (enrichTimer) {
    clearInterval(enrichTimer);
    enrichTimer = null;
  }
  console.log('  [clawhub] Polling stopped');
}

/**
 * Get the result of the most recent sync operation, or null if no sync
 * has been performed yet.
 */
export function getLastSyncResult(): ClawHubSyncResult | null {
  return lastSyncResult;
}
