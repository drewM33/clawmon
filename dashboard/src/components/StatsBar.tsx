import { useCallback } from 'react';
import { useStats } from '../hooks/useApi';
import { useWSEvent } from '../hooks/useWebSocket';
import type { WSStatsUpdate } from '../types';

export default function StatsBar() {
  const { data: stats, loading, setData: setStats } = useStats();

  // Live-update stats via WebSocket
  useWSEvent('stats:updated', useCallback((event) => {
    const update: WSStatsUpdate = event.payload;
    setStats((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        totalAgents: update.totalAgents,
        totalFeedback: update.totalFeedback,
        uniqueReviewers: update.uniqueReviewers,
        sybilClustersDetected: update.sybilClustersDetected,
      };
    });
  }, [setStats]));

  if (loading || !stats) return null;

  return (
    <div className="stats-bar">
      <div className="stat-group">
        <span className="stat-label">ERC-8004 REGISTRY</span>
        <span className="stat-value danger">{stats.erc8004.totalRegistered.toLocaleString()}</span>
        <span className="stat-detail">registered</span>
        <span className="stat-sep">|</span>
        <span className="stat-value success">~{stats.erc8004.estimatedLegit}</span>
        <span className="stat-detail">legit</span>
        <span className="stat-sep">|</span>
        <span className="stat-value danger">{stats.erc8004.noiseRatio}%</span>
        <span className="stat-detail">noise</span>
      </div>
      <div className="stat-group">
        <span className="stat-label">TRUSTED CLAWBAR</span>
        <span className="stat-value">{stats.totalAgents}</span>
        <span className="stat-detail">open-auth agents</span>
        <span className="stat-sep">|</span>
        <span className="stat-value">{stats.totalFeedback}</span>
        <span className="stat-detail">feedback entries</span>
        <span className="stat-sep">|</span>
        <span className="stat-value warning">{stats.sybilClustersDetected}</span>
        <span className="stat-detail">sybil clusters</span>
      </div>
    </div>
  );
}
