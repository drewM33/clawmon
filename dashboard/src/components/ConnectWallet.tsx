import { useState, useRef, useEffect } from 'react';
import { useConnect, useAccount } from 'wagmi';
import { useAuth } from '../context/AuthContext';

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { identity, isLoadingIdentity, disconnect } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setShowConnectors(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Connected state
  if (isConnected && address) {
    return (
      <div className="wallet-container" ref={dropdownRef}>
        <button
          className="wallet-btn connected"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          <span className="wallet-dot connected" />
          <span className="wallet-address">{truncateAddress(address)}</span>
          {isLoadingIdentity && <span className="wallet-loading" />}
        </button>

        {showDropdown && (
          <div className="wallet-dropdown">
            <div className="wallet-dropdown-header">
              <span className="wallet-dropdown-label">Connected Wallet</span>
              <span className="wallet-dropdown-address">{truncateAddress(address)}</span>
            </div>
            {identity && (
              <div className="wallet-dropdown-identity">
                <span className="wallet-dropdown-label">On-Chain Identity</span>
                <span className="wallet-dropdown-value">{identity.name}</span>
                <span className="wallet-dropdown-agent-id">{identity.agentId}</span>
              </div>
            )}
            <button
              className="wallet-disconnect-btn"
              onClick={() => {
                disconnect();
                setShowDropdown(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // Disconnected state
  return (
    <div className="wallet-container" ref={dropdownRef}>
      <button
        className="wallet-btn"
        onClick={() => setShowConnectors(!showConnectors)}
        disabled={isPending}
      >
        <span className="wallet-dot" />
        {isPending ? 'Connecting...' : 'Connect Wallet'}
      </button>

      {showConnectors && (
        <div className="wallet-dropdown">
          <div className="wallet-dropdown-header">
            <span className="wallet-dropdown-label">Choose Wallet</span>
          </div>
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              className="wallet-connector-btn"
              onClick={() => {
                connect({ connector });
                setShowConnectors(false);
              }}
            >
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
