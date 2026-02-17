import { useState } from 'react';
import StakingPanel from './StakingPanel';
import AttestationPanel from './AttestationPanel';
import InsurancePanel from './InsurancePanel';
import TEEPanel from './TEEPanel';
import PaywallPanel from './PaywallPanel';
import GovernancePanel from './GovernancePanel';

type ProtocolTab = 'staking' | 'attestations' | 'tee' | 'insurance' | 'payments' | 'governance';

const TABS: { key: ProtocolTab; label: string; desc: string }[] = [
  { key: 'staking', label: 'Staking', desc: 'Economic trust via collateral' },
  { key: 'attestations', label: 'Attestations', desc: 'Cross-chain score bridging' },
  { key: 'tee', label: 'TEE', desc: 'Hardware-verified execution' },
  { key: 'insurance', label: 'Insurance', desc: 'Slash fund redistribution' },
  { key: 'payments', label: 'x402 Payments', desc: 'Micropayment revenue' },
  { key: 'governance', label: 'Governance', desc: 'On-chain parameter voting' },
];

export default function ProtocolDetails() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ProtocolTab>('staking');

  return (
    <section className="protocol-details">
      <button
        className="protocol-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="protocol-toggle-left">
          <span className={`protocol-chevron ${isOpen ? 'open' : ''}`}>&#9662;</span>
          <div>
            <span className="protocol-toggle-title">Protocol Details</span>
            <span className="protocol-toggle-subtitle">
              Staking, Attestations, TEE, Insurance, Governance &amp; x402
            </span>
          </div>
        </div>
        <span className="protocol-toggle-hint">
          {isOpen ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {isOpen && (
        <div className="protocol-content">
          <div className="protocol-tabs">
            {TABS.map(tab => (
              <button
                key={tab.key}
                className={`protocol-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
                title={tab.desc}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="protocol-panel">
            {activeTab === 'staking' && <StakingPanel />}
            {activeTab === 'attestations' && <AttestationPanel />}
            {activeTab === 'tee' && <TEEPanel />}
            {activeTab === 'insurance' && <InsurancePanel />}
            {activeTab === 'payments' && <PaywallPanel />}
            {activeTab === 'governance' && <GovernancePanel />}
          </div>
        </div>
      )}
    </section>
  );
}
