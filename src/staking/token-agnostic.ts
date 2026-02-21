/**
 * Trusted ClawMon — Token-Agnostic Staking Interfaces
 *
 * Abstracts the staking mechanism so the system can accept:
 *   1. Native MON (current implementation)
 *   2. ERC-20 tokens (future)
 *   3. LP tokens from AMM pools (future — Option 1 from roadmap)
 *   4. Receipt/wrapper tokens (future — ClawMon-issued)
 *
 * The current TrustStaking contract accepts native MON only. These
 * interfaces are designed so that when LP token support is added,
 * the scoring engine, reputation system, and dashboard can consume
 * staking data without caring about the underlying asset type.
 */

// ---------------------------------------------------------------------------
// Supported Asset Types
// ---------------------------------------------------------------------------

export enum StakeAssetType {
  NativeMON = 'native_mon',
  ERC20 = 'erc20',
  LPToken = 'lp_token',
  ReceiptToken = 'receipt_token',
}

export interface StakeAsset {
  type: StakeAssetType;
  /** Contract address (zero address for native MON) */
  address: string;
  /** Human-readable name (e.g. "MON", "MON-USDC LP") */
  symbol: string;
  /** Decimals (18 for MON) */
  decimals: number;
  /** If LP token, the underlying pair */
  underlyingPair?: { token0: string; token1: string };
}

export const NATIVE_MON: StakeAsset = {
  type: StakeAssetType.NativeMON,
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'MON',
  decimals: 18,
};

// ---------------------------------------------------------------------------
// Abstract Staking Position
// ---------------------------------------------------------------------------

/**
 * A staking position that is asset-type agnostic.
 * The scoring engine uses `normalizedValueMon` for all calculations.
 */
export interface StakingPosition {
  /** The staker's address */
  staker: string;
  /** The skill being staked on */
  agentId: string;
  /** The asset staked */
  asset: StakeAsset;
  /** Raw amount in the asset's native units (wei string) */
  rawAmount: string;
  /** Normalized value in MON terms for scoring comparisons */
  normalizedValueMon: number;
  /** When this position was created */
  stakedAt: number;
  /** Whether this is a publisher stake (true) or curator delegation (false) */
  isPublisherStake: boolean;
}

// ---------------------------------------------------------------------------
// Asset Normalizer Interface
// ---------------------------------------------------------------------------

/**
 * Converts arbitrary staked assets to a MON-equivalent value.
 * Implementations will handle price feeds, LP token decomposition, etc.
 *
 * For now, the only implementation is the identity function for native MON.
 * When LP tokens are added, an implementation using on-chain price oracles
 * or AMM pool reserves will be swapped in.
 */
export interface AssetNormalizer {
  /** Convert a raw amount of an asset to MON-equivalent value */
  normalize(asset: StakeAsset, rawAmountWei: string): Promise<number>;
  /** Get the current exchange rate (asset → MON) */
  getRate(asset: StakeAsset): Promise<number>;
  /** Check if this normalizer supports the given asset */
  supports(asset: StakeAsset): boolean;
}

// ---------------------------------------------------------------------------
// Native MON Normalizer (current implementation)
// ---------------------------------------------------------------------------

export class NativeMONNormalizer implements AssetNormalizer {
  async normalize(_asset: StakeAsset, rawAmountWei: string): Promise<number> {
    return Number(BigInt(rawAmountWei)) / 1e18;
  }

  async getRate(_asset: StakeAsset): Promise<number> {
    return 1.0;
  }

  supports(asset: StakeAsset): boolean {
    return asset.type === StakeAssetType.NativeMON;
  }
}

// ---------------------------------------------------------------------------
// Composite Normalizer (routes to correct implementation)
// ---------------------------------------------------------------------------

export class CompositeNormalizer implements AssetNormalizer {
  private normalizers: AssetNormalizer[];

  constructor(normalizers: AssetNormalizer[] = [new NativeMONNormalizer()]) {
    this.normalizers = normalizers;
  }

  async normalize(asset: StakeAsset, rawAmountWei: string): Promise<number> {
    const normalizer = this.normalizers.find(n => n.supports(asset));
    if (!normalizer) {
      throw new Error(`No normalizer registered for asset type: ${asset.type}`);
    }
    return normalizer.normalize(asset, rawAmountWei);
  }

  async getRate(asset: StakeAsset): Promise<number> {
    const normalizer = this.normalizers.find(n => n.supports(asset));
    if (!normalizer) return 0;
    return normalizer.getRate(asset);
  }

  supports(asset: StakeAsset): boolean {
    return this.normalizers.some(n => n.supports(asset));
  }

  registerNormalizer(normalizer: AssetNormalizer): void {
    this.normalizers.push(normalizer);
  }
}

// ---------------------------------------------------------------------------
// Default instance
// ---------------------------------------------------------------------------

export const defaultNormalizer = new CompositeNormalizer();
