import { http, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { defineChain } from 'viem';
import { injected, walletConnect } from 'wagmi/connectors';
import {
  WALLETCONNECT_PROJECT_ID,
  MONAD_RPC_URL,
} from './env';

/**
 * Monad Testnet chain definition.
 * Using defineChain from viem since Monad is not yet in the wagmi built-in chains.
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'MON',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [MONAD_RPC_URL || 'https://testnet.monad.xyz/v1'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
  testnet: true,
});

const connectors = [
  injected(),
  ...(WALLETCONNECT_PROJECT_ID
    ? [
        walletConnect({
          projectId: WALLETCONNECT_PROJECT_ID,
          metadata: {
            name: 'Trusted ClawMon',
            description: 'Attack-Resistant Trust Registry for AI Agent Skills',
            url: 'https://clawmon.io',
            icons: [],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [monadTestnet, mainnet],
  connectors,
  transports: {
    [monadTestnet.id]: http(MONAD_RPC_URL || undefined),
    [mainnet.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
