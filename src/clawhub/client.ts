/**
 * Trusted ClawMon — ClawHub CLI Client
 *
 * Fetches skills from the ClawHub public registry via the `clawhub` CLI.
 *
 * Strategy:
 *   1. `clawhub explore --json --limit 200` across multiple sort orders
 *      (newest, downloads, trending, installs, rating) for broad coverage.
 *   2. `clawhub search <category> --limit 200` for each known category
 *      to catch skills not surfaced by explore.
 *   3. `clawhub inspect <slug> --json --files` + `--file SKILL.md` to fetch
 *      owner identity, full content, and wallet address from frontmatter.
 *   4. Deduplication by slug across all results.
 *
 * Falls back gracefully when the CLI is not installed or the network is down.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClawHubSkill, ClawHubOwner } from './types.js';

const execFileAsync = promisify(execFile);

// Higher timeout for Render/CI — ClawHub API can be slow from cloud datacenters
const CLI_TIMEOUT_MS = 90_000;

const EXPLORE_SORT_ORDERS = [
  'newest',
  'downloads',
  'trending',
  'installs',
  'installsAllTime',
  'rating',
] as const;

/**
 * Category search terms derived from the ClawHub/awesome-openclaw-skills
 * taxonomy. Used to supplement explore results.
 */
const SEARCH_CATEGORIES = [
  'coding',
  'marketing',
  'communication',
  'git',
  'productivity',
  'speech',
  'ai',
  'web',
  'devops',
  'browser',
  'data',
  'shopping',
  'image',
  'notes',
  'search',
  'cli',
  'apple',
  'ios',
  'security',
  'trust',
  'reputation',
  'verification',
  'monitoring',
  'blockchain',
  'transportation',
  'gaming',
  'media',
  'calendar',
  'health',
  'smart home',
  'finance',
  'pdf',
  'self-hosted',
  'agent',
  'personal',
];

/** Resolved CLI invocation: command + args prefix for execFile (e.g. npx + ['clawhub'] or path + []) */
export interface ResolvedCli {
  command: string;
  argsPrefix: string[];
}

/**
 * Resolve how to run the clawhub CLI.
 * Prefers npx (most reliable on Render/CI) since it finds the local package without path resolution.
 */
export async function resolveCli(): Promise<ResolvedCli> {
  // 1. npx clawhub — uses npm's resolution, works regardless of cwd/path (Render, CI, etc.)
  try {
    await execFileAsync('npx', ['clawhub', '-V'], {
      timeout: 10_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { command: 'npx', argsPrefix: ['clawhub'] };
  } catch {
    // npx failed
  }

  // 2. Direct path via createRequire
  const { resolve, dirname } = await import('node:path');
  const { access } = await import('node:fs/promises');
  const candidates: string[] = [];

  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('clawhub/package.json');
    candidates.push(resolve(dirname(pkgPath), 'bin/clawdhub.js'));
  } catch {
    /* ignore */
  }

  candidates.push(resolve(process.cwd(), 'node_modules/.bin/clawhub'));
  candidates.push(resolve(process.cwd(), 'node_modules/clawhub/bin/clawdhub.js'));

  try {
    const { fileURLToPath } = await import('node:url');
    const thisDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(thisDir, '../../../node_modules/.bin/clawhub'));
    candidates.push(resolve(thisDir, '../../../node_modules/clawhub/bin/clawdhub.js'));
  } catch {
    /* ignore */
  }

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { command: candidate, argsPrefix: [] };
    } catch {
      /* continue */
    }
  }

  try {
    const { stdout } = await execFileAsync('which', ['clawhub'], { timeout: 5_000 });
    const path = stdout.trim();
    if (path) return { command: path, argsPrefix: [] };
  } catch {
    /* ignore */
  }

  throw new Error('clawhub CLI not found. Install with: npm i clawhub');
}

/** Run clawhub with the given args. */
function runCli(cli: ResolvedCli, args: string[], opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string }> {
  return execFileAsync(cli.command, [...cli.argsPrefix, ...args], {
    timeout: CLI_TIMEOUT_MS,
    env: { ...process.env, NO_COLOR: '1' },
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Explore (structured JSON output)
// ---------------------------------------------------------------------------

interface ExploreItem {
  slug: string;
  displayName?: string;
  summary?: string;
  stats?: {
    downloads?: number;
    stars?: number;
  };
  latestVersion?: {
    version?: string;
  };
}

interface ExploreResponse {
  items: ExploreItem[];
  nextCursor?: string;
}

function exploreItemToSkill(item: ExploreItem): ClawHubSkill {
  return {
    name: item.displayName ?? item.slug,
    slug: item.slug,
    publisher: 'clawhub',
    description: item.summary ?? '',
    category: '',
    url: `https://clawhub.ai/skills/${item.slug}`,
    downloads: item.stats?.downloads,
    stars: item.stats?.stars,
    version: item.latestVersion?.version,
  };
}

/**
 * Run `clawhub explore --json` with a given sort order.
 * Paginates using nextCursor to fetch beyond the first 200 results.
 * Retries once on failure (common on Render's network).
 */
async function exploreSort(
  cli: ResolvedCli,
  sort: string,
): Promise<ClawHubSkill[]> {
  const run = async (): Promise<ClawHubSkill[]> => {
    const args = ['explore', '--json', '--limit', '200', '--sort', sort];
    const { stdout } = await runCli(cli, args);

    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) return [];

    const data: ExploreResponse = JSON.parse(stdout.slice(jsonStart));
    if (!Array.isArray(data.items) || data.items.length === 0) return [];

    return data.items
      .filter((item) => item && typeof item.slug === 'string')
      .map(exploreItemToSkill);
  };

  try {
    return await run();
  } catch (err) {
    try {
      await new Promise((r) => setTimeout(r, 2000));
      return await run();
    } catch (retryErr) {
      console.error(
        `  [clawhub] explore --sort ${sort} failed (after retry):`,
        retryErr instanceof Error ? retryErr.message : retryErr,
      );
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Search (text output, no --json support)
// ---------------------------------------------------------------------------

/**
 * Parse a line of `clawhub search` text output.
 * Format: `slug vX.Y.Z  Display Name  (score)`
 */
function parseSearchLine(line: string): ClawHubSkill | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('=')) return null;

  // Match: slug vX.Y.Z  Display Name  (score)
  const match = trimmed.match(
    /^(\S+)\s+v(\S+)\s{2,}(.+?)\s{2,}\([\d.]+\)\s*$/,
  );
  if (!match) return null;

  const [, slug, version, displayName] = match;
  return {
    name: displayName.trim(),
    slug,
    publisher: 'clawhub',
    description: '',
    category: '',
    url: `https://clawhub.ai/skills/${slug}`,
    version,
  };
}

/**
 * Run `clawhub search <query>` and parse the text output.
 * Retries once on failure (common on Render's network).
 */
async function searchQuery(
  cli: ResolvedCli,
  query: string,
  limit: number,
): Promise<ClawHubSkill[]> {
  const run = async (): Promise<ClawHubSkill[]> => {
    const { stdout } = await runCli(cli, ['search', query, '--limit', String(limit)]);

    const skills: ClawHubSkill[] = [];
    for (const line of stdout.split('\n')) {
      const skill = parseSearchLine(line);
      if (skill) {
        if (!skill.category) skill.category = query;
        skills.push(skill);
      }
    }
    return skills;
  };

  try {
    return await run();
  } catch (err) {
    try {
      await new Promise((r) => setTimeout(r, 2000));
      return await run();
    } catch (retryErr) {
      console.error(
        `  [clawhub] search "${query}" failed (after retry):`,
        retryErr instanceof Error ? retryErr.message : retryErr,
      );
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Inspect (full metadata + SKILL.md content)
// ---------------------------------------------------------------------------

interface InspectFileEntry {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
}

interface InspectResponse {
  skill: {
    slug: string;
    displayName?: string;
    summary?: string;
    tags?: Record<string, string>;
    stats?: {
      comments?: number;
      downloads?: number;
      installsAllTime?: number;
      installsCurrent?: number;
      stars?: number;
      versions?: number;
    };
    createdAt?: number;
    updatedAt?: number;
  };
  latestVersion?: {
    version?: string;
    createdAt?: number;
    changelog?: string;
  };
  owner?: {
    handle: string;
    userId: string;
    displayName: string;
    image?: string;
  };
  version?: {
    version?: string;
    createdAt?: number;
    changelog?: string;
    changelogSource?: string;
    files?: InspectFileEntry[];
  } | null;
  file?: string | null;
}

const ETHEREUM_ADDRESS_RE = /0x[0-9a-fA-F]{40}/;

/**
 * Parse SKILL.md frontmatter for a wallet address.
 *
 * Looks for an Ethereum address in any of these frontmatter fields
 * (case-insensitive): wallet, clawmon_wallet, payment_address, publisher_wallet.
 * Falls back to scanning the full body for a `wallet:` or `payment:` line.
 */
export function extractWalletFromSkillMd(content: string): string | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    const walletKeyRe = /^(?:wallet|clawmon_wallet|payment_address|publisher_wallet)\s*:\s*["']?(0x[0-9a-fA-F]{40})["']?\s*$/im;
    const m = frontmatter.match(walletKeyRe);
    if (m) return m[1];
  }

  const bodyLineRe = /^(?:wallet|payment_address|clawmon_wallet|publisher_wallet)\s*:\s*["']?(0x[0-9a-fA-F]{40})["']?\s*$/im;
  const bodyMatch = content.match(bodyLineRe);
  if (bodyMatch) return bodyMatch[1];

  return null;
}

/**
 * Run `clawhub inspect <slug> --json --files` to get metadata + owner + file list.
 */
async function inspectSkillMeta(
  cli: ResolvedCli,
  slug: string,
): Promise<InspectResponse | null> {
  try {
    const { stdout } = await runCli(cli, ['inspect', slug, '--json', '--files']);

    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) return null;

    return JSON.parse(stdout.slice(jsonStart)) as InspectResponse;
  } catch (err) {
    console.error(
      `  [clawhub] inspect ${slug} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Run `clawhub inspect <slug> --file SKILL.md` to fetch raw SKILL.md content.
 */
async function inspectSkillFile(
  cli: ResolvedCli,
  slug: string,
): Promise<string | null> {
  try {
    const { stdout } = await runCli(cli, ['inspect', slug, '--file', 'SKILL.md']);

    // The CLI prints a spinner line ("- Fetching skill") before the content
    const spinnerEnd = stdout.indexOf('\n');
    if (spinnerEnd === -1) return stdout;
    const firstLine = stdout.slice(0, spinnerEnd).trim();
    if (firstLine.startsWith('-') || firstLine.startsWith('�') || firstLine === '') {
      return stdout.slice(spinnerEnd + 1);
    }
    return stdout;
  } catch (err) {
    console.error(
      `  [clawhub] inspect ${slug} --file SKILL.md failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Enrich a ClawHubSkill with data from `clawhub inspect`:
 *   - Owner identity (GitHub handle, avatar)
 *   - Full SKILL.md content
 *   - Wallet address parsed from frontmatter
 *   - SHA-256 of SKILL.md
 */
export async function enrichSkillWithInspect(
  cli: ResolvedCli,
  skill: ClawHubSkill,
): Promise<ClawHubSkill> {
  const meta = await inspectSkillMeta(cli, skill.slug);
  if (!meta) return skill;

  const enriched: ClawHubSkill = { ...skill };

  if (meta.owner) {
    enriched.owner = {
      handle: meta.owner.handle,
      userId: meta.owner.userId,
      displayName: meta.owner.displayName,
      image: meta.owner.image,
    };
    enriched.publisher = meta.owner.handle;
  }

  if (meta.skill.displayName) enriched.name = meta.skill.displayName;
  if (meta.skill.summary) enriched.description = meta.skill.summary;
  if (meta.skill.stats?.downloads) enriched.downloads = meta.skill.stats.downloads;
  if (meta.skill.stats?.stars) enriched.stars = meta.skill.stats.stars;

  if (meta.latestVersion?.changelog) {
    enriched.changelog = meta.latestVersion.changelog;
  }
  if (meta.latestVersion?.version) {
    enriched.version = meta.latestVersion.version;
  }

  // Find the SKILL.md hash from the files list
  const skillMdFile = meta.version?.files?.find(
    (f) => f.path === 'SKILL.md',
  );
  if (skillMdFile) {
    enriched.skillMdHash = skillMdFile.sha256;
  }

  // Fetch the full SKILL.md content
  const content = await inspectSkillFile(cli, skill.slug);
  if (content) {
    enriched.skillMd = content;
    const wallet = extractWalletFromSkillMd(content);
    if (wallet) {
      enriched.walletAddress = wallet;
    }
  }

  return enriched;
}

/**
 * Enrich a batch of skills with inspect data, with concurrency control.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function enrichSkillsBatch(
  cli: ResolvedCli,
  skills: ClawHubSkill[],
  concurrency = 2,
  onProgress?: (done: number, total: number, slug: string, hasWallet: boolean) => void,
): Promise<{ enriched: ClawHubSkill[]; inspected: number; errors: number; walletsFound: number }> {
  const enriched: ClawHubSkill[] = [];
  let inspected = 0;
  let errors = 0;
  let walletsFound = 0;
  let done = 0;
  let consecutiveErrors = 0;
  const total = skills.length;

  const BATCH_DELAY_MS = 3000;
  const BACKOFF_DELAY_MS = 15000;

  const queue = [...skills];
  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.allSettled(
      batch.map((skill) => enrichSkillWithInspect(cli, skill)),
    );

    let batchErrors = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      done++;
      if (result.status === 'fulfilled') {
        enriched.push(result.value);
        if (result.value.owner) inspected++;
        if (result.value.walletAddress) walletsFound++;
        onProgress?.(done, total, result.value.slug, !!result.value.walletAddress);
      } else {
        errors++;
        batchErrors++;
        enriched.push(batch[i]);
        onProgress?.(done, total, batch[i].slug, false);
      }
    }

    if (batchErrors === batch.length) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        console.warn(`  [clawhub] Too many consecutive failures (${consecutiveErrors}), stopping enrichment early`);
        for (const remaining of queue) enriched.push(remaining);
        break;
      }
      await sleep(BACKOFF_DELAY_MS * consecutiveErrors);
    } else {
      consecutiveErrors = 0;
      await sleep(BATCH_DELAY_MS);
    }
  }

  return { enriched, inspected, errors, walletsFound };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all skills from ClawHub by combining explore (sorted, JSON) and
 * category-based search. Results are deduplicated by slug.
 *
 * @param concurrency - Max parallel CLI invocations (default: 4)
 * @param searchLimit - Max results per search query (default: 200)
 */
export async function fetchAllSkills(
  concurrency = 4,
  searchLimit = 200,
): Promise<ClawHubSkill[]> {
  let cli: ResolvedCli;
  try {
    cli = await resolveCli();
  } catch (err) {
    console.warn(`  [clawhub] ${err instanceof Error ? err.message : err}`);
    return [];
  }

  const seen = new Map<string, ClawHubSkill>();

  function addSkills(skills: ClawHubSkill[]): void {
    for (const skill of skills) {
      if (!seen.has(skill.slug)) {
        seen.set(skill.slug, skill);
      }
    }
  }

  // Phase 1: explore with different sort orders (up to 200 each)
  console.log(
    `  [clawhub] Phase 1: explore (${EXPLORE_SORT_ORDERS.length} sort orders x 200)...`,
  );
  const exploreBatches = [...EXPLORE_SORT_ORDERS];
  while (exploreBatches.length > 0) {
    const batch = exploreBatches.splice(0, concurrency);
    const results = await Promise.allSettled(
      batch.map((sort) => exploreSort(cli, sort)),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') addSkills(result.value);
    }
  }
  console.log(`  [clawhub] Phase 1 complete: ${seen.size} unique skills`);

  // Phase 2: category-based search for broader coverage
  console.log(
    `  [clawhub] Phase 2: search (${SEARCH_CATEGORIES.length} categories x ${searchLimit})...`,
  );
  const categories = [...SEARCH_CATEGORIES];
  while (categories.length > 0) {
    const batch = categories.splice(0, concurrency);
    const results = await Promise.allSettled(
      batch.map((cat) => searchQuery(cli, cat, searchLimit)),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') addSkills(result.value);
    }
  }

  console.log(`  [clawhub] Fetched ${seen.size} unique skills total`);
  return Array.from(seen.values());
}
