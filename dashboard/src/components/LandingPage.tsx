import { useNavigate } from 'react-router-dom';
import { useStats, useStakingStats } from '../hooks/useApi';
import { Shield, Lock, Cpu, AlertTriangle, ArrowRight, Activity, Users, Layers } from 'lucide-react';
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

        <motion.span
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="relative z-10 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-semibold tracking-wide mb-8"
          style={{
            background: 'var(--color-accent-muted)',
            borderColor: 'rgba(196, 92, 58, 0.25)',
            color: 'var(--color-accent)',
          }}
        >
          <Shield className="w-3.5 h-3.5" />
          ERC-8004 + Monad Testnet
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative z-10 text-[2.8rem] leading-[1.15] font-extrabold tracking-[-0.03em] max-w-2xl"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Trust scores for AI skills.
          <br />
          <span style={{ color: 'var(--color-success)' }}>AI skills underwritten.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative z-10 mt-5 text-base max-w-xl leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Verified on-chain reputation backed by x402 payment receipts, ERC-8004
          agentic identity, and the highest throughput blockchain in the universe.
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
          className="relative z-10 grid grid-cols-2 gap-8 mt-14 sm:grid-cols-4"
        >
          {[
            { value: verifiedCount ?? '...', label: 'Verified Skills' },
            { value: stats?.totalFeedback?.toLocaleString() ?? '...', label: 'Feedback Entries' },
            { value: stats?.sybilClustersDetected ?? '...', label: 'Sybil Rings Caught' },
            { value: stakingStats ? `${stakingStats.totalStakedEth.toFixed(1)} MON` : '...', label: 'Total Staked' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              className="flex flex-col items-center gap-1"
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
              The AI Agent Trust Problem
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
                5,700+
              </div>
              <div
                className="text-sm mt-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                MCP skills in the ecosystem with{' '}
                <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>230+ confirmed malicious</span>
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
                99.5%
              </div>
              <div
                className="text-sm mt-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Noise ratio in ERC-8004 registries — 22,000+ agents, ~100 legitimate
              </div>
            </div>
          </div>
          <p
            className="text-sm mt-4 leading-relaxed"
            style={{ color: 'var(--color-text-muted)' }}
          >
            No trust layer. No identity verification. No feedback system. No economic
            consequences for publishing malicious skills.
          </p>
        </motion.div>
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
            Three-Tier Trust Model
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Progressive trust verification — from community signals to hardware attestation.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              tier: 'Tier 1',
              title: 'Community Reputation',
              subtitle: 'Soft Trust',
              icon: Users,
              color: 'var(--color-success)',
              items: [
                'ERC-8004 on-chain feedback',
                'Hardened scoring engine',
                'Sybil detection via graph analysis',
                'Velocity + anomaly burst mitigation',
              ],
            },
            {
              tier: 'Tier 2',
              title: 'Economic Staking',
              subtitle: 'Bonded Trust',
              icon: Lock,
              color: 'var(--color-staking)',
              items: [
                'MON collateral staking',
                'Slashing for malicious behavior',
                'Delegated staking support',
                'Insurance pool from slash funds',
              ],
            },
            {
              tier: 'Tier 3',
              title: 'TEE Attestation',
              subtitle: 'Hardware Trust',
              icon: Cpu,
              color: 'var(--color-tee)',
              items: [
                'Trusted Execution Environment',
                'Code-hash pinning & verification',
                'Platform-level attestation',
                'Behavior analysis in enclave',
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
            How It Works
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            A complete trust infrastructure stack built on ERC-8004 and Monad.
          </p>
        </motion.div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: Activity,
              title: 'Real-Time Scoring',
              desc: 'Feedback is processed through naive + hardened scoring engines with 5 independent mitigation layers.',
            },
            {
              icon: Shield,
              title: 'Attack Mitigation',
              desc: 'Sybil rings detected via graph analysis. Velocity bursts, temporal decay, and anomaly detection catch manipulation.',
            },
            {
              icon: Layers,
              title: 'On-Chain Attestation',
              desc: 'Trust scores bridged to Monad via AttestationRegistry. Cross-chain verification with freshness guarantees.',
            },
            {
              icon: Lock,
              title: 'Economic Security',
              desc: 'Publishers stake MON as collateral. Malicious behavior triggers slashing. Slash funds flow to insurance pool.',
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
            Ready to explore the trust layer?
          </h2>
          <p
            className="text-sm mt-2 max-w-md mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Browse verified MCP skills, view attack mitigations in action,
            and see how economic staking creates accountability.
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
          <p
            className="text-xs mt-6 font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ETHDenver 2026 &middot; ERC-8004 &middot; Monad Testnet
          </p>
        </motion.div>
      </section>
    </div>
  );
}
