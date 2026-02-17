import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config/env';
import AuthGate from './AuthGate';

interface RegisterSkillFormProps {
  onRegistered?: () => void;
}

function RegisterSkillFormInner({ onRegistered }: RegisterSkillFormProps) {
  const { address } = useAuth();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('utility');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!address || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`${API_BASE}/skills/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().toLowerCase().replace(/\s+/g, '-'),
          publisher: address,
          category,
          description: description.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to register skill');
      }

      setSuccess(true);
      setName('');
      setDescription('');
      onRegistered?.();

      setTimeout(() => setSuccess(false), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }, [address, name, category, description, onRegistered]);

  const categories = [
    'utility', 'developer', 'ai', 'communication', 'database',
    'cloud', 'finance', 'productivity', 'devops', 'monitoring',
    'infrastructure', 'design', 'research', 'security', 'misc',
  ];

  return (
    <div className="feedback-form" style={{ marginBottom: '20px' }}>
      <h3>Register New Skill</h3>
      <div className="feedback-form-row" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="feedback-form-field">
          <label>Skill Name</label>
          <input
            type="text"
            placeholder="my-awesome-skill"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '200px' }}
          />
        </div>
        <div className="feedback-form-field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="feedback-form-field" style={{ flex: 1, minWidth: '200px' }}>
          <label>Description (optional)</label>
          <input
            type="text"
            placeholder="What does your skill do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <button
          className="feedback-submit-btn"
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Registering...' : 'Register Skill'}
        </button>
      </div>
      {success && <div className="feedback-success">Skill registered successfully on-chain</div>}
      {error && <div className="feedback-error">{error}</div>}
    </div>
  );
}

export default function RegisterSkillForm(props: RegisterSkillFormProps) {
  return (
    <AuthGate
      fallback={
        <div className="auth-gate-notice" style={{ margin: '0 0 20px 0', padding: '24px' }}>
          <div className="auth-gate-icon">&#9919;</div>
          <h3>Connect Wallet to Register Skills</h3>
          <p>You need to connect your wallet to register new skills on the trust registry.</p>
        </div>
      }
    >
      <RegisterSkillFormInner {...props} />
    </AuthGate>
  );
}
