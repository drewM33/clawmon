import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Zap, Rocket, Crown, Shield, TrendingUp, Eye, Cpu, Lock, AlertTriangle, Gift } from 'lucide-react';
import { isMaliciousSkill, isFeaturedSkill, MALICIOUS_BOOST_WARNINGS, FEATURED_BOOST_PERKS } from '../utils/boostLogic';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSwitchChain,
} from 'wagmi';
import { parseEther, keccak256, toBytes } from 'viem';
import { monadTestnet } from '../config/wagmi';
import {
  TRUST_STAKING_ADDRESS,
  TRUST_STAKING_ABI,
} from '../config/contracts';
import { useTransactionFeed, type TxActivityType } from '../context/TransactionFeedContext';

type BoostPlan = 'elite' | 'standard' | null;
type BoostStep = 'select' | 'confirm' | 'processing' | 'success';

interface BoostModalProps {
  agentId: string;
  agentName: string;
  currentTrustLevel: number;
  currentBoostUnits: number;
  agent?: { flagged: boolean; isSybil: boolean; hardenedTier: string; hardenedScore: number; feedbackCount: number } | null;
  boost?: { riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | null } | null;
  onClose: () => void;
  onBoostComplete: () => void;
}

const ELITE_AMOUNT = '2.0';
const STANDARD_AMOUNT = '0.5';

export default function BoostModal({
  agentId,
  agentName,
  currentTrustLevel,
  currentBoostUnits,
  agent,
  boost,
  onClose,
  onBoostComplete,
}: BoostModalProps) {
  const malicious = agent ? isMaliciousSkill(agent, boost) : false;
  const featured = agent ? isFeaturedSkill(agent) : false;
  const [selectedPlan, setSelectedPlan] = useState<BoostPlan>(null);
  const [step, setStep] = useState<BoostStep>('select');

  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { addTransaction } = useTransactionFeed();

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
    chainId: monadTestnet.id,
    pollingInterval: 1_500,
    confirmations: 1,
  });

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

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

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
    if (isConfirmed && step === 'processing') {
      setStep('success');
      onBoostComplete();
    }
  }, [isConfirmed, step, onBoostComplete]);

  const [pendingBoostAfterSwitch, setPendingBoostAfterSwitch] = useState(false);

  const executeBoost = useCallback(() => {
    if (!selectedPlan || !address) return;

    const amount = selectedPlan === 'elite' ? ELITE_AMOUNT : STANDARD_AMOUNT;
    const functionName = onChainActive ? 'delegate' : 'stakeAgent';

    setStep('processing');
    feedIdRef.current = null;
    pendingTypeRef.current = 'Stake';

    writeContract({
      address: TRUST_STAKING_ADDRESS,
      abi: TRUST_STAKING_ABI,
      functionName,
      args: [agentIdHash],
      value: parseEther(amount),
      chainId: monadTestnet.id,
    });
  }, [selectedPlan, address, writeContract, agentIdHash, onChainActive]);

  const handleBoost = useCallback(() => {
    if (!selectedPlan || !isConnected || !address) return;

    if (chainId !== monadTestnet.id) {
      setPendingBoostAfterSwitch(true);
      switchChain({ chainId: monadTestnet.id });
      return;
    }

    executeBoost();
  }, [selectedPlan, isConnected, address, chainId, switchChain, executeBoost]);

  useEffect(() => {
    if (pendingBoostAfterSwitch && chainId === monadTestnet.id) {
      setPendingBoostAfterSwitch(false);
      executeBoost();
    }
  }, [chainId, pendingBoostAfterSwitch, executeBoost]);

  const isWrongChain = chainId !== monadTestnet.id;

  const nextLevelUnits = currentTrustLevel === 0 ? 2
    : currentTrustLevel === 1 ? 7
    : currentTrustLevel === 2 ? 14
    : 14;

  const unitsToNext = Math.max(0, nextLevelUnits - currentBoostUnits);

  return (
    <>
      <div className="boost-modal-backdrop" onClick={onClose} />
      <div className="boost-modal" role="dialog" aria-modal="true" aria-label="Boost this skill">
        <div className="boost-modal-header">
          <h2 className="boost-modal-title">Boost This Skill</h2>
          <button className="boost-modal-close" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'select' && (
          <div className="boost-modal-body">
            <p className="boost-modal-subtitle">
              Back <strong>{agentName}</strong> with economic capital.
              Higher trust = priority execution, better revenue splits, and verified routing.
            </p>

            {malicious && (
              <div className="boost-malicious-warning">
                <AlertTriangle className="boost-malicious-icon" />
                <div>
                  <strong>Risky skill</strong>
                  <p>Boosting flagged or high-risk skills puts your stake at risk. If confirmed malicious, your delegated stake can be slashed.</p>
                  <ul>
                    {MALICIOUS_BOOST_WARNINGS.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {featured && !malicious && (
              <div className="boost-featured-perks">
                <Gift className="boost-featured-icon" />
                <div>
                  <strong>Featured skill</strong>
                  <p>Boost this skill to unlock curator perks:</p>
                  <ul>
                    {FEATURED_BOOST_PERKS.map((p) => (
                      <li key={p.id}>{p.label}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {currentTrustLevel < 3 && (
              <div className="boost-progress-banner">
                <span className="boost-progress-label">
                  Current: Level {currentTrustLevel}
                </span>
                <div className="boost-progress-track">
                  <div
                    className="boost-progress-fill"
                    style={{
                      width: `${Math.min(100, (currentBoostUnits / nextLevelUnits) * 100)}%`,
                    }}
                  />
                </div>
                <span className="boost-progress-hint">
                  {unitsToNext} more boost{unitsToNext !== 1 ? 's' : ''} to Level {Math.min(3, currentTrustLevel + 1)}
                </span>
              </div>
            )}

            <div className="boost-plans">
              {/* Elite Plan */}
              <div
                className={`boost-plan elite${selectedPlan === 'elite' ? ' selected' : ''}`}
                onClick={() => setSelectedPlan('elite')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPlan('elite'); } }}
              >
                <div className="boost-plan-popular">POPULAR</div>
                <div className="boost-plan-header">
                  <div className="boost-plan-name-row">
                    <Crown className="boost-plan-icon elite-icon" />
                    <span className="boost-plan-name">TRUST BOOST</span>
                  </div>
                  <div className="boost-plan-price">
                    <span className="boost-plan-amount">2.0</span>
                    <span className="boost-plan-unit"> MON</span>
                  </div>
                  <span className="boost-plan-period">one-time stake</span>
                </div>
                <div className="boost-plan-divider" />
                <ul className="boost-plan-perks">
                  <li>
                    <Rocket className="perk-icon" />
                    <span>Priority execution queue</span>
                  </li>
                  <li>
                    <TrendingUp className="perk-icon" />
                    <span>90% revenue share on calls</span>
                  </li>
                  <li>
                    <Eye className="perk-icon" />
                    <span>Preferred agent routing</span>
                  </li>
                  <li>
                    <Cpu className="perk-icon" />
                    <span>Extended context &amp; memory</span>
                  </li>
                  <li>
                    <Shield className="perk-icon" />
                    <span>Certified trust signal</span>
                  </li>
                  <li>
                    <Lock className="perk-icon" />
                    <span>Credentialed API access</span>
                  </li>
                </ul>
              </div>

              {/* Standard Plan */}
              <div
                className={`boost-plan standard${selectedPlan === 'standard' ? ' selected' : ''}`}
                onClick={() => setSelectedPlan('standard')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPlan('standard'); } }}
              >
                <div className="boost-plan-header">
                  <div className="boost-plan-name-row">
                    <Zap className="boost-plan-icon standard-icon" />
                    <span className="boost-plan-name">TRUST BASIC</span>
                  </div>
                  <div className="boost-plan-price">
                    <span className="boost-plan-amount">0.5</span>
                    <span className="boost-plan-unit"> MON</span>
                  </div>
                  <span className="boost-plan-period">one-time stake</span>
                </div>
                <div className="boost-plan-divider" />
                <ul className="boost-plan-perks">
                  <li>
                    <TrendingUp className="perk-icon" />
                    <span>75% revenue share on calls</span>
                  </li>
                  <li>
                    <Eye className="perk-icon" />
                    <span>Discovery ranking boost</span>
                  </li>
                  <li>
                    <Shield className="perk-icon" />
                    <span>Staked trust signal</span>
                  </li>
                  <li>
                    <Cpu className="perk-icon" />
                    <span>Higher call throughput</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="boost-modal-actions">
              {!isConnected ? (
                <div className="boost-connect-prompt">
                  Connect your wallet to boost this skill.
                </div>
              ) : isWrongChain ? (
                <button
                  className="boost-action-btn switch-chain"
                  onClick={() => switchChain({ chainId: monadTestnet.id })}
                >
                  Switch to Monad Testnet
                </button>
              ) : (
                <button
                  className="boost-action-btn primary"
                  disabled={!selectedPlan}
                  onClick={() => setStep('confirm')}
                >
                  {selectedPlan ? `Select ${selectedPlan === 'elite' ? 'Trust Boost' : 'Trust Basic'}` : 'Choose a plan'}
                </button>
              )}
            </div>

            <p className="boost-modal-footnote">
              Staked MON is refundable after 7-day cooldown unless slashed.
              Trust is capital-backed — making malicious behavior economically irrational.
            </p>
          </div>
        )}

        {step === 'confirm' && selectedPlan && (
          <div className="boost-modal-body">
            <div className="boost-confirm-card">
              <div className="boost-confirm-icon">
                {selectedPlan === 'elite' ? <Crown /> : <Zap />}
              </div>
              <h3 className="boost-confirm-title">
                Confirm {selectedPlan === 'elite' ? 'Trust Boost' : 'Trust Basic'}
              </h3>
              <p className="boost-confirm-detail">
                You are about to stake <strong>{selectedPlan === 'elite' ? ELITE_AMOUNT : STANDARD_AMOUNT} MON</strong> to
                boost <strong>{agentName}</strong>.
              </p>
              <div className="boost-confirm-warning">
                <Shield className="w-3.5 h-3.5" />
                <span>
                  Your stake can be slashed if this skill violates policy.
                  7-day cooldown before withdrawal.
                </span>
              </div>
            </div>
            <div className="boost-modal-actions">
              <button className="boost-action-btn secondary" onClick={() => setStep('select')}>
                Back
              </button>
              <button className="boost-action-btn primary" onClick={handleBoost}>
                Stake &amp; Boost
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="boost-modal-body">
            <div className="boost-processing">
              {!writeError && !receiptError && (
                <div className="boost-processing-spinner" />
              )}
              <h3 className="boost-processing-title">
                {isPending ? 'Confirm in your wallet...' :
                 isConfirming ? 'Transaction confirming...' :
                 writeError ? 'Transaction failed' :
                 receiptError ? 'Transaction submitted' :
                 'Processing...'}
              </h3>
              {txHash && (
                <>
                  <a
                    className="boost-processing-tx"
                    href={`https://testnet.monadexplorer.com/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {txHash.slice(0, 10)}...{txHash.slice(-6)}
                  </a>
                  {isConfirming && (
                    <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Transaction succeeded?{' '}
                      <button
                        type="button"
                        className="boost-action-btn secondary"
                        style={{ display: 'inline-block', padding: '4px 12px', marginTop: 8 }}
                        onClick={() => { setStep('success'); onBoostComplete(); }}
                      >
                        Done
                      </button>
                    </p>
                  )}
                </>
              )}
              {writeError && (
                <div className="boost-processing-error">
                  {(() => {
                    const msg = (writeError as Error).message ?? '';
                    if (msg.includes('rejected')) return 'Transaction rejected';
                    if (msg.includes('Agent not active')) return 'Agent not active — try again to auto-stake.';
                    if (msg.includes('Already staked')) return 'Already staked — retrying as delegation.';
                    if (msg.includes('Below minimum')) return 'Amount below minimum (0.01 MON).';
                    if (msg.includes('insufficient') || msg.includes('exceeds balance')) return 'Insufficient MON balance.';
                    return msg.slice(0, 120) || 'Failed';
                  })()}
                </div>
              )}
              {writeError && (
                <button
                  className="boost-action-btn secondary"
                  onClick={() => { reset(); setStep('select'); }}
                >
                  Try Again
                </button>
              )}
              {receiptError && (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Confirmation polling timed out, but the transaction may have succeeded. Check the explorer link above.
                  </p>
                  <button
                    className="boost-action-btn primary"
                    onClick={() => { setStep('success'); setTimeout(onBoostComplete, 2000); }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="boost-modal-body">
            <div className="boost-success">
              <div className="boost-success-glow" />
              <Zap className="boost-success-icon" />
              <h3 className="boost-success-title">Boost Confirmed!</h3>
              <p className="boost-success-detail">
                <strong>{agentName}</strong> is now capital-backed.
                Trust level and routing priority updating.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
