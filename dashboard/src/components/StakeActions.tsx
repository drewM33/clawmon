import { useState, useEffect, useRef, type CSSProperties } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSwitchChain,
} from 'wagmi';
import { parseEther, formatEther, keccak256, toBytes } from 'viem';
import { ThumbsUp, ThumbsDown, ArrowUp, ArrowDown } from 'lucide-react';
import { monadTestnet } from '../config/wagmi';
import {
  TRUST_STAKING_ADDRESS,
  TRUST_STAKING_ABI,
} from '../config/contracts';
import { useTransactionFeed, type TxActivityType } from '../context/TransactionFeedContext';

type ActionMode = 'idle' | 'upvote' | 'downvote';

interface StakeActionsProps {
  agentId: string;
  isStaked: boolean;
  onTransactionConfirmed: () => void;
}

const VOTE_AMOUNTS = [
  { label: '0.15', color: '#3b82f6' },
  { label: '0.25', color: '#8b5cf6' },
  { label: '0.50', color: '#f59e0b' },
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

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    pollingInterval: 2_000,
    timeout: 120_000,
  });

  const { data: stakeData, refetch: refetchStake } = useReadContract({
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
  const onChainPublisher = stakeRecord?.[0] as `0x${string}` | undefined;

  const { data: unbondingData } = useReadContract({
    address: TRUST_STAKING_ADDRESS,
    abi: TRUST_STAKING_ABI,
    functionName: 'getUnbonding',
    args: address ? [address, agentIdHash] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: !!address },
  });

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

  useEffect(() => {
    if (isConfirmed && feedIdRef.current) {
      updateTransaction(feedIdRef.current, { status: 'confirmed' });
      feedIdRef.current = null;
    }
  }, [isConfirmed, updateTransaction]);

  useEffect(() => {
    if (writeError) {
      if (feedIdRef.current) {
        updateTransaction(feedIdRef.current, { status: 'failed' });
        feedIdRef.current = null;
      }
      refetchStake();
    }
  }, [writeError, updateTransaction, refetchStake]);

  useEffect(() => {
    if (isConfirmed) {
      onTransactionConfirmed();
      refetchStake();
      const timer = setTimeout(() => {
        setMode('idle');
        setAmount('');
        reset();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isConfirmed, onTransactionConfirmed, reset, refetchStake]);

  if (!isConnected) {
    return (
      <div className="stake-actions-connect">
        Connect your wallet to upvote or downvote this skill.
      </div>
    );
  }

  const isWrongChain = chainId !== monadTestnet.id;

  if (isWrongChain) {
    return (
      <div className="stake-actions">
        <div className="stake-actions-wrong-chain">
          <span>Switch to Monad Testnet to vote</span>
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

  const handleSubmit = () => {
    const val = Number(amount);
    if (!amount || isNaN(val) || val <= 0) return;

    if (isWrongChain) {
      switchChain({ chainId: monadTestnet.id });
      return;
    }

    feedIdRef.current = null;

    if (mode === 'upvote') {
      // Pick the right contract call based on on-chain state:
      //  - stakeAgent: agent has no active stake (first time, or deactivated after slash)
      //  - delegate:   agent already active, we're adding vote weight
      //  - increaseStake: agent active AND we are the publisher
      let functionName: 'stakeAgent' | 'delegate' | 'increaseStake';
      let txLabel: TxActivityType;

      if (!onChainActive) {
        functionName = 'stakeAgent';
        txLabel = 'Stake';
      } else if (
        onChainPublisher &&
        address &&
        onChainPublisher.toLowerCase() === address.toLowerCase()
      ) {
        functionName = 'increaseStake';
        txLabel = 'Stake';
      } else {
        functionName = 'delegate';
        txLabel = 'Delegate';
      }

      pendingTypeRef.current = txLabel;

      writeContract({
        address: TRUST_STAKING_ADDRESS,
        abi: TRUST_STAKING_ABI,
        functionName,
        args: [agentIdHash],
        value: parseEther(amount),
        chainId: monadTestnet.id,
      });
    } else if (mode === 'downvote') {
      pendingTypeRef.current = 'Unstake';
      writeContract({
        address: TRUST_STAKING_ADDRESS,
        abi: TRUST_STAKING_ABI,
        functionName: 'initiateUnbonding',
        args: [agentIdHash, parseEther(amount)],
        chainId: monadTestnet.id,
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

  if (mode === 'idle') {
    return (
      <div className="stake-actions">
        <div className="stake-actions-buttons">
          <button
            className="stake-btn primary"
            onClick={() => {
              reset();
              setMode('upvote');
            }}
          >
            <ArrowUp className="w-3.5 h-3.5" style={{ marginRight: 4 }} />
            Upvote
          </button>
          {isStaked && (
            <button
              className="stake-btn unstake-btn"
              onClick={() => {
                reset();
                setMode('downvote');
              }}
            >
              <ArrowDown className="w-3.5 h-3.5" style={{ marginRight: 4 }} />
              Downvote
            </button>
          )}
        </div>

        {hasUnbonding && (
          <div className="stake-unbonding-info">
            <span className="unbonding-label">Pending withdrawal:</span>
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

  return (
    <div className="stake-actions">
      <div className="stake-form">
        <div className="stake-form-header">
          <h4 className="stake-form-title">
            {mode === 'upvote' ? (
              <><ThumbsUp className="w-4 h-4" style={{ marginRight: 6 }} /> Upvote with MON</>
            ) : (
              <><ThumbsDown className="w-4 h-4" style={{ marginRight: 6 }} /> Downvote (unstake MON)</>
            )}
          </h4>
          <button className="stake-form-cancel" onClick={handleCancel}>
            &times;
          </button>
        </div>

        {mode === 'upvote' && (
          <div className="stake-tiers">
            {VOTE_AMOUNTS.map((tier) => (
              <div
                key={tier.label}
                className={`stake-tier-indicator ${Number(amount) >= Number(tier.label) ? 'active' : ''}`}
                style={{ '--tier-color': tier.color } as CSSProperties}
                onClick={() => setAmount(tier.label)}
              >
                <span className="tier-min">{tier.label} MON</span>
              </div>
            ))}
          </div>
        )}

        <div className="stake-input-row">
          <input
            type="number"
            className="stake-input"
            placeholder={
              mode === 'downvote' ? 'Amount to remove' : '0.00'
            }
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            step="0.01"
            min="0"
          />
          <span className="stake-input-suffix">MON</span>
        </div>

        {mode === 'downvote' && (
          <div className="stake-unstake-warning">
            7-day cooldown before withdrawal. Your stake can still
            be slashed during this period.
          </div>
        )}

        {writeError && (
          <div className="stake-error">
            {(() => {
              const msg = (writeError as Error).message ?? '';
              if (msg.includes('User rejected') || msg.includes('rejected'))
                return 'Transaction rejected by user';
              if (msg.includes('Agent not active'))
                return 'Agent not active on-chain — try again (will re-stake automatically).';
              if (msg.includes('Already staked'))
                return 'Agent already staked — refreshing state...';
              if (msg.includes('Below minimum'))
                return 'Amount below minimum (0.01 MON).';
              if (msg.includes('insufficient') || msg.includes('exceeds balance'))
                return 'Insufficient MON balance.';
              if (msg.includes('exceeds defined limit') || msg.includes('reverted'))
                return 'Transaction reverted. Check your balance and try again.';
              return msg.slice(0, 140);
            })()}
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
            {mode === 'upvote' ? 'Upvote' : 'Downvote'} confirmed!
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
        {receiptError && txHash && (
          <div className="stake-status confirming">
            Transaction submitted — confirmation timed out. Check explorer:
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
            {isPending
              ? 'Processing\u2026'
              : isConfirming
                ? 'Confirming\u2026'
                : mode === 'upvote'
                  ? 'Upvote'
                  : 'Downvote'}
          </button>
        </div>
      </div>
    </div>
  );
}
