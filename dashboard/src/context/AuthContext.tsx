import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { API_BASE } from '../config/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnChainIdentity {
  agentId: string;
  name: string;
  publisher: string;
  category: string;
  description?: string;
  feedbackAuthPolicy: string;
  timestamp: number;
}

interface AuthState {
  /** The connected wallet address (checksummed) */
  address: string | undefined;
  /** Whether the wallet is connected */
  isConnected: boolean;
  /** The user's on-chain identity (if any) */
  identity: OnChainIdentity | null;
  /** Whether we're currently loading the identity */
  isLoadingIdentity: boolean;
  /** Disconnect the wallet */
  disconnect: () => void;
  /** Whether auth is fully ready (connected + identity loaded) */
  isAuthenticated: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthState>({
  address: undefined,
  isConnected: false,
  identity: null,
  isLoadingIdentity: false,
  disconnect: () => {},
  isAuthenticated: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------

const SESSION_KEY = 'clawmon_wallet_session';

function persistSession(address: string) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ address, ts: Date.now() }));
  } catch {
    // localStorage unavailable
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // localStorage unavailable
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const [identity, setIdentity] = useState<OnChainIdentity | null>(null);
  const [isLoadingIdentity, setIsLoadingIdentity] = useState(false);

  // Look up or auto-create on-chain identity when wallet connects
  const ensureIdentity = useCallback(async (walletAddress: string) => {
    setIsLoadingIdentity(true);
    try {
      // Step 1: Check if identity exists
      const lookupRes = await fetch(`${API_BASE}/identity/${walletAddress}`);
      if (!lookupRes.ok) throw new Error('Identity lookup failed');
      const lookupData = await lookupRes.json();

      if (lookupData.found) {
        setIdentity(lookupData.identity);
        persistSession(walletAddress);
        return;
      }

      // Step 2: Auto-register if not found
      const registerRes = await fetch(`${API_BASE}/identity/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress }),
      });

      if (!registerRes.ok) throw new Error('Identity registration failed');
      const registerData = await registerRes.json();
      setIdentity(registerData.identity);
      persistSession(walletAddress);
    } catch (err) {
      console.error('Failed to ensure on-chain identity:', err);
      setIdentity(null);
    } finally {
      setIsLoadingIdentity(false);
    }
  }, []);

  // When wallet connects, fetch/create identity
  useEffect(() => {
    if (isConnected && address) {
      ensureIdentity(address);
    } else {
      setIdentity(null);
    }
  }, [isConnected, address, ensureIdentity]);

  const disconnect = useCallback(() => {
    wagmiDisconnect();
    setIdentity(null);
    clearSession();
  }, [wagmiDisconnect]);

  const isAuthenticated = isConnected && identity !== null;

  return (
    <AuthContext.Provider
      value={{
        address,
        isConnected,
        identity,
        isLoadingIdentity,
        disconnect,
        isAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
