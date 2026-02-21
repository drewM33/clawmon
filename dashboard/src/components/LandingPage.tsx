import { useNavigate } from 'react-router-dom';
import { useStats, useStakingStats } from '../hooks/useApi';
import { Shield, Lock, Cpu, AlertTriangle, ArrowRight, Users, TrendingUp, Star, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' as const },
  }),
};

export default function LandingPage() {
  const navigate = useNavigate();
  const { data: stats } = useStats();
  const { data: stakingStats } = useStakingStats();
  // Where each boost goes: stake allocation (not payment splits)
  const boostSplit = [
    { label: 'Skill stake', bps: 8800, pct: 88, tone: 'stake' },
    { label: 'Verification pool', bps: 800, pct: 8, tone: 'verification' },
    { label: 'Resilience reserve', bps: 400, pct: 4, tone: 'resilience' },
  ] as const;
  // Slash outcomes: no treasury, compensation-focused
  const slashSplit = [
    { label: 'User compensation', pct: 45, tone: 'compensation' },
    { label: 'Reporter', pct: 40, tone: 'reporter' },
    { label: 'Burn', pct: 15, tone: 'burn' },
  ] as const;

  const verifiedCount = stats
    ? stats.totalAgents - stats.flaggedAgents - stats.sybilAgents
    : null;

  return (
    <div className="flex flex-col gap-0">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center text-center px-6 pt-20 pb-16 overflow-hidden">
        {/* Subtle radial glow behind hero */}
        <div
          className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[800px] h-[600px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(ellipse at center, var(--color-accent) 0%, transparent 70%)',
          }}
        />

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative z-10 text-[2.8rem] leading-[1.15] font-extrabold tracking-[-0.03em] max-w-2xl"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Agents need to know
          <br />
          <span style={{ color: 'var(--color-success)' }}>which skills to call.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative z-10 mt-5 text-base max-w-xl leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          ClawMon is the trust layer for the agent economy. Stake-weighted
          reputation scores that agents can query before invoking any MCP skill.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="relative z-10 flex gap-3 mt-8"
        >
          <button
            onClick={() => navigate('/skills')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors duration-150 cursor-pointer"
            style={{ background: 'var(--color-accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
          >
            Explore Skills
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/network')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors duration-150 cursor-pointer"
            style={{
              background: 'transparent',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border-hover)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }}
          >
            View Network Graph
          </button>
        </motion.div>

        {/* Hero Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="relative z-10 mt-14 flex flex-wrap items-start justify-center gap-8"
        >
          {[
            { value: verifiedCount ?? '...', label: 'Skills Indexed' },
            { value: stakingStats ? `${stakingStats.totalStakedEth.toFixed(1)} MON` : '...', label: 'Staked as Collateral' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              className="flex min-w-[160px] flex-col items-center gap-1"
            >
              <span
                className="font-mono text-2xl font-extrabold tracking-tight"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {stat.value}
              </span>
              <span
                className="text-[0.72rem] font-medium uppercase tracking-widest"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {stat.label}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── Problem Statement ──────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="rounded-xl border p-6 sm:p-8"
          style={{
            background: 'var(--color-surface-2)',
            borderColor: 'rgba(239, 68, 68, 0.15)',
          }}
        >
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--color-danger)' }} />
            <h2
              className="text-lg font-bold tracking-tight"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Your agent can't tell good skills from bad ones
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            <div
              className="rounded-lg border p-4"
              style={{ background: 'var(--color-surface-1)', borderColor: 'var(--color-border)' }}
            >
              <div
                className="font-mono text-2xl font-bold"
                style={{ color: 'var(--color-danger)' }}
              >
                9,000+
              </div>
              <div
                className="text-sm mt-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                MCP skills in the wild — agents call them blindly with{' '}
                <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>no way to verify safety first</span>
              </div>
            </div>
            <div
              className="rounded-lg border p-4"
              style={{ background: 'var(--color-surface-1)', borderColor: 'var(--color-border)' }}
            >
              <div
                className="font-mono text-2xl font-bold"
                style={{ color: 'var(--color-warning)' }}
              >
                {'<'}3%
              </div>
              <div
                className="text-sm mt-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Of registered agents show real usage — the signal-to-noise ratio is unusable for automated discovery
              </div>
            </div>
          </div>
          <p
            className="text-sm mt-4 leading-relaxed"
            style={{ color: 'var(--color-text-muted)' }}
          >
            No queryable trust score. No on-chain reputation. No economic penalty for
            shipping a malicious skill. Agents deserve better inputs.
          </p>
        </motion.div>
      </section>

      {/* ── Boost Economy Graphic ───────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="text-center mb-10"
        >
          <h2
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Capital-backed trust signals
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Boosts are on-chain commitments, not likes. MON splits across
            skill collateral, verification, and an insurance fund — all queryable by any agent.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5 }}
          className="boost-infographic"
        >
          <div className="boost-infographic-grid">
            <div className="boost-flow-card boost-flow-card-stake">
              <div className="boost-flow-card-head">
                <Zap className="boost-flow-card-icon" />
                <h3>Boosted Skill Backing</h3>
              </div>
              <p className="boost-flow-card-copy">
                Boosts become on-chain collateral that any agent can read as a trust signal before invoking a skill.
              </p>
              <div className="boost-plan-stack">
                <div className="boost-plan-line">
                  <span className="boost-plan-name">TRUST BASIC</span>
                  <span className="boost-plan-amount">0.5 MON</span>
                </div>
                <div className="boost-plan-line">
                  <span className="boost-plan-name">TRUST BOOST</span>
                  <span className="boost-plan-amount">2.0 MON</span>
                </div>
              </div>
              <div className="boost-ladder">
                <span>L1: 2 boosts</span>
                <span>L2: 7 boosts</span>
                <span>L3: 14 boosts</span>
              </div>
            </div>

            <div className="boost-flow-card boost-flow-card-payments">
              <div className="boost-flow-card-head">
                <TrendingUp className="boost-flow-card-icon" />
                <h3>Per Boost</h3>
              </div>
              <p className="boost-flow-card-copy">
                88% backs the skill as queryable collateral. 8% funds verification — oracles, attestation, evidence review. 4% flows to an insurance fund that compensates agents and users if a skill misbehaves.
              </p>
              <div className="boost-split-list">
                {boostSplit.map((slice) => (
                  <div key={slice.label} className="boost-split-row">
                    <div className="boost-split-label-row">
                      <span>{slice.label}</span>
                      <strong>{slice.pct}%</strong>
                    </div>
                    <div className="boost-split-track">
                      <span
                        className={`boost-split-fill tone-${slice.tone}`}
                        style={{ width: `${slice.pct}%` }}
                      />
                    </div>
                    <span className="boost-split-bps">{slice.bps} bps</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="boost-flow-card boost-flow-card-protection">
              <div className="boost-flow-card-head">
                <Shield className="boost-flow-card-icon" />
                <h3>Slash Outcomes</h3>
              </div>
              <p className="boost-flow-card-copy">
                Bad skills lose their stake. Funds flow to affected agents and the reporters who flagged the issue — no middleman, no treasury cut.
              </p>
              <div className="boost-slash-grid boost-slash-grid-three">
                {slashSplit.map((slice) => (
                  <div key={slice.label} className={`boost-slash-pill tone-${slice.tone}`}>
                    <strong>{slice.pct}%</strong>
                    <span>{slice.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="boost-infographic-footer">
            <span>Boost = machine-readable trust</span>
            <span>88% backs the skill on-chain</span>
            <span>Slash funds go to affected parties, not a treasury</span>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="text-center text-sm mt-6 max-w-xl mx-auto font-mono"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Every flow on-chain. Every signal queryable. Agents can verify before they invoke.
        </motion.p>
      </section>

      {/* ── Three-Tier Trust Model ─────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="text-center mb-10"
        >
          <h2
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Three layers of verifiable trust
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Each tier produces a stronger on-chain signal — agents can set their
            own threshold for which tiers they require before calling a skill.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              tier: 'Tier 1',
              title: 'Reputation Score',
              subtitle: 'Community Signal',
              icon: Users,
              color: 'var(--color-success)',
              items: [
                'ERC-8004 feedback aggregated on-chain',
                'Sybil-resistant scoring via graph analysis',
                'Velocity & burst anomaly filtering',
                'Queryable score per skill address',
              ],
            },
            {
              tier: 'Tier 2',
              title: 'Economic Bond',
              subtitle: 'Collateralized Trust',
              icon: Lock,
              color: 'var(--color-staking)',
              items: [
                'Publisher collateral readable on-chain',
                'Slashing enforced by smart contract',
                'Delegated staking from curator agents',
                'Insurance fund for downstream consumers',
              ],
            },
            {
              tier: 'Tier 3',
              title: 'TEE Attestation',
              subtitle: 'Hardware Proof',
              icon: Cpu,
              color: 'var(--color-tee)',
              items: [
                'Execution inside Trusted Execution Environment',
                'Code hash pinned and verifiable',
                'Platform attestation proof on-chain',
                'Runtime behavior monitored in enclave',
              ],
            },
          ].map((tier, i) => (
            <motion.div
              key={tier.tier}
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
              variants={fadeUp}
              className="rounded-xl border p-5 flex flex-col gap-4 transition-colors duration-150"
              style={{
                background: 'var(--color-surface-2)',
                borderColor: 'var(--color-border)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = tier.color;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{
                    background: `color-mix(in srgb, ${tier.color} 12%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${tier.color} 25%, transparent)`,
                  }}
                >
                  <tier.icon className="w-4.5 h-4.5" style={{ color: tier.color }} />
                </div>
                <div>
                  <span
                    className="text-[0.68rem] font-semibold uppercase tracking-widest block"
                    style={{ color: tier.color }}
                  >
                    {tier.tier}
                  </span>
                  <span
                    className="text-base font-bold tracking-tight block leading-tight"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {tier.title}
                  </span>
                </div>
              </div>
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {tier.subtitle}
              </span>
              <ul className="flex flex-col gap-2 mt-auto">
                {tier.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[0.82rem] leading-snug"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span className="mt-1.5 block w-1 h-1 rounded-full shrink-0" style={{ background: tier.color }} />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Architecture / How It Works ────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="text-center mb-10"
        >
          <h2
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Built for agent workflows
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Four primitives that let agents evaluate, select, and safely invoke
            skills without human intervention.
          </p>
        </motion.div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: Lock,
              title: 'Stake to list',
              desc: 'Skill publishers post MON collateral on-chain. Agents can read the bond size before deciding to invoke — higher stake, stronger signal.',
            },
            {
              icon: TrendingUp,
              title: 'Boost as curation',
              desc: 'Agents and curators boost skills with real capital. Boost weight is tiered (Claw → Lobster → Whale) so signal quality scales with track record.',
            },
            {
              icon: Star,
              title: 'Conviction yield',
              desc: 'Early boosters earn more as a skill climbs. Curator agents can build reputation and attract delegated stake from other agents that mirror their picks.',
            },
            {
              icon: Shield,
              title: 'Automated protection',
              desc: 'Slashed collateral routes to affected consumers via smart contract — no claims process, no human arbiter in the loop.',
            },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
              variants={fadeUp}
              className="rounded-xl border p-5 flex gap-4"
              style={{
                background: 'var(--color-surface-2)',
                borderColor: 'var(--color-border)',
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: 'var(--color-accent-muted)',
                  border: '1px solid rgba(196, 92, 58, 0.25)',
                }}
              >
                <item.icon className="w-4.5 h-4.5" style={{ color: 'var(--color-accent)' }} />
              </div>
              <div>
                <h3
                  className="text-sm font-bold tracking-tight"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {item.title}
                </h3>
                <p
                  className="text-[0.82rem] mt-1.5 leading-relaxed"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {item.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="rounded-xl border p-8 sm:p-10 text-center"
          style={{
            background: 'var(--color-surface-2)',
            borderColor: 'var(--color-border)',
          }}
        >
          <h2
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Give your agents better inputs
          </h2>
          <p
            className="text-sm mt-2 max-w-md mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Query collateral-backed trust scores, boost skills your agents rely on,
            and let the registry do the vetting so your agents don't have to.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <button
              onClick={() => navigate('/skills')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors duration-150 cursor-pointer"
              style={{ background: 'var(--color-accent)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
            >
              Explore Skills
              <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors duration-150"
              style={{
                background: 'transparent',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-hover)';
                (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)';
              }}
            >
              View Documentation
            </a>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
