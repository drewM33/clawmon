import { useEffect, useState, useCallback, useRef } from 'react';
import { X, AlertTriangle, Users, Link2, Loader2, ShieldCheck, Coins, Gift } from 'lucide-react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi';
import { useAgentDetail, useAgentStaking } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useTransactionFeed } from '../context/TransactionFeedContext';
import { baseSepolia } from '../config/wagmi';
import {
  USDC_BASE_SEPOLIA_ADDRESS,
  X402_PAY_TO,
  X402_PRICE_USDC,
  ERC20_ABI,
} from '../config/contracts';
import TierBadge from './TierBadge';
import FeedbackForm from './FeedbackForm';
import BoostModal from './BoostModal';

import { API_BASE } from '../config/env';

interface SkillSlideOverProps {
  agentId: string;
  onClose: () => void;
}


interface ExecutionProof {
  proofMessage: string;
  outputHash: string;
  clawmonSignature: string;
  signerAddress: string;
  skillName: string;
  timestamp: number;
}

type PayStatus = 'idle' | 'switching_chain' | 'awaiting_wallet' | 'confirming' | 'verifying' | 'done' | 'error';

/**
 * x402 payment button — follows the Coinbase x402 spec:
 *   1. User's wallet transfers USDC on Base Sepolia to X402_PAY_TO
 *   2. Tx confirms on-chain
 *   3. Server records the payment + generates an execution proof
 *
 * See: https://docs.cdp.coinbase.com/x402/welcome
 */
function PayForSkillButton({ agentId, onProofGenerated }: {
  agentId: string;
  onProofGenerated: (proof: ExecutionProof) => void;
}) {
  const { address } = useAuth();
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { addTransaction, updateTransaction } = useTransactionFeed();

  const [status, setStatus] = useState<PayStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [output, setOutput] = useState<unknown>(null);
  const feedIdRef = useRef<string | null>(null);

  const { writeContract, data: txHash, error: writeError, reset } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const priceDisplay = '$0.001 USDC';

  // Step 1: Transfer USDC on Base Sepolia to ClawMon x402 recipient
  const handlePay = useCallback(() => {
    if (!isConnected || !address) return;
    setErrorMsg(null);
    reset();

    if (chainId !== baseSepolia.id) {
      setStatus('switching_chain');
      switchChain({ chainId: baseSepolia.id });
      return;
    }

    setStatus('awaiting_wallet');
    writeContract({
      address: USDC_BASE_SEPOLIA_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [X402_PAY_TO, X402_PRICE_USDC],
      chainId: baseSepolia.id,
    });
  }, [isConnected, address, chainId, switchChain, writeContract, reset]);

  // Retry after chain switch
  useEffect(() => {
    if (status === 'switching_chain' && chainId === baseSepolia.id) {
      setStatus('awaiting_wallet');
      writeContract({
        address: USDC_BASE_SEPOLIA_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [X402_PAY_TO, X402_PRICE_USDC],
        chainId: baseSepolia.id,
      });
    }
  }, [chainId, status, writeContract]);

  // Step 2: Tx submitted -> add to activity feed
  useEffect(() => {
    if (txHash && (status === 'awaiting_wallet' || status === 'switching_chain')) {
      setStatus('confirming');
      feedIdRef.current = addTransaction({
        type: 'Pay for Skill',
        hash: txHash,
        status: 'pending',
        from: address,
      });
    }
  }, [txHash, status, addTransaction, address]);

  // Step 3: Tx confirmed -> record usage on server + generate execution proof
  useEffect(() => {
    if (!receipt || !txHash || status !== 'confirming') return;

    const verify = async () => {
      setStatus('verifying');

      if (feedIdRef.current) {
        updateTransaction(feedIdRef.current, { status: 'confirmed' });
      }

      try {
        // Record the x402 USDC payment with the server
        const useRes = await fetch(`${API_BASE}/skills/use/${encodeURIComponent(agentId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'PAYMENT-SIGNATURE': txHash,
          },
          body: JSON.stringify({ caller: address }),
        });
        const useData = await useRes.json();
        if (!useRes.ok) {
          throw new Error(useData.error || 'Failed to record payment');
        }

        // Generate execution proof
        const proveRes = await fetch(`${API_BASE}/skills/prove/${encodeURIComponent(agentId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller: address, paymentTxHash: txHash }),
        });
        const proveData = await proveRes.json();
        if (!proveRes.ok) {
          throw new Error(proveData.error || 'Execution proof generation failed');
        }

        setOutput(proveData.output);
        setStatus('done');
        if (proveData.executionReceipt) {
          onProofGenerated(proveData.executionReceipt);
        }
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
        setStatus('error');
      }
    };

    verify();
  }, [receipt, txHash, status, agentId, address, updateTransaction, onProofGenerated]);

  // Handle write errors
  useEffect(() => {
    if (writeError && (status === 'awaiting_wallet' || status === 'switching_chain')) {
      const raw = writeError.message || '';
      let msg: string;
      if (raw.includes('User rejected') || raw.includes('user rejected')) {
        msg = 'Transaction rejected';
      } else if (raw.includes('insufficient') || raw.includes('exceeds balance')) {
        msg = 'Insufficient USDC balance on Base Sepolia';
      } else {
        msg = raw.slice(0, 120) || 'Transaction failed';
      }
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [writeError, status]);

  const statusText = (() => {
    switch (status) {
      case 'idle': return `Invoke skill — ${priceDisplay}`;
      case 'switching_chain': return 'Switching to Base Sepolia...';
      case 'awaiting_wallet': return 'Confirm USDC transfer...';
      case 'confirming': return 'Confirming on Base Sepolia...';
      case 'verifying': return 'Generating execution proof...';
      case 'done': return 'Execution proof generated';
      case 'error': return 'Payment failed — retry';
      default: return `Invoke — ${priceDisplay}`;
    }
  })();

  const isLoading = status === 'switching_chain' || status === 'awaiting_wallet' || status === 'confirming' || status === 'verifying';

  return (
    <div className="x402-protocol-link-wrap">
      <button
        className="x402-protocol-link"
        onClick={status === 'done' || status === 'error' ? () => { setStatus('idle'); setErrorMsg(null); reset(); } : handlePay}
        disabled={isLoading || !isConnected}
      >
        <span className="x402-protocol-badge">x402</span>
        <span className="x402-protocol-text">{statusText}</span>
        {isLoading ? (
          <Loader2 className="x402-protocol-arrow animate-spin" />
        ) : status === 'done' ? (
          <ShieldCheck className="x402-protocol-arrow" style={{ color: 'var(--success)' }} />
        ) : (
          <Coins className="x402-protocol-arrow" />
        )}
      </button>

      {txHash && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '6px', fontFamily: "'JetBrains Mono', monospace" }}>
          tx:{' '}
          <a
            href={`https://sepolia.basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            {txHash.slice(0, 10)}...{txHash.slice(-8)}
          </a>
        </div>
      )}

      {status === 'done' && output !== null && (
        <pre className="x402-protocol-result">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}

      {status === 'error' && errorMsg && (
        <div className="x402-protocol-error">
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}

export default function SkillSlideOver({ agentId, onClose }: SkillSlideOverProps) {
  const { data: agent, loading, error } = useAgentDetail(agentId);
  const { data: staking, refetch: refetchStaking } = useAgentStaking(agentId);

  const [executionProof, setExecutionProof] = useState<ExecutionProof | null>(null);
  const [showBoostModal, setShowBoostModal] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (loading) {
    return (
      <>
        <div className="slideover-backdrop" onClick={onClose} />
        <div className="slideover-panel" role="dialog" aria-modal="true" aria-label="Skill details loading">
          <div className="slideover-header">
            <span />
            <button className="slideover-close" onClick={onClose} aria-label="Close panel">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="loading" style={{ height: '200px' }}>Loading...</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <>
        <div className="slideover-backdrop" onClick={onClose} />
        <div className="slideover-panel" role="dialog" aria-modal="true" aria-label="Skill details error">
          <div className="slideover-header">
            <span />
            <button className="slideover-close" onClick={onClose} aria-label="Close panel">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="error" style={{ height: '200px' }}>{error || 'Agent not found'}</div>
        </div>
      </>
    );
  }



  const sortedFb = [...agent.feedback]
    .filter(f => !f.revoked)
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <>
      <div className="slideover-backdrop" onClick={onClose} />
      <div className="slideover-panel" role="dialog" aria-modal="true" aria-label={`${agent.name} details`}>
        <div className="slideover-header">
          <div className="slideover-title-group">
            <h2>{agent.name}</h2>
            <TierBadge tier={agent.hardenedTier} size="lg" />
            {agent.flagged && (
              <span className="flag-badge malicious large">
                <AlertTriangle className="w-3 h-3" style={{ marginRight: 2 }} />
                MALICIOUS
              </span>
            )}
            {agent.isSybil && (
              <span className="flag-badge sybil large">
                <Users className="w-3 h-3" style={{ marginRight: 2 }} />
                SYBIL
              </span>
            )}
          </div>
          <button className="slideover-close" onClick={onClose} aria-label="Close panel">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="slideover-body">
          <div className="slideover-meta">
            <span className="detail-publisher">by {agent.publisher} &middot; {agent.category}</span>
            <p className="detail-description">{agent.description}</p>
            <p className="detail-auth">
              Signal policy: <span className="auth-open">{agent.feedbackAuthPolicy}</span>
            </p>
            <PayForSkillButton agentId={agent.agentId} onProofGenerated={setExecutionProof} />
          </div>

          {/* On-chain ERC-8004 review */}
          {agent.feedbackAuthPolicy === 'open' && (
            <FeedbackForm
              agentId={agent.agentId}
              executionProofHash={executionProof?.proofMessage}
            />
          )}

          {/* Staking Info */}
          <div className="slideover-section">
            <div className="slideover-section-header-row">
              <h3>Collateral &amp; Boost Status</h3>
              <button
                className="boost-gift-inline-btn"
                onClick={() => setShowBoostModal(true)}
                aria-label="Boost this skill"
              >
                <Gift className="w-3.5 h-3.5" />
                Boost
              </button>
            </div>
            <div className="boost-detail-card">
              <div className="boost-detail-header">
                <span className={`skill-card-badge boost level-${Math.max(0, Math.min(3, staking?.boost?.trustLevel ?? 0))}`}>
                  Boost L{staking?.boost?.trustLevel ?? 0}
                </span>
                {staking?.boost?.exists && (
                  <span className="meta-label">
                    {staking.boost.skillId ? 'ClawHub linked' : 'On-chain bond'}
                  </span>
                )}
              </div>
              {staking?.boost?.exists ? (
                <>
                  <div className="staking-detail-grid" style={{ marginTop: '10px' }}>
                    <div className="staking-detail-item">
                      <span className="meta-label">Boost Units</span>
                      <span className="meta-value">{staking.boost.boostUnits}</span>
                    </div>
                    <div className="staking-detail-item">
                      <span className="meta-label">Total Staked</span>
                      <span className="meta-value">{staking.boost.totalStakeMon.toFixed(4)} MON</span>
                    </div>
                    {staking.boost.riskTier && (
                      <div className="staking-detail-item">
                        <span className="meta-label">Risk Tier</span>
                        <span className="meta-value">{staking.boost.riskTier}</span>
                      </div>
                    )}
                    {staking.boost.skillId && (
                      <div className="staking-detail-item">
                        <span className="meta-label">Skill ID</span>
                        <span className="meta-value">{staking.boost.skillId}</span>
                      </div>
                    )}
                  </div>
                  {staking.boost.lastSlash && (
                    <div className="slash-card" style={{ marginTop: '12px' }}>
                      <h4 style={{ fontSize: '0.7rem', color: 'var(--danger)', marginBottom: '6px', textTransform: 'uppercase' }}>Last Slash</h4>
                      <div className="slash-card-header">
                        <span>Severity {staking.boost.lastSlash.severityBps / 100}%</span>
                        <span className="slash-amount">-{staking.boost.lastSlash.amountMon.toFixed(4)} MON</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {staking.boost.lastSlash.evidenceURI && <span>{staking.boost.lastSlash.evidenceURI}</span>}
                        {staking.boost.lastSlash.txHash && (
                          <a href={`https://testnet.monadexplorer.com/tx/${staking.boost.lastSlash.txHash}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '8px', color: 'var(--accent)' }}>
                            View TX
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="no-data" style={{ marginTop: '10px' }}>
                  No collateral posted. Boost this skill to add a stake-backed trust signal.
                </p>
              )}
            </div>
          </div>

          {/* Recent Feedback */}
          <div className="slideover-section">
            <h3>Recent Signals</h3>
            <div className="feedback-list">
              {sortedFb.slice(-10).reverse().map(fb => (
                <div key={fb.id} className="feedback-item">
                  <span className={`fb-value ${fb.value >= 70 ? 'positive' : fb.value >= 40 ? 'neutral' : 'negative'}`}>
                    {fb.value}
                  </span>
                  <span className="fb-address">{fb.clientAddress}</span>
                  <span className="fb-time">{new Date(fb.timestamp).toLocaleDateString()}</span>
                </div>
              ))}
              {sortedFb.length === 0 && <p className="no-data">No signals recorded</p>}
            </div>
          </div>

        </div>

        {showBoostModal && (
          <BoostModal
            agentId={agent.agentId}
            agentName={agent.name}
            currentTrustLevel={staking?.boost?.trustLevel ?? 0}
            currentBoostUnits={staking?.boost?.boostUnits ?? 0}
            agent={agent}
            boost={staking?.boost}
            onClose={() => setShowBoostModal(false)}
            onBoostComplete={() => {
              setShowBoostModal(false);
              refetchStaking();
              setTimeout(refetchStaking, 3000);
            }}
          />
        )}
      </div>
    </>
  );
}
