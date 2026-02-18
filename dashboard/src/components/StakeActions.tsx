import { useState, useEffect, useRef, type CSSProperties } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSwitchChain,
} from 'wagmi';
import { parseEther, formatEther, keccak256, toBytes } from 'viem';
import { monadTestnet } from '../config/wagmi';
import {
  TRUST_STAKING_ADDRESS,
  TRUST_STAKING_ABI,
} from '../config/contracts';
import { useTransactionFeed, type TxActivityType } from '../context/TransactionFeedContext';

type ActionMode = 'idle' | 'stake' | 'delegate' | 'unstake';

interface StakeActionsProps {
  agentId: string;
  isStaked: boolean;
  onTransactionConfirmed: () => void;
}

const TIER_THRESHOLDS = [
  { label: 'Low', min: '0.01', color: '#3b82f6' },
  { label: 'Mid', min: '0.05', color: '#8b5cf6' },
  { label: 'High', min: '0.25', color: '#f59e0b' },
];

export default function StakeActions({
  agentId,
  isStaked,
  onTransactionConfirmed,
}: StakeActionsProps) {
  const [mode, setMode] = useState<ActionMode>('idle');
  const [amount, setAmount] = useState('');

  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { addTransaction, updateTransaction } = useTransactionFeed();

  const agentIdHash = keccak256(toBytes(agentId));
  const feedIdRef = useRef<string | null>(null);
  const pendingTypeRef = useRef<TxActivityType | null>(null);

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  // Read the agent's on-chain stake data to check publisher
  const { data: stakeData } = useReadContract({
    address: TRUST_STAKING_ADDRESS,
    abi: TRUST_STAKING_ABI,
    functionName: 'getAgentStake',
    args: [agentIdHash],
    chainId: monadTestnet.id,
    query: { enabled: true },
  });

  const stakeRecord = stakeData as
    | readonly [string, bigint, bigint, bigint, bigint, bigint, boolean, number]
    | undefined;
  const onChainActive = stakeRecord?.[6] ?? false;
  const onChainPublisher = stakeRecord?.[0];
  const isPublisher =
    !!address && !!onChainPublisher && onChainActive &&
    address.toLowerCase() === onChainPublisher.toLowerCase();

  // Read pending unbonding for connected user
  const { data: unbondingData } = useReadContract({
    address: TRUST_STAKING_ADDRESS,
    abi: TRUST_STAKING_ABI,
    functionName: 'getUnbonding',
    args: address ? [address, agentIdHash] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: !!address },
  });

  // Push transaction to the activity feed when a tx hash is received
  useEffect(() => {
    if (txHash && !feedIdRef.current && pendingTypeRef.current) {
      feedIdRef.current = addTransaction({
        type: pendingTypeRef.current,
        hash: txHash,
        status: 'pending',
        from: address,
      });
    }
  }, [txHash, address, addTransaction]);

  // Update the feed notification when the transaction is confirmed
  useEffect(() => {
    if (isConfirmed && feedIdRef.current) {
      updateTransaction(feedIdRef.current, { status: 'confirmed' });
      feedIdRef.current = null;
    }
  }, [isConfirmed, updateTransaction]);

  // Update on error
  useEffect(() => {
    if (writeError && feedIdRef.current) {
      updateTransaction(feedIdRef.current, { status: 'failed' });
      feedIdRef.current = null;
    }
  }, [writeError, updateTransaction]);

  // Refresh parent staking data after confirmation
  useEffect(() => {
    if (isConfirmed) {
      onTransactionConfirmed();
      const timer = setTimeout(() => {
        setMode('idle');
        setAmount('');
        reset();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isConfirmed, onTransactionConfirmed, reset]);

  /* ─── Not connected ──────────────────────────────────── */
  if (!isConnected) {
    return (
      <div className="stake-actions-connect">
        Connect your wallet to stake, delegate, or unstake.
      </div>
    );
  }

  /* ─── Wrong chain ────────────────────────────────────── */
  const isWrongChain = chainId !== monadTestnet.id;

  if (isWrongChain) {
    return (
      <div className="stake-actions">
        <div className="stake-actions-wrong-chain">
          <span>Switch to Monad Testnet to interact with staking</span>
          <button
            className="stake-btn switch-chain"
            onClick={() => switchChain({ chainId: monadTestnet.id })}
          >
            Switch to Monad
          </button>
        </div>
      </div>
    );
  }

  /* ─── Unbonding helpers ──────────────────────────────── */
  const unbondingTuple = unbondingData as
    | readonly [bigint, bigint]
    | undefined;
  const hasUnbonding = unbondingTuple && unbondingTuple[0] > 0n;
  const unbondingAmountEth = hasUnbonding
    ? formatEther(unbondingTuple[0])
    : '0';
  const unbondingAvailableAt = hasUnbonding
    ? Number(unbondingTuple[1])
    : 0;
  const unbondingReady =
    hasUnbonding && Date.now() / 1000 >= unbondingAvailableAt;

  /* ─── Submit handler ─────────────────────────────────── */
  const handleSubmit = () => {
    const val = Number(amount);
    if (!amount || isNaN(val) || val <= 0) return;

    feedIdRef.current = null;

    if (mode === 'stake') {
      // Use on-chain active status to pick the right contract function:
      // - Not active on-chain → stakeAgent (first stake)
      // - Active + we're publisher → increaseStake
      // - Active + someone else is publisher → delegate
      const functionName = !onChainActive
        ? 'stakeAgent'
        : isPublisher
          ? 'increaseStake'
          : 'delegate';

      pendingTypeRef.current = !onChainActive ? 'Stake' : isPublisher ? 'Add Stake' : 'Delegate';

      writeContract({
        address: TRUST_STAKING_ADDRESS,
        abi: TRUST_STAKING_ABI,
        functionName,
        args: [agentIdHash],
        value: parseEther(amount),
      });
    } else if (mode === 'delegate') {
      pendingTypeRef.current = 'Delegate';
      writeContract({
        address: TRUST_STAKING_ADDRESS,
        abi: TRUST_STAKING_ABI,
        functionName: 'delegate',
        args: [agentIdHash],
        value: parseEther(amount),
      });
    } else if (mode === 'unstake') {
      pendingTypeRef.current = 'Unstake';
      writeContract({
        address: TRUST_STAKING_ADDRESS,
        abi: TRUST_STAKING_ABI,
        functionName: 'initiateUnbonding',
        args: [agentIdHash, parseEther(amount)],
      });
    }
  };

  const handleCancel = () => {
    setMode('idle');
    setAmount('');
    reset();
    feedIdRef.current = null;
    pendingTypeRef.current = null;
  };

  /* ─── Idle: show action buttons ──────────────────────── */
  if (mode === 'idle') {
    return (
      <div className="stake-actions">
        <div className="stake-actions-buttons">
          <button
            className="stake-btn primary"
            onClick={() => {
              reset();
              setMode('stake');
            }}
          >
            {!isStaked ? 'Stake MON' : isPublisher ? 'Add Stake' : 'Stake MON'}
          </button>
          {isStaked && (
            <button
              className="stake-btn delegate-btn"
              onClick={() => {
                reset();
                setMode('delegate');
              }}
            >
              Delegate
            </button>
          )}
          {isStaked && (
            <button
              className="stake-btn unstake-btn"
              onClick={() => {
                reset();
                setMode('unstake');
              }}
            >
              Unstake
            </button>
          )}
        </div>

        {hasUnbonding && (
          <div className="stake-unbonding-info">
            <span className="unbonding-label">Pending Unbonding:</span>
            <span className="unbonding-amount">
              {Number(unbondingAmountEth).toFixed(4)} MON
            </span>
            {unbondingReady ? (
              <button
                className="stake-btn complete-btn"
                onClick={() => {
                  feedIdRef.current = null;
                  pendingTypeRef.current = 'Complete Unbonding';
                  writeContract({
                    address: TRUST_STAKING_ADDRESS,
                    abi: TRUST_STAKING_ABI,
                    functionName: 'completeUnbonding',
                    args: [agentIdHash],
                  });
                }}
              >
                Withdraw
              </button>
            ) : (
              <span className="unbonding-countdown">
                Available{' '}
                {new Date(unbondingAvailableAt * 1000).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ─── Active form: stake / delegate / unstake ────────── */
  return (
    <div className="stake-actions">
      <div className="stake-form">
        <div className="stake-form-header">
          <h4 className="stake-form-title">
            {mode === 'stake'
              ? isStaked
                ? 'Add Stake'
                : 'Stake MON'
              : mode === 'delegate'
                ? 'Delegate MON'
                : 'Initiate Unstake'}
          </h4>
          <button className="stake-form-cancel" onClick={handleCancel}>
            &times;
          </button>
        </div>

        {/* Tier threshold selectors (stake / delegate only) */}
        {(mode === 'stake' || mode === 'delegate') && (
          <div className="stake-tiers">
            {TIER_THRESHOLDS.map((tier) => (
              <div
                key={tier.label}
                className={`stake-tier-indicator ${Number(amount) >= Number(tier.min) ? 'active' : ''}`}
                style={{ '--tier-color': tier.color } as CSSProperties}
                onClick={() => setAmount(tier.min)}
              >
                <span className="tier-min">{tier.min} MON</span>
                <span className="tier-label-text">{tier.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Amount input */}
        <div className="stake-input-row">
          <input
            type="number"
            className="stake-input"
            placeholder={
              mode === 'unstake' ? 'Amount to unstake' : '0.00'
            }
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            step="0.01"
            min="0"
          />
          <span className="stake-input-suffix">MON</span>
        </div>

        {/* Unstake cooldown warning */}
        {mode === 'unstake' && (
          <div className="stake-unstake-warning">
            7-day cooldown period before withdrawal. Your stake can still
            be slashed during unbonding.
          </div>
        )}

        {/* Status feedback */}
        {writeError && (
          <div className="stake-error">
            {(writeError as Error).message?.includes('User rejected') ||
            (writeError as Error).message?.includes('rejected')
              ? 'Transaction rejected by user'
              : (writeError as Error).message?.includes('exceeds defined limit') ||
                (writeError as Error).message?.includes('reverted')
                ? 'Transaction would fail on-chain. The agent may already be staked or you may lack permission.'
                : (writeError as Error).message?.slice(0, 140)}
          </div>
        )}
        {isPending && (
          <div className="stake-status pending">
            Confirm in your wallet&hellip;
          </div>
        )}
        {isConfirming && txHash && (
          <div className="stake-status confirming">
            Transaction confirming&hellip;
            <a
              href={`https://testnet.monadexplorer.com/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="stake-tx-link"
            >
              {txHash.slice(0, 6)}...{txHash.slice(-4)} ↗
            </a>
          </div>
        )}
        {isConfirmed && txHash && (
          <div className="stake-status confirmed">
            Transaction confirmed!
            <a
              href={`https://testnet.monadexplorer.com/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="stake-tx-link"
            >
              {txHash.slice(0, 6)}...{txHash.slice(-4)} ↗
            </a>
          </div>
        )}

        {/* Form buttons */}
        <div className="stake-form-actions">
          <button className="stake-btn secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="stake-btn primary"
            onClick={handleSubmit}
            disabled={
              !amount ||
              Number(amount) <= 0 ||
              isPending ||
              isConfirming
            }
          >
            {isPending || isConfirming
              ? 'Processing\u2026'
              : mode === 'stake'
                ? 'Stake'
                : mode === 'delegate'
                  ? 'Delegate'
                  : 'Begin Unstake'}
          </button>
        </div>
      </div>
    </div>
  );
}
