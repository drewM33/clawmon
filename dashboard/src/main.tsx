import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './config/wagmi';
import { AuthProvider } from './context/AuthContext';
import { TransactionFeedProvider } from './context/TransactionFeedContext';
import App from './App';
import './styles/tokens.css';
import './App.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TransactionFeedProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </TransactionFeedProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
