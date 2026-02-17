/**
 * OnChainActivityFeed
 *
 * Fixed popup in the bottom-left corner that shows real on-chain activity:
 * - Local user transactions (stake, delegate, unstake, etc.)
 * - Network-wide staking events via WebSocket
 *
 * Each notification shows the activity type, a truncated tx hash
 * linking to the block explorer, and auto-dismisses after 10 seconds.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, X, Activity, Check, Loader2, AlertTriangle } from 'lucide-react';
import { useTransactionFeed, type TxNotification } from '../context/TransactionFeedContext';
import { useWSEvent } from '../hooks/useWebSocket';

const AUTO_DISMISS_MS = 10_000;
const EXPLORER_BASE = 'https://testnet.monadexplorer.com/tx/';

function truncateHash(hash: string): string {
  if (!hash || hash.length < 14) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function StatusIcon({ status }: { status: TxNotification['status'] }) {
  switch (status) {
    case 'pending':
      return <Loader2 className="activity-status-icon spinning" />;
    case 'confirmed':
      return <Check className="activity-status-icon confirmed" />;
    case 'failed':
      return <AlertTriangle className="activity-status-icon failed" />;
  }
}

function ActivityItem({
  tx,
  onDismiss,
}: {
  tx: TxNotification;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(tx.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timerRef.current);
  }, [tx.id, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -80, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`activity-item activity-${tx.status}`}
    >
      <div className="activity-item-left">
        <StatusIcon status={tx.status} />
        <div className="activity-item-info">
          <span className="activity-type">{tx.type}</span>
          <a
            href={`${EXPLORER_BASE}${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="activity-hash"
            title={tx.hash}
          >
            {truncateHash(tx.hash)}
            <ExternalLink className="activity-link-icon" />
          </a>
        </div>
      </div>
      <button
        className="activity-dismiss"
        onClick={() => onDismiss(tx.id)}
        aria-label="Dismiss"
      >
        <X className="activity-dismiss-icon" />
      </button>
      <div className="activity-progress">
        <motion.div
          className="activity-progress-bar"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: AUTO_DISMISS_MS / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}

export default function OnChainActivityFeed() {
  const { transactions, addTransaction, dismissTransaction } =
    useTransactionFeed();

  const handleDismiss = useCallback(
    (id: string) => dismissTransaction(id),
    [dismissTransaction],
  );

  // Listen for real staking events from the WebSocket (network-wide)
  useWSEvent('staking:event', (event) => {
    const p = event.payload;
    if (!p?.transactionHash) return;

    const type =
      p.eventName === 'AgentStaked'
        ? 'Stake'
        : p.eventName === 'StakeIncreased'
          ? 'Add Stake'
          : p.eventName === 'Delegated'
            ? 'Delegate'
            : p.eventName === 'UnbondingInitiated'
              ? 'Unstake'
              : p.eventName === 'UnbondingCompleted'
                ? 'Complete Unbonding'
                : p.eventName === 'Slashed'
                  ? 'Slash'
                  : 'Staking Event';

    addTransaction({
      type,
      hash: p.transactionHash,
      status: 'confirmed',
      from: p.args?.publisher || p.args?.user || p.args?.staker,
    });
  });

  return (
    <div className="activity-feed-container">
      <div className="activity-feed-header">
        <Activity className="activity-feed-header-icon" />
        <span>On-Chain Activity</span>
      </div>
      <AnimatePresence mode="popLayout">
        {transactions.slice(0, 5).map((tx) => (
          <ActivityItem
            key={tx.id}
            tx={tx}
            onDismiss={handleDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
