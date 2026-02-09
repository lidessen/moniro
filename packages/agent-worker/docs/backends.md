# Backend Reference

Agent-worker supports multiple backends with different capabilities.

## Feature Matrix

| Feature | SDK | Claude CLI | Codex CLI | Cursor CLI | Mock |
|---------|-----|------------|-----------|------------|------|
| **Messaging** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Conversation history** | ✅ | ⚠️ Simplified | ⚠️ Simplified | ⚠️ Simplified | ✅ |
| **Dynamic tools** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Tool mocking** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Approval system** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Skills (via tool)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Skills (filesystem)** | ❌ | ✅ | ✅ | ✅ | ❌ |
| **`--import-skill`** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Token usage** | ✅ | ⚠️ Limited | ⚠️ Limited | ⚠️ Limited | ✅ |
| **Export transcript** | ✅ | ✅ | ✅ | ✅ | ✅ |

**Legend**: ✅ Full | ⚠️ Partial | ❌ Not supported

## When to Choose

| Backend | Best For |
|---------|----------|
| **SDK** (default) | Full control, tool injection, mocking, `--import-skill`, programmatic usage |
| **Claude CLI** | Existing Claude installation, native Claude experience, MCP server support |
| **Codex CLI** | OpenAI Codex workflows |
| **Cursor CLI** | Cursor Agent integration |
| **Mock** | Testing workflows without real LLM API calls |

---

## CLI Backend Details

All CLI backends share this architecture:

```
Workflow YAML (backend: cursor|claude|codex)
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

| Feature | Cursor | Claude | Codex | Mock |
|---------|--------|--------|-------|------|
| Command | `cursor-agent` | `claude` | `codex exec` | (in-process) |
| Auto-approval | `--force --approve-mcps` | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | N/A |
| MCP config format | JSON | JSON | YAML | Direct socket |
| MCP config location | `.cursor/mcp.json` | `--mcp-config <path>` | `.codex/config.yaml` | N/A |
| System prompt | (in message) | `--append-system-prompt` | (in message) | `system` param |
| Session resume | No | `--continue` / `--resume` | `--resume` | N/A |
| Default idle timeout | 300s | 300s | 300s | N/A |

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

Parser validation: CLI backends (`claude`, `cursor`, `codex`, `mock`) do NOT require `model` in YAML. Only `sdk` requires it.
