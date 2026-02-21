# Boost Demo Runbook

## 1. Deploy contracts (once)

```bash
npm run deploy:stake-slash
```

Add to `.env`:

```
SKILL_REGISTRY_ADDRESS=0x...
STAKE_ESCROW_ADDRESS=0x...
SLASHING_MANAGER_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...
```

## 2. Seed demo (one-shot)

```bash
npm run boost:demo
```

Registers `gmail-integration`, `github-token`, `postgres-connector`, stakes to L3/L1/L0, slashes gmail 50%.

## 3. Start server + dashboard

```bash
npm run dev:server
npm run dev:dashboard
```

Open http://localhost:5173 → Skills. Check Boost Lx badges and slide-over details.

## 4. Manual commands (if needed)

```bash
# Register one skill
SLUG=my-skill RISK=LOW npm run boost:register

# Stake (after register prints skillId)
SKILL_ID=1 AMOUNT_MON=14 npm run boost:stake

# Slash
SKILL_ID=1 SEVERITY_BPS=5000 REASON=DATA_EXFIL npm run boost:slash

# Status
SLUG=gmail-integration npm run boost:status
```

## 5. Demo script (judge run)

1. `npm run deploy:stake-slash` → copy addresses to .env
2. `npm run boost:demo` → registers + stakes + slashes
3. `npm run dev:server` & `npm run dev:dashboard`
4. Show Skills page → Boost Lx badges
5. Click gmail-integration → Last Slash card with TX link
6. Point out trust drop (L3 → L2 after 50% slash)
