# Local CLI Tools for Third-Party Model Integration

This directory contains locally installed CLI agents configured to work with third-party models (DeepSeek).

## Installed Tools

### 1. Claude Code (v2.1.39) - Works with DeepSeek

**Binary**: `.local/bin/claude-bin` (213MB standalone ELF binary)
**Wrappers**:
- `claude-ds` - Pre-configured for DeepSeek backend
- `claude-local` - Plain wrapper (configure via env vars)

**Usage**:
```bash
# Add to PATH for this session
export PATH="$PWD/.local/bin:$PATH"

# Use DeepSeek backend directly
claude-ds

# Or configure manually
ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic" \
ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY" \
ANTHROPIC_API_KEY="" \
ANTHROPIC_MODEL="deepseek-chat" \
claude-local
```

**How it works**: DeepSeek provides an Anthropic-compatible API endpoint at `https://api.deepseek.com/anthropic`. Claude Code sends all requests there instead of to Anthropic.

**Key environment variables**:
| Variable | Purpose |
|---|---|
| `ANTHROPIC_BASE_URL` | API endpoint (set to DeepSeek's Anthropic endpoint) |
| `ANTHROPIC_AUTH_TOKEN` | Auth token (use DeepSeek API key) |
| `ANTHROPIC_API_KEY` | Must be `""` to prevent Anthropic auth conflicts |
| `ANTHROPIC_MODEL` | Model name (`deepseek-chat`) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Model for haiku alias |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Model for sonnet alias |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Model for opus alias |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` to prevent background Anthropic requests |
| `API_TIMEOUT_MS` | Timeout in ms (use `600000` for slower models) |

**Verified working**: API calls succeed, tool use works (TodoWrite, Read, Bash, Glob, Skill). Note that DeepSeek does NOT support: image inputs, MCP tools, web search.

### 2. Codex CLI (v0.98.0) - Broken for DeepSeek

**Binary**: `/opt/node22/bin/codex` (installed globally via npm)
**Config**: `~/.codex/config.toml`

**Status**: **NOT WORKING** with DeepSeek as of Feb 2026.

Codex CLI deprecated `wire_api = "chat"` (Chat Completions API) and now requires `wire_api = "responses"` (OpenAI Responses API). DeepSeek does not support the Responses API (`/v1/responses` returns 404).

**Workarounds**:
1. Use a proxy (LiteLLM/ZenMux) that translates Responses API to Chat Completions
2. Pin an older Codex version that still supports `wire_api = "chat"`
3. Wait for DeepSeek to add Responses API support

### 3. Cursor Agent CLI (v2026.01.28) - Cannot Use Third-Party Models

**Binary**: `~/.local/bin/agent` (also available as `cursor agent` subcommand)

**Status**: **LOCKED TO CURSOR INFRASTRUCTURE**. No way to point at custom API endpoints.

The CLI only accepts Cursor's pre-configured models (gpt-5, sonnet-4, etc.) via `--model` flag. There is no `--base-url` or custom provider configuration. Authentication requires a Cursor subscription via `cursor agent login`.

### 4. OpenCode (v1.1.59) - Best Option for DeepSeek

**Binary**: `/opt/node22/bin/opencode` (installed globally via npm)
**Config**: `opencode.json` (project root)

**Status**: **WORKING PERFECTLY** with DeepSeek. Native support, zero friction.

OpenCode (`sst/opencode`) is a Go-based open-source terminal agent with native support for 75+ providers including DeepSeek. Both `deepseek-chat` and `deepseek-reasoner` work out of the box.

**Usage**:
```bash
# Non-interactive (pipe or positional prompt)
echo "explain this code" | opencode run --model deepseek/deepseek-chat

# Interactive TUI
opencode --model deepseek/deepseek-chat

# Use DeepSeek Reasoner (R1) for complex reasoning
opencode run --model deepseek/deepseek-reasoner
```

**Config** (`opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": {
      "options": { "apiKey": "{env:DEEPSEEK_API_KEY}" }
    }
  },
  "model": "deepseek/deepseek-chat"
}
```

**Verified working**: Text generation, reasoning (R1), tool use (bash commands). Responses in ~3 seconds.

## Summary

| CLI | DeepSeek | Config Complexity | Tool Use | Recommended |
|-----|----------|-------------------|----------|-------------|
| **OpenCode** | Native support | Minimal | Working | **Best choice** |
| Claude Code | Via env vars | Medium | Working | Good |
| Codex CLI | Broken | - | - | Not usable |
| Cursor Agent | Not possible | - | - | Not usable |
