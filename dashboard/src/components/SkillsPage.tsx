import { useState, useMemo, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useLeaderboard, useStats, useStakingStats } from '../hooks/useApi';
import { useWSEvent } from '../hooks/useWebSocket';
import SkillCard from './SkillCard';
import SkillSlideOver from './SkillSlideOver';
import RegisterSkillForm from './RegisterSkillForm';
import ProtocolDetails from './ProtocolDetails';
import type { TrustTier, WSScoreUpdate } from '../types';

const CATEGORY_FILTERS = [
  'All', 'Developer', 'Database', 'DevOps', 'Communication',
  'Monitoring', 'AI', 'Finance', 'Cloud', 'Infrastructure',
];

export default function SkillsPage() {
  const { data: agents, loading, error, setData: setAgents } = useLeaderboard();
  const { data: stats } = useStats();
  const { data: stakingStats } = useStakingStats();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());

  useWSEvent('score:updated', useCallback((event) => {
    const update: WSScoreUpdate = event.payload;
    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.agentId !== update.agentId) return agent;
        return {
          ...agent,
          naiveScore: update.naiveScore,
          hardenedScore: update.hardenedScore,
          hardenedTier: update.hardenedTier as TrustTier,
          stakeWeightedScore: update.stakeWeightedScore,
          scoreDelta: update.scoreDelta,
          feedbackCount: update.feedbackCount,
        };
      }),
    );
    setUpdatedIds((prev) => new Set(prev).add(update.agentId));
    setTimeout(() => {
      setUpdatedIds((prev) => {
        const next = new Set(prev);
        next.delete(update.agentId);
        return next;
      });
    }, 1500);
  }, [setAgents]));

  const filtered = useMemo(() => {
    let list = [...agents];

    if (category !== 'All') {
      const catLower = category.toLowerCase();
      list = list.filter(a => a.category.toLowerCase() === catLower);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.publisher.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    }

    return list;
  }, [agents, search, category]);

  const verifiedCount = agents.filter(a => !a.flagged && !a.isSybil).length;
  const sybilCount = stats?.sybilClustersDetected ?? 0;
  const totalStaked = stakingStats?.totalStakedEth ?? 0;

  if (loading) return <div className="loading">Loading skills...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="skills-page">
      {/* Hero Section */}
      <section className="hero">
        <span className="hero-badge">ERC-8004 Trust Registry</span>
        <h1 className="hero-title">
          Verified MCP Skills
        </h1>
        <p className="hero-subtitle">
          Browse trust-scored skills with attack-resistant reputation.
          Sybil rings caught, bad actors economically punished.
        </p>
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-value">{verifiedCount}</span>
            <span className="hero-stat-label">Verified Skills</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value">{stats?.totalFeedback?.toLocaleString() ?? '...'}</span>
            <span className="hero-stat-label">Feedback Entries</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value">{sybilCount}</span>
            <span className="hero-stat-label">Sybil Rings Caught</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value">{totalStaked.toFixed(1)} MON</span>
            <span className="hero-stat-label">Total Staked</span>
          </div>
        </div>
      </section>

      {/* Search + Category Filters */}
      <section className="skills-controls">
        <div className="skills-search-wrap">
          <Search className="search-icon-svg" />
          <input
            type="text"
            className="skills-search"
            placeholder="Search skills by name, publisher, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search skills"
          />
        </div>
        <div className="skills-categories" role="group" aria-label="Filter by category">
          {CATEGORY_FILTERS.map(cat => (
            <button
              key={cat}
              className={`category-pill ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Register Skill */}
      <RegisterSkillForm />

      {/* Skills Grid Header */}
      <div className="skills-grid-header">
        <span className="skills-grid-label">TRUSTED SKILLS</span>
        <span className="skills-grid-count">
          {filtered.length} skills &middot; ranked by hardened score
        </span>
      </div>

      {/* Card Grid */}
      <div className="skills-grid">
        {filtered.map(agent => (
          <SkillCard
            key={agent.agentId}
            agent={agent}
            isUpdated={updatedIds.has(agent.agentId)}
            onClick={() => setSelectedAgent(agent.agentId)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="skills-empty">
            No skills match your search. Try a different query or category.
          </div>
        )}
      </div>

      {/* Protocol Details (Collapsible) */}
      <ProtocolDetails />

      {/* Slide-Over Detail Panel */}
      {selectedAgent && (
        <SkillSlideOver
          agentId={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
