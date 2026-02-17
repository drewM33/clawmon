import { useState, useCallback } from 'react';
import { ShieldCheck, Zap, CircleDollarSign, Lock, ExternalLink, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCallerPaymentVerification } from '../hooks/useApi';
import { API_BASE } from '../config/env';
import AuthGate from './AuthGate';

interface FeedbackFormProps {
  agentId: string;
  onSubmitted?: () => void;
}

/* =====================================================================
   x402 Verified Review Gate
   
   Reviews require the connected wallet to have made an x402 payment
   for this specific skill. Payment = on-chain proof of usage.
   ===================================================================== */

function X402ReviewGate({ agentId, caller, onPaymentComplete }: {
  agentId: string;
  caller?: string;
  onPaymentComplete?: () => void;
}) {
  const { data: verification, loading } = useCallerPaymentVerification(agentId, caller);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);

  const isVerified = verification?.verified ?? false;
  const paymentCount = verification?.totalPayments ?? 0;
  const latestReceipt = verification?.receipts?.[0];

  const handlePayForSkill = useCallback(async () => {
    if (!caller || !agentId) return;
    setPaying(true);
    setPayError(null);

    try {
      const res = await fetch(`${API_BASE}/payments/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, caller }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Payment failed (${res.status})`);
      }

      setPaySuccess(true);
      onPaymentComplete?.();
    } catch (err: unknown) {
      setPayError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  }, [caller, agentId, onPaymentComplete]);

  return (
    <div className="x402-review-gate">
      <div className="x402-gate-header">
        <div className="x402-gate-icon-wrap">
          <ShieldCheck className="x402-gate-icon" />
        </div>
        <div>
          <h3 className="x402-gate-title">Verified Reviews Only</h3>
          <p className="x402-gate-subtitle">
            Reviews require x402 payment proof from your wallet — on-chain evidence you used this skill.
          </p>
        </div>
      </div>

      <div className="x402-gate-steps">
        {/* Step 1: Use the skill */}
        <div className={`x402-gate-step ${isVerified || paySuccess ? 'completed' : 'pending'}`}>
          <div className="x402-gate-step-num">
            {isVerified || paySuccess ? <ShieldCheck className="w-3.5 h-3.5" /> : '1'}
          </div>
          <div className="x402-gate-step-content">
            <span className="x402-gate-step-title">Use the skill via x402</span>
            <span className="x402-gate-step-desc">
              {caller
                ? 'Invoke the skill through an x402-enabled client. Your wallet payment is recorded on-chain.'
                : 'Connect your wallet, then invoke the skill through an x402 client.'}
            </span>
            {isVerified && latestReceipt && (
              <span className="x402-gate-step-receipt">
                Last payment: {latestReceipt.amount.toFixed(4)} ETH
                &middot; {new Date(latestReceipt.timestamp).toLocaleDateString()}
              </span>
            )}
          </div>
          {(isVerified || paySuccess) && (
            <span className="x402-gate-step-badge verified">
              <Zap className="w-3 h-3" />
              {paySuccess && !isVerified ? '1 paid' : `${paymentCount} paid`}
            </span>
          )}
        </div>

        {/* Step 2: Leave review */}
        <div className={`x402-gate-step ${isVerified || paySuccess ? 'active' : 'locked'}`}>
          <div className="x402-gate-step-num">
            {isVerified || paySuccess ? '2' : <Lock className="w-3 h-3" />}
          </div>
          <div className="x402-gate-step-content">
            <span className="x402-gate-step-title">Leave a verified review</span>
            <span className="x402-gate-step-desc">
              Your review is linked to your payment tx — sybil-resistant by design.
            </span>
          </div>
        </div>
      </div>

      {/* CTA: Use this skill */}
      {!isVerified && !paySuccess && !loading && (
        <div className="x402-gate-use-skill">
          <div className="x402-gate-cta">
            <CircleDollarSign className="w-4 h-4" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '1px' }} />
            <span>
              {caller
                ? 'No x402 payments found from your wallet for this skill.'
                : 'Connect your wallet to check payment history.'}
            </span>
          </div>

          {caller && (
            <div className="x402-gate-action-row">
              <button
                className="x402-gate-use-btn"
                onClick={handlePayForSkill}
                disabled={paying}
              >
                {paying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 x402-spinner" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    Use this skill
                  </>
                )}
              </button>
              <a
                href="https://www.x402.org"
                target="_blank"
                rel="noopener noreferrer"
                className="x402-gate-docs-link"
              >
                x402 docs
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {payError && (
            <div className="x402-gate-error">{payError}</div>
          )}
        </div>
      )}

      {paySuccess && !isVerified && (
        <div className="x402-gate-success">
          <ShieldCheck className="w-4 h-4" />
          Payment confirmed. Reload to submit your review.
        </div>
      )}

      {loading && (
        <div className="x402-gate-cta" style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            Checking payment history...
          </span>
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   Connected + Verified — Full Feedback Form
   ===================================================================== */

function FeedbackFormInner({ agentId, onSubmitted }: FeedbackFormProps) {
  const { address } = useAuth();
  const { data: verification } = useCallerPaymentVerification(agentId, address);
  const [value, setValue] = useState(75);
  const [tag1, setTag1] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceShowForm, setForceShowForm] = useState(false);

  const isVerified = verification?.verified ?? false;
  const paymentCount = verification?.totalPayments ?? 0;

  const handleSubmit = useCallback(async () => {
    if (!address) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          clientAddress: address,
          value,
          tag1: tag1 || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      setSuccess(true);
      setValue(75);
      setTag1('');
      onSubmitted?.();

      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [address, agentId, value, tag1, onSubmitted]);

  if (!isVerified && !forceShowForm) {
    return (
      <X402ReviewGate
        agentId={agentId}
        caller={address}
        onPaymentComplete={() => setForceShowForm(true)}
      />
    );
  }

  return (
    <div className="feedback-form">
      <div className="feedback-form-header-row">
        <h3>Submit Verified Review</h3>
        <span className="x402-verified-badge">
          <ShieldCheck className="w-3.5 h-3.5" />
          x402 verified
        </span>
      </div>
      <p className="feedback-form-proof">
        {paymentCount || 1} payment{(paymentCount || 1) > 1 ? 's' : ''} from {address?.slice(0, 6)}...{address?.slice(-4)}
        &middot; review linked to on-chain usage
      </p>
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
          />
        </div>
        <button
          className="feedback-submit-btn"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>
      {success && <div className="feedback-success">Verified review submitted successfully</div>}
      {error && <div className="feedback-error">{error}</div>}
    </div>
  );
}

export default function FeedbackForm(props: FeedbackFormProps) {
  return (
    <AuthGate
      fallback={<X402ReviewGate agentId={props.agentId} />}
    >
      <FeedbackFormInner {...props} />
    </AuthGate>
  );
}
