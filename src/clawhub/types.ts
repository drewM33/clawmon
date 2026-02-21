/**
 * Trusted ClawMon — ClawHub Integration Types
 *
 * Data models for skills fetched from the ClawHub public registry.
 */

/** Owner identity from ClawHub (backed by GitHub OAuth) */
export interface ClawHubOwner {
  handle: string;
  userId: string;
  displayName: string;
  image?: string;
}

/** A skill entry retrieved from ClawHub */
export interface ClawHubSkill {
  name: string;
  slug: string;
  publisher: string;
  description: string;
  category: string;
  url: string;
  downloads?: number;
  stars?: number;
  version?: string;

  /** Owner identity from ClawHub inspect (GitHub-authenticated) */
  owner?: ClawHubOwner;
  /** Full SKILL.md content */
  skillMd?: string;
  /** Wallet address extracted from SKILL.md frontmatter */
  walletAddress?: string;
  /** Changelog from the latest version */
  changelog?: string;
  /** SHA-256 hash of the SKILL.md file */
  skillMdHash?: string;
}

/** Result summary returned after a ClawHub sync operation */
export interface ClawHubSyncResult {
  total: number;
  newlyAdded: number;
  skippedExisting: number;
  inspected: number;
  inspectErrors: number;
  walletsFound: number;
  errors: number;
  durationMs: number;
}
