import { useNavigate } from 'react-router-dom';
import { useStats, useStakingStats, useInsuranceStats } from '../hooks/useApi';
import {
  Shield,
  Lock,
  Cpu,
  AlertTriangle,
  ArrowRight,
  Users,
  Umbrella,
  BadgeCheck,
  CircleDollarSign,
  FileCheck2,
  ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' as const },
  }),
};

export default function LandingPageV2() {
  const navigate = useNavigate();
  const { data: stats } = useStats();
  const { data: stakingStats } = useStakingStats();
  const { data: insuranceStats } = useInsuranceStats();

  const coveredCount = stats
    ? stats.totalAgents - stats.flaggedAgents - stats.sybilAgents
    : null;

  return (
    <div className="flex flex-col gap-0">
      {/* ── Preview Banner ──────────────────────────────────── */}
      <div
        className="text-center py-2 text-xs font-semibold tracking-wide"
        style={{
          background: 'linear-gradient(90deg, rgba(196,92,58,0.15) 0%, rgba(59,130,246,0.15) 100%)',
          color: 'var(--color-accent)',
          borderBottom: '1px solid rgba(196,92,58,0.2)',
        }}
      >
        NARRATIVE PREVIEW — Insurance Underwriting Frame &middot;{' '}
        <a
          onClick={(e) => { e.preventDefault(); navigate('/'); }}
          href="/"
          style={{ color: 'var(--color-text-primary)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          Back to original
        </a>
      </div>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center text-center px-6 pt-20 pb-16 overflow-hidden">
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
          Underwritten AI skills.{' '}
          <span style={{ color: 'var(--color-success)' }}>If they break, you're covered.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative z-10 mt-5 text-base max-w-xl leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Publishers stake real collateral. Curators underwrite what they trust.
          If a skill goes malicious, victims get paid — automatically, on-chain.
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
            Browse Covered Skills
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
            { value: coveredCount ?? '...', label: 'Covered Skills' },
            { value: stats?.totalFeedback?.toLocaleString() ?? '...', label: 'Risk Assessments' },
            {
              value: insuranceStats ? `${insuranceStats.poolBalanceEth.toFixed(2)} MON` : stakingStats ? `${stakingStats.totalStakedEth.toFixed(1)} MON` : '...',
              label: 'Coverage Pool',
            },
            {
              value: stakingStats ? `${stakingStats.totalStakedEth.toFixed(1)} MON` : '...',
              label: 'Underwriting Collateral',
            },
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
              Zero Coverage When a Skill Burns You
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
                MCP skills in the ecosystem.{' '}
                <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>230+ confirmed malicious.</span>{' '}
                No recourse for victims.
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
                $0
              </div>
              <div
                className="text-sm mt-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Current coverage for teams integrating MCP skills — no collateral, no insurance, no compensation
              </div>
            </div>
          </div>
          <p
            className="text-sm mt-4 leading-relaxed"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Reputation breaks at high stakes. If the steal is worth more than the score,
            rational actors burn it. You need coverage backed by real capital, not just stars and reviews.
          </p>
        </motion.div>
      </section>

      {/* ── Coverage Tiers ─────────────────────────────────── */}
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
            Three Coverage Tiers
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Progressive underwriting — from community-assessed to hardware-attested, fully insured.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              tier: 'Tier 1',
              title: 'Self-Assessed',
              subtitle: 'No Coverage',
              icon: Users,
              color: 'var(--color-success)',
              badge: null,
              items: [
                'Community reputation signals only',
                'ERC-8004 on-chain feedback',
                'Sybil detection flags risks',
                'No staked collateral — use at own risk',
              ],
            },
            {
              tier: 'Tier 2',
              title: 'Underwritten',
              subtitle: 'Insured',
              icon: Umbrella,
              color: 'var(--color-staking)',
              badge: 'COVERED',
              items: [
                'Publisher stakes MON as collateral',
                'Curators underwrite with delegation',
                'Slashing triggers automatic claims',
                'Victims compensated from insurance pool',
              ],
            },
            {
              tier: 'Tier 3',
              title: 'Fully Attested',
              subtitle: 'Maximum Coverage',
              icon: Cpu,
              color: 'var(--color-tee)',
              badge: 'FULLY ATTESTED',
              items: [
                'TEE hardware verification',
                'Code-hash pinning & runtime proof',
                'Underwritten + hardware-guaranteed',
                'Highest coverage, lowest risk tier',
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
              className="rounded-xl border p-5 flex flex-col gap-4 transition-colors duration-150 relative"
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
              {tier.badge && (
                <span
                  className="absolute top-3 right-3 text-[0.6rem] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{
                    background: `color-mix(in srgb, ${tier.color} 15%, transparent)`,
                    color: tier.color,
                    border: `1px solid color-mix(in srgb, ${tier.color} 30%, transparent)`,
                  }}
                >
                  {tier.badge}
                </span>
              )}
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

      {/* ── How Coverage Works (4-step flow) ────────────────── */}
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
            How Coverage Works
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            From staking to claims — a complete insurance lifecycle on-chain.
          </p>
        </motion.div>

        <div className="grid gap-0 sm:grid-cols-4">
          {[
            {
              step: '01',
              icon: CircleDollarSign,
              title: 'Publisher Stakes',
              desc: 'Publisher locks MON collateral against their skill. Stake amount determines coverage tier and trust level.',
            },
            {
              step: '02',
              icon: Users,
              title: 'Curators Underwrite',
              desc: 'Independent curators delegate stake to skills they\'ve reviewed, expanding the coverage pool and sharing risk.',
            },
            {
              step: '03',
              icon: AlertTriangle,
              title: 'Slash on Malice',
              desc: 'Malicious behavior detected — collateral is slashed. 30% flows to insurance pool. 40% rewards the reporter.',
            },
            {
              step: '04',
              icon: FileCheck2,
              title: 'Victims Get Paid',
              desc: 'Affected users file on-chain claims. Arbiters vote. Approved claims are paid automatically from the pool.',
            },
          ].map((item, i) => (
            <motion.div
              key={item.step}
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
              variants={fadeUp}
              className="relative flex flex-col items-center text-center p-5"
            >
              {i < 3 && (
                <ChevronRight
                  className="hidden sm:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10"
                  style={{ color: 'var(--color-border)', width: 20, height: 20 }}
                />
              )}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                style={{
                  background: 'var(--color-accent-muted)',
                  border: '1px solid rgba(196, 92, 58, 0.25)',
                }}
              >
                <item.icon className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
              </div>
              <span
                className="text-[0.65rem] font-bold uppercase tracking-widest mb-1"
                style={{ color: 'var(--color-accent)' }}
              >
                Step {item.step}
              </span>
              <h3
                className="text-sm font-bold tracking-tight mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {item.title}
              </h3>
              <p
                className="text-[0.78rem] leading-relaxed"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {item.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Why Underwriting Beats Reputation ──────────────── */}
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
            Why Underwriting Beats Reputation
          </h2>
          <p
            className="text-sm mt-2 max-w-lg mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Reputation has an economic breakpoint. Insurance doesn't.
          </p>
        </motion.div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: Shield,
              title: 'Economic Breakpoint Problem',
              desc: 'If accumulated reputation is worth $50K but a steal is worth $100K, rational actors burn the reputation. Soft trust always breaks at high enough stakes.',
            },
            {
              icon: Lock,
              title: 'Collateral Creates Real Consequences',
              desc: 'Staked collateral is slashed on malice — publishers lose real money. The cost of attack always exceeds the cost of compliance.',
            },
            {
              icon: Umbrella,
              title: 'Victims Have Recourse',
              desc: 'Slash proceeds fund the insurance pool. Users harmed by malicious skills file claims and receive on-chain compensation. No more "just a loss."',
            },
            {
              icon: BadgeCheck,
              title: 'Coverage as Signal',
              desc: 'An underwritten skill tells you: someone put money behind this. Curators risked their own capital. The skill\'s publisher is accountable.',
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

      {/* ── Coverage Pool Stats ─────────────────────────────── */}
      <section className="px-6 py-12 max-w-5xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.4 }}
          className="rounded-xl border p-6 sm:p-8"
          style={{
            background: 'var(--color-surface-2)',
            borderColor: 'var(--color-border)',
          }}
        >
          <h3
            className="text-lg font-bold tracking-tight mb-6 text-center"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Live Coverage Pool
          </h3>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              {
                value: insuranceStats ? `${insuranceStats.poolBalanceEth.toFixed(2)} MON` : '...',
                label: 'Pool Balance',
                color: 'var(--color-success)',
              },
              {
                value: insuranceStats ? `${insuranceStats.totalDepositedEth.toFixed(2)} MON` : '...',
                label: 'Total Deposited',
                color: 'var(--color-staking)',
              },
              {
                value: insuranceStats?.paidClaims?.toString() ?? '...',
                label: 'Claims Paid',
                color: 'var(--color-accent)',
              },
              {
                value: insuranceStats ? `${(insuranceStats.coverageRatio * 100).toFixed(0)}%` : '...',
                label: 'Coverage Ratio',
                color: 'var(--color-tee)',
              },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                className="flex flex-col items-center gap-1"
              >
                <span
                  className="font-mono text-xl font-extrabold tracking-tight"
                  style={{ color: stat.color }}
                >
                  {stat.value}
                </span>
                <span
                  className="text-[0.7rem] font-medium uppercase tracking-widest"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {stat.label}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
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
            Ready to integrate with confidence?
          </h2>
          <p
            className="text-sm mt-2 max-w-md mx-auto"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Browse covered skills, see claims resolved in real-time,
            or underwrite a skill you trust.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <button
              onClick={() => navigate('/skills')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors duration-150 cursor-pointer"
              style={{ background: 'var(--color-accent)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
            >
              Browse Covered Skills
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
