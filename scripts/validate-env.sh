#!/usr/bin/env bash
# ============================================================================
# Trusted ClawMon — Environment Validation Script
# ============================================================================
# Checks that all required tools, dependencies, and configuration are in place.
#
# Usage:
#   ./scripts/validate-env.sh          # Full validation
#   ./scripts/validate-env.sh --demo   # Demo mode (skip credential checks)
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARN=$((WARN+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }

DEMO_MODE=false
if [[ "${1:-}" == "--demo" ]]; then
  DEMO_MODE=true
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Trusted ClawMon — Environment Validation           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# -------------------------------------------------------------------------
# 1. Runtime
# -------------------------------------------------------------------------
echo -e "${CYAN}[1/6] Runtime${NC}"

if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    pass "Node.js v${NODE_VERSION} (>= 18 required)"
  else
    fail "Node.js v${NODE_VERSION} — need >= 18.0.0"
  fi
else
  fail "Node.js not found — install from https://nodejs.org"
fi

if command -v npm &>/dev/null; then
  NPM_VERSION=$(npm -v)
  pass "npm v${NPM_VERSION}"
else
  fail "npm not found"
fi

if command -v npx &>/dev/null; then
  pass "npx available"
else
  warn "npx not found (needed for Hardhat)"
fi

echo ""

# -------------------------------------------------------------------------
# 2. Dependencies
# -------------------------------------------------------------------------
echo -e "${CYAN}[2/6] Dependencies${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -d "$ROOT_DIR/node_modules" ]; then
  pass "Root node_modules installed"
else
  fail "Root node_modules missing — run 'npm install'"
fi

if [ -d "$ROOT_DIR/dashboard/node_modules" ]; then
  pass "Dashboard node_modules installed"
else
  fail "Dashboard node_modules missing — run 'cd dashboard && npm install'"
fi

echo ""

# -------------------------------------------------------------------------
# 3. Smart Contracts
# -------------------------------------------------------------------------
echo -e "${CYAN}[3/6] Smart Contracts${NC}"

if [ -d "$ROOT_DIR/artifacts/contracts" ]; then
  CONTRACT_COUNT=$(find "$ROOT_DIR/artifacts/contracts" -name "*.json" -not -name "*.dbg.json" | wc -l | tr -d ' ')
  if [ "$CONTRACT_COUNT" -ge 6 ]; then
    pass "Contracts compiled ($CONTRACT_COUNT artifacts)"
  else
    warn "Only $CONTRACT_COUNT contract artifacts found (expected 6+) — run 'npm run compile:contracts'"
  fi
else
  fail "No compiled contracts — run 'npm run compile:contracts'"
fi

echo ""

# -------------------------------------------------------------------------
# 4. Environment File
# -------------------------------------------------------------------------
echo -e "${CYAN}[4/6] Environment Configuration${NC}"

if [ -f "$ROOT_DIR/.env" ]; then
  pass ".env file exists"
  
  # Source .env safely (only export lines matching KEY=VALUE)
  set -a
  source <(grep -E '^[A-Z_]+=' "$ROOT_DIR/.env" 2>/dev/null || true)
  set +a
  
  if [ "${DEMO_MODE:-}" = "true" ] || [ "$DEMO_MODE" = true ]; then
    pass "DEMO_MODE=true — no external credentials required"
  else
    # Check Monad credentials
    if [ -n "${MONAD_PRIVATE_KEY:-}" ]; then
      pass "MONAD_PRIVATE_KEY configured"
    else
      warn "MONAD_PRIVATE_KEY not configured (server will use simulated data)"
    fi
    
    if [ -n "${MONAD_RPC_URL:-}" ]; then
      pass "MONAD_RPC_URL=$MONAD_RPC_URL"
    else
      warn "MONAD_RPC_URL not set (will use default: https://testnet.monad.xyz/v1)"
    fi
    
    if [ -n "${MESSAGELOG_CONTRACT_ADDRESS:-}" ]; then
      pass "MESSAGELOG_CONTRACT_ADDRESS=$MESSAGELOG_CONTRACT_ADDRESS"
    else
      warn "MESSAGELOG_CONTRACT_ADDRESS not set (run 'npm run setup' to deploy)"
    fi
  fi
  
  # Check PORT
  PORT_VAL="${PORT:-3001}"
  pass "PORT=$PORT_VAL"
  
else
  fail ".env file missing — copy from .env.example or .env.demo"
fi

echo ""

# -------------------------------------------------------------------------
# 5. Dashboard
# -------------------------------------------------------------------------
echo -e "${CYAN}[5/6] Dashboard${NC}"

if [ -f "$ROOT_DIR/dashboard/package.json" ]; then
  pass "Dashboard package.json exists"
else
  fail "Dashboard package.json missing"
fi

if [ -f "$ROOT_DIR/dashboard/vite.config.ts" ]; then
  pass "Vite config present"
else
  warn "Vite config missing"
fi

echo ""

# -------------------------------------------------------------------------
# 6. Connectivity (optional, non-blocking)
# -------------------------------------------------------------------------
echo -e "${CYAN}[6/6] Connectivity (optional)${NC}"

if command -v curl &>/dev/null; then
  # Check Monad RPC
  MONAD_URL="${MONAD_RPC_URL:-https://testnet.monad.xyz/v1}"
  if curl -s --max-time 5 -X POST "$MONAD_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    | grep -q "result" 2>/dev/null; then
    pass "Monad RPC reachable"
  else
    warn "Monad RPC unreachable — on-chain reads will fall back to simulated data"
  fi
else
  warn "curl not available — skipping connectivity checks"
fi

echo ""

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${YELLOW}${WARN} warnings${NC}, ${RED}${FAIL} failed${NC}"

if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}Some checks failed. Fix the issues above before running.${NC}"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "  ${YELLOW}Warnings present but system should run. Demo mode recommended.${NC}"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  exit 0
else
  echo -e "  ${GREEN}All checks passed! Ready to run.${NC}"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  exit 0
fi
