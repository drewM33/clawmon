/**
 * TransactionFeedContext
 *
 * Global store for on-chain activity notifications.
 * Components call `addTransaction()` when a real transaction is submitted.
 * The OnChainActivityFeed component reads this list to render the popup.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

export type TxActivityType =
  | 'Stake'
  | 'Add Stake'
  | 'Delegate'
  | 'Unstake'
  | 'Complete Unbonding'
  | 'Slash'
  | 'Register Agent'
  | 'Attestation'
  | 'Staking Event'
  | 'Pay for Skill';

export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TxNotification {
  id: string;
  type: TxActivityType;
  hash: string;
  status: TxStatus;
  from?: string;
  timestamp: number;
}

interface TransactionFeedContextValue {
  transactions: TxNotification[];
  addTransaction: (tx: Omit<TxNotification, 'id' | 'timestamp'>) => string;
  updateTransaction: (id: string, updates: Partial<TxNotification>) => void;
  dismissTransaction: (id: string) => void;
}

const TransactionFeedContext = createContext<TransactionFeedContextValue | null>(
  null,
);

let nextId = 0;

export function TransactionFeedProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<TxNotification[]>([]);

  const addTransaction = useCallback(
    (tx: Omit<TxNotification, 'id' | 'timestamp'>): string => {
      const id = `tx-${++nextId}-${Date.now()}`;
      const notification: TxNotification = {
        ...tx,
        id,
        timestamp: Date.now(),
      };
      setTransactions((prev) => [notification, ...prev].slice(0, 20));
      return id;
    },
    [],
  );

  const updateTransaction = useCallback(
    (id: string, updates: Partial<TxNotification>) => {
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx)),
      );
    },
    [],
  );

  const dismissTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((tx) => tx.id !== id));
  }, []);

  return (
    <TransactionFeedContext.Provider
      value={{ transactions, addTransaction, updateTransaction, dismissTransaction }}
    >
      {children}
    </TransactionFeedContext.Provider>
  );
}

export function useTransactionFeed(): TransactionFeedContextValue {
  const ctx = useContext(TransactionFeedContext);
  if (!ctx) {
    throw new Error(
      'useTransactionFeed must be used within a TransactionFeedProvider',
    );
  }
  return ctx;
}
