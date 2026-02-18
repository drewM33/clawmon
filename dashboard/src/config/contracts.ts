/**
 * TrustStaking contract configuration for frontend write operations.
 * Deployed on Monad testnet.
 */

export const TRUST_STAKING_ADDRESS = '0x2Dd0946Be048e7B61E2995bdDE97860427e74562' as const;

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
