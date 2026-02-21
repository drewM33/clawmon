import { useState, useCallback, useEffect, useRef } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { useAuth } from '../context/AuthContext';
import { useCallerPaymentVerification } from '../hooks/useApi';
import { API_BASE } from '../config/env';
import {
  ERC8004_REPUTATION_REGISTRY,
  REPUTATION_REGISTRY_ABI,
} from '../config/contracts';
import { monadTestnet } from '../config/wagmi';

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

interface FeedbackFormProps {
  agentId: string;
  onSubmitted?: () => void;
  /** bytes32 proofMessage from an ExecutionReceipt — used as feedbackHash in giveFeedback() */
  executionProofHash?: string;
}

/* =====================================================================
   On-Chain Review via ERC-8004 ReputationRegistry

   The review form is available to any connected wallet. Payment history
   from x402 skill usage is shown as a trust signal (enrichment badge)
   but does NOT block the review.

   The user's wallet signs giveFeedback() on the ReputationRegistry,
   making the review truly on-chain and queryable via readFeedback()
   and getSummary().
   ===================================================================== */

function FeedbackFormInner({ agentId, onSubmitted, executionProofHash }: FeedbackFormProps) {
  const { address } = useAuth();
  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: verification } = useCallerPaymentVerification(agentId, address);
  const [value, setValue] = useState(75);
  const [tag1, setTag1] = useState('');

  // ERC-8004 agent ID resolution
  const [erc8004AgentId, setErc8004AgentId] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const hasNotifiedBackend = useRef(false);
  const submittedValue = useRef(0);
  const submittedTag = useRef('');

  const isOnMonad = chainId === monadTestnet.id;
  const hasPaymentHistory = (verification?.totalPayments ?? 0) > 0;

  // Resolve string agentId → ERC-8004 numeric tokenId on mount
  useEffect(() => {
    if (!agentId) return;
    setResolving(true);
    setResolveError(null);
    fetch(`${API_BASE}/erc8004/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.erc8004AgentId != null) {
          setErc8004AgentId(data.erc8004AgentId);
        } else {
          setResolveError(data.error || 'Could not resolve ERC-8004 agent ID');
        }
      })
      .catch(() => setResolveError('Failed to connect to server'))
      .finally(() => setResolving(false));
  }, [agentId]);

  // On-chain feedback via ReputationRegistry.giveFeedback()
  const {
    writeContract,
    data: feedbackTxHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  // Receipt polling disabled — Monad RPC doesn't reliably support it.
  // The txHash alone proves the tx was signed and broadcast.
  useWaitForTransactionReceipt({ hash: feedbackTxHash });

  // Once the tx is signed and broadcast (txHash exists), notify backend.
  // We don't block on receipt confirmation — Monad RPC may not support
  // eth_getTransactionReceipt polling reliably.
  useEffect(() => {
    if (feedbackTxHash && !hasNotifiedBackend.current) {
      hasNotifiedBackend.current = true;
      fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          clientAddress: address,
          value: submittedValue.current,
          tag1: submittedTag.current || undefined,
          txHash: feedbackTxHash,
          onChain: true,
        }),
      }).catch(() => {});
      onSubmitted?.();
    }
  }, [feedbackTxHash, agentId, address, onSubmitted]);

  const handleSubmit = useCallback(() => {
    if (!address || erc8004AgentId == null) return;
    hasNotifiedBackend.current = false;
    reset();

    submittedValue.current = value;
    submittedTag.current = tag1;

    const feedbackHash = (executionProofHash as `0x${string}` | undefined) ?? ZERO_HASH;

    writeContract({
      address: ERC8004_REPUTATION_REGISTRY,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'giveFeedback',
      args: [
        BigInt(erc8004AgentId),
        BigInt(value),
        0,
        tag1 || '',
        '',
        '',
        '',
        feedbackHash,
      ],
      chainId: monadTestnet.id,
    });
  }, [address, erc8004AgentId, value, tag1, executionProofHash, writeContract, reset]);

  const txSubmitted = !!feedbackTxHash;
  const submitting = isPending;
  const feedbackError = writeError
    ? (writeError.message?.includes('User rejected') || writeError.message?.includes('rejected'))
      ? 'Transaction rejected'
      : writeError.message?.includes('reverted')
        ? 'Transaction reverted — the agent may not be registered on the ERC-8004 IdentityRegistry yet'
        : writeError.message?.slice(0, 120) ?? 'Transaction failed'
    : null;

  return (
    <div className="feedback-form">
      <div className="feedback-form-header-row">
        <h3>Submit On-Chain Signal</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {executionProofHash && (
            <span className="x402-verified-badge" style={{ background: 'rgba(var(--success-rgb, 76, 175, 80), 0.12)' }}>
              <ShieldCheck className="w-3.5 h-3.5" />
              proof attached
            </span>
          )}
          <span className="x402-verified-badge">
            <ShieldCheck className="w-3.5 h-3.5" />
            ERC-8004
          </span>
        </div>
      </div>

      <p className="feedback-form-proof">
        {address?.slice(0, 6)}...{address?.slice(-4)}
        {!hasPaymentHistory && <>&middot; no invocation history</>}
      </p>

      {resolving && (
        <div className="feedback-form-row" style={{ justifyContent: 'center', padding: '8px 0' }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: 6 }}>
            Resolving ERC-8004 agent on IdentityRegistry...
          </span>
        </div>
      )}

      {resolveError && (
        <div className="feedback-error">{resolveError}</div>
      )}

      {!resolving && erc8004AgentId != null && (
        <>
          <div className="feedback-form-row">
            <div className="feedback-form-field">
              <label>Trust Score (0-100)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  disabled={submitting}
                />
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: value >= 70 ? 'var(--success)' : value >= 40 ? 'var(--warning)' : 'var(--danger)',
                  minWidth: '30px',
                }}>
                  {value}
                </span>
              </div>
            </div>
            <div className="feedback-form-field">
              <label>Tag (optional)</label>
              <input
                type="text"
                placeholder="e.g. reliability"
                value={tag1}
                onChange={(e) => setTag1(e.target.value)}
                style={{ width: '140px' }}
                disabled={submitting}
              />
            </div>
            {!isOnMonad ? (
              <button
                className="feedback-submit-btn"
                onClick={() => switchChain({ chainId: monadTestnet.id })}
              >
                Switch to Monad
              </button>
            ) : (
              <button
                className="feedback-submit-btn"
                onClick={handleSubmit}
                disabled={submitting}
                style={submitting ? { display: 'inline-flex', alignItems: 'center', gap: 6 } : undefined}
              >
                {isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sign in wallet</>
                ) : txSubmitted ? (
                  <><ShieldCheck className="w-3.5 h-3.5" /> On-chain!</>
                ) : (
                  'Submit Signal'
                )}
              </button>
            )}
          </div>

          {feedbackTxHash && (
            <div style={{ marginTop: 4 }}>
              <a
                href={`https://testnet.monadexplorer.com/tx/${feedbackTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="x402-gate-tx-link"
              >
                {feedbackTxHash.slice(0, 10)}...{feedbackTxHash.slice(-6)} ↗
              </a>
            </div>
          )}

          {txSubmitted && (
            <div className="feedback-success">
              Signal recorded on-chain via ERC-8004 ReputationRegistry
            </div>
          )}
          {feedbackError && <div className="feedback-error">{feedbackError}</div>}
        </>
      )}
    </div>
  );
}

function ConnectWalletPrompt() {
  return (
    <div className="feedback-form" style={{ textAlign: 'center', padding: '20px 16px' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
        Connect wallet to submit an on-chain trust signal
      </p>
    </div>
  );
}

export default function FeedbackForm(props: FeedbackFormProps) {
  const { address, isConnected } = useAccount();

  if (!isConnected || !address) {
    return <ConnectWalletPrompt />;
  }

  return <FeedbackFormInner {...props} />;
}
