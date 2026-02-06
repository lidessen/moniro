# CLI Backend Parameter Reference

Technical reference for Cursor, Claude Code, and Codex CLI backends.
Use this as the source of truth when updating tests or adding new CLI parameters.

---

## Architecture Overview

```
Workflow YAML (backend: cursor|claude|codex)
    │
    ▼
getBackendByType() → CLIAdapterBackend
    │
    ├── setWorkspace(workspaceDir, mcpConfig)  ← writes MCP config to workspace
    │
    └── send(prompt, { system })               ← executes CLI command
         │
         └── buildCommand/buildArgs → execa(command, args, { cwd, stdin, timeout })
```

All CLI backends:
1. Run in an **isolated workspace directory** (not the user's project dir)
2. Have MCP config written to their workspace via `setWorkspace()`
3. Use `execa` with `stdin: 'ignore'` to prevent hanging
4. Parse stdout for response content

---

## Cursor (`cursor-agent`)

**Source**: `src/backends/cursor.ts`
**Docs**: https://docs.cursor.com/context/model-context-protocol

### Command

```
cursor-agent -p --force --approve-mcps <message> [--model <model>]
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `-p` | Yes | Non-interactive print mode |
| `--force` | Yes | Auto-approve all operations (required for non-interactive) |
| `--approve-mcps` | Yes | Auto-approve MCP servers (required for workflow MCP tools) |
| `--model <model>` | No | Model to use (default: `sonnet-4.5`) |

### MCP Configuration

- **Format**: JSON
- **Path**: `<workspace>/.cursor/mcp.json`
- **Content structure**:
  ```json
  {
    "mcpServers": {
      "workflow-context": {
        "type": "stdio",
        "command": "agent-worker",
        "args": ["context", "mcp-stdio", "--socket", "<socketPath>", "--agent", "<agentName>"]
      }
    }
  }
  ```

### Options (`CursorOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `sonnet-4.5` | Model identifier |
| `cwd` | `string` | workspace or cwd | Working directory |
| `workspace` | `string` | - | Workspace dir (contains `.cursor/mcp.json`) |
| `timeout` | `number` | `120000` (2 min) | Timeout in ms |

### Model Map (`CURSOR_MODEL_MAP`)

| Input | Resolved |
|-------|----------|
| `sonnet` | `sonnet-4.5` |
| `opus` | `opus-4.5` |
| `sonnet-4.5` | `sonnet-4.5` |
| `opus-4.5` | `opus-4.5` |
| `opus-4.6` | `opus-4.6` |
| `claude-sonnet-4-5` | `sonnet-4.5` |
| `claude-opus-4-5` | `opus-4.5` |
| `gpt-5.2` | `gpt-5.2` |
| `gpt-5.1` | `gpt-5.1-high` |
| `gemini-pro` | `gemini-3-pro` |
| `gemini-flash` | `gemini-3-flash` |
| `auto` | `auto` |

### Availability Check

Tries both `cursor-agent --version` and `agent --version` (5s timeout).

### Gotchas

- **stdin must be `'ignore'`**: cursor-agent hangs if stdin is inherited or piped
  (see: https://forum.cursor.com/t/node-js-spawn-with-cursor-agent-hangs-and-exits-with-code-143-after-timeout/133709)
- **No system prompt flag**: System prompt is embedded in the message prompt itself
- **Response format**: Plain text stdout only (no JSON mode)
- **Shorter timeout**: 2 min default vs 5 min for others (cursor-agent is faster)

---

## Claude Code (`claude`)

**Source**: `src/backends/claude-code.ts`
**Docs**: https://docs.anthropic.com/en/docs/claude-code

### Command

```
claude -p --dangerously-skip-permissions <message> [--model <model>] [--mcp-config <path>] [--append-system-prompt <prompt>] [--output-format <format>] [--allowed-tools <tools>] [--continue] [--resume <id>]
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `-p` | Yes | Non-interactive print mode |
| `--dangerously-skip-permissions` | Yes | Auto-approve all operations (required for workflow MCP tools) |
| `--model <model>` | No | Model to use (default: `sonnet`) |
| `--mcp-config <path>` | No | Path to MCP config JSON file |
| `--append-system-prompt <text>` | No | Additional system prompt text |
| `--output-format <format>` | No | `text` \| `json` \| `stream-json` |
| `--allowed-tools <tools>` | No | Comma-separated permission rule list |
| `--continue` | No | Continue most recent conversation |
| `--resume <id>` | No | Resume specific session by ID |

### MCP Configuration

- **Format**: JSON (same as Cursor, but via `--mcp-config` flag, not project-level)
- **Path**: `<workspace>/mcp-config.json`
- **Delivery**: `--mcp-config <path>` flag (per-invocation)
- **Content structure**:
  ```json
  {
    "mcpServers": {
      "workflow-context": {
        "type": "stdio",
        "command": "agent-worker",
        "args": ["context", "mcp-stdio", "--socket", "<socketPath>", "--agent", "<agentName>"]
      }
    }
  }
  ```

### Options (`ClaudeCodeOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `sonnet` | Model identifier |
| `appendSystemPrompt` | `string` | - | Additional system prompt |
| `allowedTools` | `string[]` | - | Allowed tools (permission syntax) |
| `outputFormat` | `'text' \| 'json' \| 'stream-json'` | - | Output format |
| `continue` | `boolean` | - | Continue most recent conversation |
| `resume` | `string` | - | Resume session by ID |
| `cwd` | `string` | workspace or cwd | Working directory |
| `workspace` | `string` | - | Workspace directory |
| `timeout` | `number` | `300000` (5 min) | Timeout in ms |
| `mcpConfigPath` | `string` | - | MCP config file path |

### Model Map (`CLAUDE_MODEL_MAP`)

| Input | Resolved |
|-------|----------|
| `sonnet` | `sonnet` |
| `opus` | `opus` |
| `haiku` | `haiku` |
| `sonnet-4.5` | `sonnet` |
| `opus-4.5` | `opus` |
| `claude-sonnet-4-5` | `sonnet` |
| `claude-opus-4` | `opus` |
| `claude-haiku-3-5` | `haiku` |

### Response Parsing

- **text mode** (default): Returns `stdout.trim()`
- **json mode**: Parses JSON, extracts `content`, `toolCalls`, `usage`
- **stream-json**: Not specially parsed (falls through to text)

### Gotchas

- **MCP via flag**: Unlike Cursor/Codex, Claude uses `--mcp-config` flag, not project-level config
- **`setMcpConfigPath()`**: Alternative to `setWorkspace()` for direct MCP config path
- **System prompt**: Via `--append-system-prompt` flag (appends, doesn't replace)
- **JSON response**: `{ content, result, toolCalls, usage }` — tries `content` then `result` then raw

---

## Codex (`codex`)

**Source**: `src/backends/codex.ts`
**Docs**: https://github.com/openai/codex

### Command

```
codex exec --dangerously-bypass-approvals-and-sandbox <message> [--model <model>] [--json] [--skip-git-repo-check] [--approval-mode <mode>] [--resume <id>]
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `exec` | Yes | Non-interactive execution mode (subcommand) |
| `--dangerously-bypass-approvals-and-sandbox` | Yes | Auto-approve all operations |
| `--model <model>` | No | Model to use (default: `gpt-5.2-codex`) |
| `--json` | No | Output as JSON events |
| `--skip-git-repo-check` | No | Skip git repository validation |
| `--approval-mode <mode>` | No | `suggest` \| `auto-edit` \| `full-auto` |
| `--resume <id>` | No | Resume a previous session |

### MCP Configuration

- **Format**: YAML (not JSON!)
- **Path**: `<workspace>/.codex/config.yaml`
- **Key name**: `mcp_servers` (snake_case, not camelCase)
- **Content structure**:
  ```yaml
  mcp_servers:
    workflow-context:
      type: stdio
      command: agent-worker
      args:
        - context
        - mcp-stdio
        - --socket
        - <socketPath>
        - --agent
        - <agentName>
  ```
- **Conversion**: `mcpServers` (JS) → `mcp_servers` (YAML) via `yaml.stringify()`

### Options (`CodexOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `gpt-5.2-codex` | Model identifier |
| `json` | `boolean` | - | Output as JSON events |
| `cwd` | `string` | workspace or cwd | Working directory |
| `workspace` | `string` | - | Workspace directory |
| `skipGitRepoCheck` | `boolean` | - | Skip git repo check |
| `approvalMode` | `'suggest' \| 'auto-edit' \| 'full-auto'` | - | Approval mode |
| `resume` | `string` | - | Resume session ID |
| `timeout` | `number` | `300000` (5 min) | Timeout in ms |

### Model Map (`CODEX_MODEL_MAP`)

| Input | Resolved |
|-------|----------|
| `gpt-5.2-codex` | `gpt-5.2-codex` |
| `gpt-5.2` | `gpt-5.2-codex` |
| `o3` | `o3` |
| `o3-mini` | `o3-mini` |

### Response Parsing

- **text mode** (default): Returns `stdout.trim()`
- **json mode**: Parses NDJSON (newline-delimited JSON events), extracts last event's `message`, `content`, `toolCalls`, `usage`

### Gotchas

- **Subcommand**: Uses `codex exec` (not just `codex`)
- **YAML config**: Only backend using YAML for MCP config (uses `yaml` npm package)
- **snake_case**: Config key is `mcp_servers`, not `mcpServers`
- **NDJSON response**: JSON mode returns newline-delimited events, not a single JSON object

---

## Mock Backend

**Source**: `src/backends/mock.ts`
**No external CLI dependency**

### Purpose

Integration testing of workflow execution and MCP tools without real LLM API calls.
Uses AI SDK v6 `MockLanguageModelV3` with real MCP tool execution.

### Architecture

```
MockAIBackend.run(ctx)
    │
    ├── UnixSocketMCPTransport   ← connects directly to Unix socket
    │     sends X-Agent-Id header for identity
    │
    ├── createMCPToolBridge()    ← wraps MCP tools as AI SDK tool()
    │
    └── generateText()           ← AI SDK agentic loop with MockLanguageModelV3
          model: MockLanguageModelV3 (scripted responses)
          tools: real MCP tools via bridge
          stopWhen: stepCountIs(3)
```

### Key Types

```typescript
// AI SDK v6 MockLanguageModelV3 result shape
{
  content: LanguageModelV3Content[]  // text | tool-call | ...
  finishReason: { unified: 'stop' | 'tool-calls', raw: string }
  usage: {
    inputTokens: { total, noCache, cacheRead, cacheWrite }
    outputTokens: { total, text, reasoning }
  }
}
```

### Workflow YAML

```yaml
agents:
  alice:
    backend: mock        # no model field required
    system_prompt: You are Alice.
```

---

## Comparison Table

| Feature | Cursor | Claude | Codex | Mock |
|---------|--------|--------|-------|------|
| Command | `cursor-agent` | `claude` | `codex exec` | (in-process) |
| Non-interactive flag | `-p` | `-p` | `exec` | N/A |
| Auto-approval flag | `--force --approve-mcps` | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | N/A |
| MCP config format | JSON | JSON | YAML | Direct socket |
| MCP config location | `.cursor/mcp.json` | `--mcp-config <path>` | `.codex/config.yaml` | N/A |
| MCP config key | `mcpServers` | `mcpServers` | `mcp_servers` | N/A |
| System prompt | (in message) | `--append-system-prompt` | (in message) | `system` param |
| JSON output | No | `--output-format json` | `--json` | N/A |
| Session resume | No | `--continue` / `--resume` | `--resume` | N/A |
| Default timeout | 120s | 300s | 300s | N/A |
| Default model | `sonnet-4.5` | `sonnet` | `gpt-5.2-codex` | `mock-model` |
| Model required in YAML | No | No | No | No |
| stdin handling | `'ignore'` | `'ignore'` | `'ignore'` | N/A |

---

## Workflow Integration

### MCP Config Generation (`backend.ts:generateWorkflowMCPConfig`)

All CLI backends use the same MCP bridge command:

```
agent-worker context mcp-stdio --socket <socketPath> --agent <agentName>
```

The `--agent <agentName>` flag is critical for agent identity propagation.

### Agent Identity Flow

```
CLI Backend
  → setWorkspace(dir, mcpConfig)         # mcpConfig includes --agent flag
  → CLI starts, reads MCP config
  → Spawns agent-worker mcp-stdio subprocess
  → Subprocess connects to Unix socket
  → Sends X-Agent-Id: <agentName>
  → transport.sessionId = agentName       # set in transport.ts
  → MCP SDK passes sessionId to tool handlers as extra.sessionId
  → getAgentId(extra) returns agentName
  → channel_send uses agentName as "from"
```

### Parser Validation

CLI backends (`claude`, `cursor`, `codex`, `mock`) do NOT require an explicit `model` field in workflow YAML.
Only the `sdk` backend requires `model`.

```typescript
// parser.ts
const CLI_BACKENDS = ['claude', 'cursor', 'codex', 'mock']
```
