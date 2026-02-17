import { type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

interface AuthGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

const defaultFallback = (
  <div className="auth-gate-notice">
    <div className="auth-gate-icon">&#9919;</div>
    <h3>Wallet Connection Required</h3>
    <p>Connect your wallet to access this feature. Your wallet address will be used as your identity on the trust registry.</p>
  </div>
);

export default function AuthGate({ children, fallback = defaultFallback }: AuthGateProps) {
  const { isAuthenticated, isLoadingIdentity } = useAuth();

  if (isLoadingIdentity) {
    return (
      <div className="auth-gate-notice">
        <div className="auth-gate-loading">Verifying identity...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
