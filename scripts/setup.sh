#!/usr/bin/env bash
# ============================================================================
# Trusted ClawMon — One-Command Developer Setup
# ============================================================================
# Sets up everything needed to run the project. Designed for hackathon
# evaluators and new developers to get running in under 5 minutes.
#
# Usage:
#   ./scripts/setup.sh          # Full setup (prompts for Monad creds)
#   ./scripts/setup.sh --demo   # Demo mode (no credentials needed)
#   ./scripts/setup.sh --start  # Setup + auto-start server & dashboard
#   ./scripts/setup.sh --demo --start  # Full demo experience
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

DEMO_MODE=false
AUTO_START=false

for arg in "$@"; do
  case "$arg" in
    --demo) DEMO_MODE=true ;;
    --start) AUTO_START=true ;;
  esac
done

# Navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                                                          ║"
echo "║           TRUSTED CLAWMON — PROJECT SETUP                ║"
echo "║                                                          ║"
if $DEMO_MODE; then
echo "║           Mode: DEMO (no credentials needed)             ║"
else
echo "║           Mode: FULL (Monad testnet)                     ║"
fi
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# -------------------------------------------------------------------------
# Step 1: Check prerequisites
# -------------------------------------------------------------------------
echo -e "${CYAN}[1/5] Checking prerequisites...${NC}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}Error: Node.js not found. Install from https://nodejs.org (>= 18)${NC}"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}Error: Node.js >= 18 required (found $(node -v))${NC}"
  exit 1
fi

echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"
echo -e "  ${GREEN}✓${NC} npm $(npm -v)"
echo ""

# -------------------------------------------------------------------------
# Step 2: Install dependencies
# -------------------------------------------------------------------------
echo -e "${CYAN}[2/5] Installing dependencies...${NC}"

echo "  Installing root dependencies..."
npm install --silent 2>&1 | tail -1 || npm install

echo "  Installing dashboard dependencies..."
cd dashboard
npm install --silent 2>&1 | tail -1 || npm install
cd "$ROOT_DIR"

echo -e "  ${GREEN}✓${NC} All dependencies installed"
echo ""

# -------------------------------------------------------------------------
# Step 3: Compile smart contracts
# -------------------------------------------------------------------------
echo -e "${CYAN}[3/5] Compiling smart contracts...${NC}"

npx hardhat compile --config hardhat.config.cjs 2>&1 | grep -E "(Compiled|compiled|Nothing)" || true

echo -e "  ${GREEN}✓${NC} Contracts compiled"
echo ""

# -------------------------------------------------------------------------
# Step 4: Configure environment
# -------------------------------------------------------------------------
echo -e "${CYAN}[4/5] Configuring environment...${NC}"

if $DEMO_MODE; then
  cp .env.demo .env
  echo -e "  ${GREEN}✓${NC} Created .env from .env.demo (demo mode)"
elif [ ! -f .env ]; then
  cp .env.example .env
  echo -e "  ${YELLOW}⚠${NC} Created .env from .env.example"
  echo -e "  ${YELLOW}  Edit .env with your Monad credentials before running.${NC}"
  echo -e "  ${YELLOW}  Get testnet MON from the Monad faucet.${NC}"
else
  echo -e "  ${GREEN}✓${NC} .env already exists (keeping existing config)"
fi
echo ""

# -------------------------------------------------------------------------
# Step 5: Validate
# -------------------------------------------------------------------------
echo -e "${CYAN}[5/5] Validating setup...${NC}"

if $DEMO_MODE; then
  bash scripts/validate-env.sh --demo 2>&1 | grep -E "(✓|✗|⚠|Results)" | head -20
else
  bash scripts/validate-env.sh 2>&1 | grep -E "(✓|✗|⚠|Results)" | head -20
fi
echo ""

# -------------------------------------------------------------------------
# Done!
# -------------------------------------------------------------------------
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                                                          ║"
echo -e "║   ${GREEN}Setup complete!${NC}                                        ║"
echo "║                                                          ║"

if $AUTO_START; then
echo "║   Starting server and dashboard...                       ║"
echo "║                                                          ║"
echo "║   API Server:  http://localhost:3001                     ║"
echo "║   Dashboard:   http://localhost:5173                     ║"
echo "║   WebSocket:   ws://localhost:3001/ws                    ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

  # Start the API server in the background
  echo -e "${CYAN}Starting API server...${NC}"
  npm run dev:server &
  SERVER_PID=$!

  # Wait for server to be ready
  echo "  Waiting for server to start..."
  for i in $(seq 1 30); do
    if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} API server ready (PID: $SERVER_PID)"
      break
    fi
    sleep 1
  done

  # Start the dashboard
  echo -e "${CYAN}Starting dashboard...${NC}"
  cd dashboard
  npm run dev &
  DASH_PID=$!
  cd "$ROOT_DIR"

  sleep 3
  echo -e "  ${GREEN}✓${NC} Dashboard starting (PID: $DASH_PID)"
  echo ""
  echo -e "${BOLD}Open http://localhost:5173 in your browser${NC}"
  echo -e "Press Ctrl+C to stop both servers"
  echo ""

  # Wait for either to exit
  trap "kill $SERVER_PID $DASH_PID 2>/dev/null; exit 0" INT TERM
  wait

else
echo "║   To start the system:                                   ║"
echo "║                                                          ║"
echo "║   npm run dev:server    # Start API (port 3001)          ║"
echo "║   npm run dev:dashboard # Start dashboard (port 5173)    ║"
echo "║                                                          ║"
echo "║   Or run both at once:                                   ║"
echo "║   npm run dev:all                                        ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
fi
