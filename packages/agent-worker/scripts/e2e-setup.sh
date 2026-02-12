#!/usr/bin/env bash
#
# E2E Backend Setup — install and verify all CLI backends
#
# Usage:
#   ./scripts/e2e-setup.sh           # Install missing CLIs + check env vars
#   ./scripts/e2e-setup.sh --check   # Check only, don't install
#
# Required env vars (set before running):
#   DEEPSEEK_API_KEY   — for Claude Code (via DeepSeek) and OpenCode
#   OPENAI_API_KEY     — for Codex CLI (optional, skipped if missing)
#   CURSOR_API_KEY     — for Cursor Agent (optional, skipped if missing)

set -uo pipefail

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
fi

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; }

MISSING=0
AVAILABLE=0

# ─── Claude Code ──────────────────────────────────────────────
echo ""
echo "=== Claude Code ==="
if command -v claude &>/dev/null; then
  VERSION=$(claude --version 2>/dev/null || echo "unknown")
  ok "claude installed: $VERSION"
  ((AVAILABLE++))
elif [[ "$CHECK_ONLY" == true ]]; then
  fail "claude not found"
  ((MISSING++))
else
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
  if command -v claude &>/dev/null; then
    ok "claude installed: $(claude --version 2>/dev/null)"
    ((AVAILABLE++))
  else
    fail "claude installation failed"
    ((MISSING++))
  fi
fi

# ─── Codex CLI ────────────────────────────────────────────────
echo ""
echo "=== Codex CLI ==="
if command -v codex &>/dev/null; then
  VERSION=$(codex --version 2>/dev/null || echo "unknown")
  ok "codex installed: $VERSION"
  ((AVAILABLE++))
elif [[ "$CHECK_ONLY" == true ]]; then
  fail "codex not found"
  ((MISSING++))
else
  echo "Installing Codex CLI..."
  npm i -g @openai/codex 2>/dev/null || {
    warn "npm install failed, trying brew..."
    brew install --cask codex 2>/dev/null || {
      fail "codex installation failed"
      ((MISSING++))
    }
  }
  if command -v codex &>/dev/null; then
    ok "codex installed: $(codex --version 2>/dev/null)"
    ((AVAILABLE++))
  fi
fi

# ─── Cursor Agent ─────────────────────────────────────────────
echo ""
echo "=== Cursor Agent ==="
if command -v agent &>/dev/null || command -v cursor &>/dev/null; then
  CMD=$(command -v agent 2>/dev/null || command -v cursor 2>/dev/null)
  VERSION=$($CMD --version 2>/dev/null || echo "unknown")
  ok "cursor agent installed: $VERSION ($(basename $CMD))"
  ((AVAILABLE++))
elif [[ "$CHECK_ONLY" == true ]]; then
  fail "cursor agent not found (tried: agent, cursor)"
  ((MISSING++))
else
  echo "Installing Cursor Agent..."
  curl -fsS https://cursor.com/install | bash
  if command -v agent &>/dev/null; then
    ok "cursor agent installed: $(agent --version 2>/dev/null)"
    ((AVAILABLE++))
  else
    fail "cursor agent installation failed"
    ((MISSING++))
  fi
fi

# ─── OpenCode ─────────────────────────────────────────────────
echo ""
echo "=== OpenCode ==="
if command -v opencode &>/dev/null; then
  VERSION=$(opencode --version 2>/dev/null || echo "unknown")
  ok "opencode installed: $VERSION"
  ((AVAILABLE++))
elif [[ "$CHECK_ONLY" == true ]]; then
  fail "opencode not found"
  ((MISSING++))
else
  echo "Installing OpenCode..."
  curl -fsSL https://opencode.ai/install | bash 2>/dev/null || {
    warn "curl install failed, trying npm..."
    npm i -g opencode-ai@latest 2>/dev/null || {
      fail "opencode installation failed"
      ((MISSING++))
    }
  }
  if command -v opencode &>/dev/null; then
    ok "opencode installed: $(opencode --version 2>/dev/null)"
    ((AVAILABLE++))
  fi
fi

# ─── Environment Variables ────────────────────────────────────
echo ""
echo "=== Environment Variables ==="

if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
  ok "DEEPSEEK_API_KEY set (for Claude Code + OpenCode E2E)"
else
  warn "DEEPSEEK_API_KEY not set — Claude Code and OpenCode E2E tests will be skipped"
fi

if [[ -n "${AI_GATEWAY_API_KEY:-}" ]]; then
  ok "AI_GATEWAY_API_KEY set (for Codex E2E via Vercel AI Gateway → Gemini 2.0 Flash)"
elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
  ok "OPENAI_API_KEY set (for Codex E2E via OpenAI directly)"
else
  warn "AI_GATEWAY_API_KEY / OPENAI_API_KEY not set — Codex E2E tests will be skipped"
  echo "       Get Vercel AI Gateway key from: https://vercel.com/docs/ai-gateway"
fi

if [[ -n "${CURSOR_API_KEY:-}" ]]; then
  ok "CURSOR_API_KEY set (for Cursor E2E — requires paid Cursor subscription)"
else
  warn "CURSOR_API_KEY not set — Cursor E2E tests will be skipped"
  echo "       Get key from: https://cursor.com/dashboard?tab=background-agents"
fi

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
echo "CLIs available: $AVAILABLE/4"
if [[ $MISSING -gt 0 ]]; then
  echo "CLIs missing:   $MISSING"
fi
echo ""
echo "To run E2E tests:"
echo "  bun test test/e2e/"
