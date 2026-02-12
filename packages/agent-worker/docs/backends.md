# Backend Reference

Agent-worker supports multiple backends with different capabilities.

## Feature Matrix

| Feature | SDK | Claude CLI | Codex CLI | Cursor CLI | OpenCode CLI | Mock |
|---------|-----|------------|-----------|------------|-------------|------|
| **Messaging** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Conversation history** | ✅ | ⚠️ Simplified | ⚠️ Simplified | ⚠️ Simplified | ⚠️ Simplified | ✅ |
| **Dynamic tools** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Tool mocking** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Approval system** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Skills (via tool)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Skills (filesystem)** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **`--import-skill`** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Token usage** | ✅ | ⚠️ Limited | ⚠️ Limited | ⚠️ Limited | ✅ | ✅ |
| **Export transcript** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Legend**: ✅ Full | ⚠️ Partial | ❌ Not supported

## When to Choose

| Backend | Best For |
|---------|----------|
| **SDK** (default) | Full control, tool injection, mocking, `--import-skill`, programmatic usage |
| **Claude CLI** | Existing Claude installation, native Claude experience, MCP server support |
| **Codex CLI** | OpenAI Codex workflows |
| **Cursor CLI** | Cursor Agent integration |
| **OpenCode CLI** | Multi-provider support (DeepSeek, Anthropic, OpenAI, Gemini, Ollama) |
| **Mock** | Testing workflows without real LLM API calls |

---

## CLI Backend Details

All CLI backends share this architecture:

```
Workflow YAML (backend: cursor|claude|codex|opencode)
    │
    ▼
getBackendByType() → Backend
    ├── setWorkspace(dir, mcpConfig)  ← writes MCP config to workspace
    └── send(prompt, { system })      ← executes CLI command
         └── buildCommand → execa(command, args, { cwd, stdin: 'ignore', timeout })
```

### Cursor (`cursor-agent`)

**Command**: `cursor-agent -p --force --approve-mcps <message> [--model <model>]`

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `sonnet-4.5` | Model identifier |
| `timeout` | 300s | Idle timeout (resets on output) |
| `workspace` | - | Contains `.cursor/mcp.json` |

**MCP config**: JSON at `<workspace>/.cursor/mcp.json`

**Model map**: `sonnet` → `sonnet-4.5`, `opus` → `opus-4.5`, `claude-sonnet-4-5` → `sonnet-4.5`

**Gotchas**:
- stdin must be `'ignore'` — cursor-agent hangs otherwise
- No system prompt flag; embedded in message
- Timeout is idle-based: resets whenever the process produces output
- Response is plain text only

### Claude Code (`claude`)

**Command**: `claude -p --dangerously-skip-permissions --output-format stream-json <message> [--model <model>] [--mcp-config <path>] [--append-system-prompt <text>]`

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `sonnet` | Model identifier |
| `timeout` | 300s | Idle timeout (resets on output) |
| `outputFormat` | `stream-json` | `text` \| `json` \| `stream-json` |
| `mcpConfigPath` | - | MCP config file path |

**MCP config**: JSON via `--mcp-config <path>` flag (per-invocation, not project-level)

**Model map**: `sonnet` → `sonnet`, `opus` → `opus`, `claude-sonnet-4-5` → `sonnet`

**Gotchas**:
- MCP via flag, not project-level config (unlike Cursor/Codex)
- System prompt via `--append-system-prompt` (appends, doesn't replace)
- Timeout is idle-based: resets whenever the process produces output
- Default stream-json output enables real-time progress (tool calls, cost)

### Codex (`codex exec`)

**Command**: `codex exec --full-auto --json --skip-git-repo-check <message> [--model <model>]`

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `gpt-5.2-codex` | Model identifier |
| `timeout` | 300s | Idle timeout (resets on output) |

**MCP config**: YAML at `<workspace>/.codex/config.yaml` (key: `mcp_servers`, snake_case)

**Model map**: `gpt-5.2` → `gpt-5.2-codex`, `o3` → `o3`

**Gotchas**:
- Uses `codex exec` subcommand (not just `codex`)
- Only backend using YAML for MCP config
- Config key is `mcp_servers` (snake_case), not `mcpServers`
- JSON mode returns NDJSON (newline-delimited), not single object
- Event types differ from Cursor/Claude: `thread.started`, `item.completed`, `turn.completed`
- Timeout is idle-based: resets whenever the process produces output
- `--skip-git-repo-check` enables running in workspace dirs without git init

### OpenCode (`opencode run`)

**Command**: `opencode run --format json <message> [--model <provider/model>]`

| Option | Default | Description |
|--------|---------|-------------|
| `model` | `deepseek/deepseek-chat` | Model in provider/model format |
| `timeout` | 600s | Idle timeout (resets on output) |

**MCP config**: JSON at `<workspace>/opencode.json` (key: `mcp`, uses `type: "local"` format)

**Model map**: `deepseek-chat` → `deepseek/deepseek-chat`, `sonnet` → `anthropic/claude-sonnet-4-5-20250514`

**Gotchas**:
- Uses `opencode run` subcommand for non-interactive mode
- Models use `provider/model` format (e.g., `deepseek/deepseek-chat`)
- MCP config uses `mcp` key with `type: "local"` and `command: [...]` (array, not string)
- JSON output uses `step_start`/`text`/`tool_use`/`step_finish` events
- Supports 75+ providers including DeepSeek, Anthropic, OpenAI, Gemini, Ollama
- Timeout is idle-based: resets whenever the process produces output
- Requires `DEEPSEEK_API_KEY` env var for DeepSeek provider

**Installation**: `npm i -g opencode-ai@latest` or `curl -fsSL https://opencode.ai/install | bash`

### Mock Backend

In-process backend for testing. Uses AI SDK `MockLanguageModelV3` with real MCP tools.

```yaml
agents:
  alice:
    backend: mock        # no model field required
    system_prompt: You are Alice.
```

---

## CLI Comparison

| Feature | Cursor | Claude | Codex | OpenCode | Mock |
|---------|--------|--------|-------|----------|------|
| Command | `cursor-agent` | `claude` | `codex exec` | `opencode run` | (in-process) |
| Auto-approval | `--force --approve-mcps` | `--dangerously-skip-permissions` | `--full-auto` | (auto in run mode) | N/A |
| MCP config format | JSON | JSON | YAML | JSON | Direct socket |
| MCP config location | `.cursor/mcp.json` | `--mcp-config <path>` | `.codex/config.yaml` | `opencode.json` | N/A |
| System prompt | (in message) | `--append-system-prompt` | (in message) | (in message) | `system` param |
| Session resume | No | `--continue` / `--resume` | `--resume` | No | N/A |
| Default idle timeout | 600s | 600s | 600s | 600s | N/A |

---

## Agent Identity in Workflows

CLI backends propagate agent identity through MCP:

```
Backend.setWorkspace(dir, mcpConfig)
  → CLI starts, reads MCP config
  → Spawns agent-worker mcp-stdio subprocess with --agent <name>
  → Subprocess connects to Unix socket with X-Agent-Id header
  → MCP tools use agentId as message sender
```

Parser validation: CLI backends (`claude`, `cursor`, `codex`, `opencode`, `mock`) do NOT require `model` in YAML. Only `sdk` requires it.

---

## Backend Setup for E2E Testing

Each backend needs specific installation and configuration before E2E tests can use it.

### Claude Code
```bash
# Install (recommended — auto-updates)
curl -fsSL https://claude.ai/install.sh | bash
# Or: brew install --cask claude-code

# Required env (native Anthropic)
export ANTHROPIC_API_KEY="sk-ant-..."

# Alternative: use DeepSeek via Anthropic-compatible endpoint
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_MODEL="deepseek-chat"
```

### Codex CLI
```bash
# Install
npm i -g @openai/codex
# Or: brew install --cask codex

# Required env — Codex requires Responses API (wire_api="responses")
# Option 1: Vercel AI Gateway (recommended — $0.10/$0.40 per M tokens, $5/month free)
export AI_GATEWAY_API_KEY="..."
# E2E model: google/gemini-2.0-flash (cheapest with full tool use support)
# Option 2: OpenAI directly
export OPENAI_API_KEY="sk-..."
# Note: DeepSeek not compatible (no Responses API support)

# ~/.codex/config.toml for Vercel AI Gateway:
# model = "google/gemini-2.0-flash"
# model_provider = "vercel"
# [model_providers.vercel]
# name = "Vercel AI Gateway"
# base_url = "https://ai-gateway.vercel.sh/v1"
# env_key = "AI_GATEWAY_API_KEY"
# wire_api = "responses"
```

### Cursor Agent
```bash
# Install (command installs as `agent`, also available as `cursor-agent`)
curl -fsS https://cursor.com/install | bash

# Required env — get key from https://cursor.com/dashboard?tab=background-agents
export CURSOR_API_KEY="sk_..."
# Or authenticate interactively: agent login
# Note: Requires paid Cursor subscription (Pro $20/month minimum)
# Note: Cursor is locked to its own infrastructure, no third-party model support
```

### OpenCode
```bash
# Install (recommended — auto-updates)
curl -fsSL https://opencode.ai/install | bash
# Or: npm i -g opencode-ai@latest
# Or: brew install anomalyco/tap/opencode

# Required env (for DeepSeek provider)
export DEEPSEEK_API_KEY="sk-..."
```

### Quick availability check
```bash
# Check all backends
npx agent-worker backends
```
