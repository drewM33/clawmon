/**
 * Contract configuration for frontend write operations.
 * Monad testnet: staking + paywall + ERC-8004 registries
 * Base Sepolia: USDC payments via x402
 */

export const TRUST_STAKING_ADDRESS = '0x2Dd0946Be048e7B61E2995bdDE97860427e74562' as const;

export const STAKE_ESCROW_ADDRESS = '0xc05898660C0b67de8C9789E069ddfeA8619F105a' as const;

export const SKILL_PAYWALL_ADDRESS = '0xDf54a2EeDc398dD939501E780e5F818F7C445b06' as const;

// ---------------------------------------------------------------------------
// ERC-8004 Registries (Monad Testnet)
// ---------------------------------------------------------------------------

export const ERC8004_IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
export const ERC8004_REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;

export const REPUTATION_REGISTRY_ABI = [
  {
    name: 'giveFeedback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'readFeedback',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddress', type: 'address' },
      { name: 'feedbackIndex', type: 'uint64' },
    ],
    outputs: [
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'isRevoked', type: 'bool' },
    ],
  },
  {
    name: 'getSummary',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
  },
  {
    name: 'getClients',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getLastIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddress', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
  },
] as const;

/** USDC on Base Sepolia (Circle test USDC) */
export const USDC_BASE_SEPOLIA_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;

/** x402 payment recipient (ClawMon protocol) */
export const X402_PAY_TO = '0x3e4A16256813D232F25F5b01c49E95ceaD44d7Ed' as const;

/** x402 price per skill verification in USDC (6 decimals) — $0.001 = 1000 */
export const X402_PRICE_USDC = 1000n;

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const SKILL_PAYWALL_ABI = [
  {
    name: 'payForSkill',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getEffectivePrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getSkillPricing',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [
      { name: 'pricePerCall', type: 'uint256' },
      { name: 'trustTier', type: 'uint8' },
      { name: 'active', type: 'bool' },
      { name: 'publisher', type: 'address' },
      { name: 'effectivePrice', type: 'uint256' },
    ],
  },
  {
    name: 'registerSkill',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'bytes32' },
      { name: 'publisher', type: 'address' },
      { name: 'pricePerCall', type: 'uint256' },
      { name: 'trustTier', type: 'uint8' },
    ],
    outputs: [],
  },
] as const;

export const TRUST_STAKING_ABI = [
  {
    name: 'stakeAgent',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'increaseStake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'delegate',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'initiateUnbonding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'completeUnbonding',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getAgentStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [
      { name: 'publisher', type: 'address' },
      { name: 'stakeAmount', type: 'uint256' },
      { name: 'delegatedStake', type: 'uint256' },
      { name: 'totalStake', type: 'uint256' },
      { name: 'stakedAt', type: 'uint256' },
      { name: 'lastSlashTime', type: 'uint256' },
      { name: 'active', type: 'bool' },
      { name: 'tier', type: 'uint8' },
    ],
  },
  {
    name: 'getDelegation',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'curator', type: 'address' },
      { name: 'agentId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getUnbonding',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'agentId', type: 'bytes32' },
    ],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'availableAt', type: 'uint256' },
    ],
  },
] as const;

export const STAKE_ESCROW_ABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'skillId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getSkillStake',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'skillId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getBoostUnits',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'skillId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getTrustLevel',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'skillId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;
