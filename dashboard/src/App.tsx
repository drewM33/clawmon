import { Routes, Route, NavLink } from 'react-router-dom';
import { Globe, Radar, BookOpen } from 'lucide-react';
import LandingPage from './components/LandingPage';
import LandingPageV2 from './components/LandingPageV2';
import SkillsPage from './components/SkillsPage';
import NetworkGraph from './components/viz/NetworkGraph';
import LiveFeedIndicator from './components/LiveFeedIndicator';
import ConnectWallet from './components/ConnectWallet';
import OnChainActivityFeed from './components/OnChainActivityFeed';
import { useWebSocket } from './hooks/useWebSocket';

export default function App() {
  const { isConnected } = useWebSocket();

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <NavLink to="/" className="logo-link">
            <h1 className="logo">
              <img src="/clawmon-mascot.png" alt="ClawMon" className="logo-mascot" />
              ClawMon
            </h1>
          </NavLink>
        </div>
        <nav className="header-nav">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <Globe className="nav-link-icon" />
            Overview
          </NavLink>
          <NavLink to="/skills" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <Radar className="nav-link-icon" />
            Skills
          </NavLink>
          <NavLink to="/network" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <Radar className="nav-link-icon" />
            Network
          </NavLink>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="nav-link">
            <BookOpen className="nav-link-icon" />
            Docs
          </a>
        </nav>
        <div className="header-right">
          <LiveFeedIndicator connected={isConnected} />
          <ConnectWallet />
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/v2" element={<LandingPageV2 />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/network" element={<NetworkGraph />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <span className="footer-brand">ClawMon</span>
          <span className="footer-sep">&middot;</span>
          <span>ERC-8004 + Monad</span>
          <span className="footer-sep">&middot;</span>
          <span>ETHDenver 2026</span>
        </div>
      </footer>

      <OnChainActivityFeed />
    </div>
  );
}
