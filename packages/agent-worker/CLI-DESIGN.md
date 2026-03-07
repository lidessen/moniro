# agent-worker CLI Design

## Object Model

Four entities, clear ownership and lifecycle:

```
Entity              Truth Source             Lifecycle              Context Location
─────────────────── ──────────────────────── ────────────────────── ──────────────────────────────────
Config Agent        config.yml               daemon up/down         global workspace (personal + shared)
Ephemeral Agent     daemon memory            new/rm                 global workspace (shared only)
Workspace           workspace definition     run (exits) / start    workspaces/<name>/ or <name>@<tag>/
Channel Bridge      config.yml / workspace   follows owner          N/A (adapter, no state)
```

### Config Agent (persistent)

- Defined in `~/.agent-worker/config.yml` (the ONLY source of truth)
- Auto-started when daemon boots (`up`)
- Cannot be `rm`'d — edit config.yml to add/remove
- Has personal context (memory, notes, todos, conversations) persisted to disk

### Ephemeral Agent (temporary)

- Created via `new`, exists only in daemon memory
- `rm` stops loop + removes from registry — no disk cleanup needed
- Lost on daemon restart
- No personal context persistence (no memory/notes/todos on disk)

### Workspace & Context

`~/.agent-worker/` IS the global workspace directly. No nesting.

**Global workspace** (personal agents live here):

```
~/.agent-worker/
  config.yml                                     # Agent + channel definitions
  channel.jsonl                                  # SHARED: all agents see this
  documents/                                     # SHARED: team documents
  _state/                                        # SHARED: cursors, locks, proposals
  agents/                                        # PER-AGENT: personal context
    alice/
      memory/                                    #   structured key-value (YAML)
      notes/                                     #   freeform reflections (markdown)
      conversations/                             #   conversation history (JSONL)
      todo/                                      #   cross-session task tracking
    bob/
      memory/
      notes/
      conversations/
      todo/
```

**Other workspaces** (from workspace definition files):

```
~/.agent-worker/workspaces/
  review/                                        # workspace "review" (no tag)
    channel.jsonl
    documents/
    agents/
      ...
  review@pr-123/                                 # workspace "review" with tag "pr-123"
    channel.jsonl
    ...
  monitor/                                       # workspace "monitor" (no tag)
    ...
```

- Tag is optional (nullable). Default is no tag — the workspace name IS the directory.
- When tag is specified: `<name>@<tag>/` (flat, @ separator)
- Workspace definitions that specify a custom directory use that path instead
- `.agents/` directory pattern is fully deprecated — no migration, no compatibility

**Two layers of context**:

- **Shared layer**: channel, documents — all agents in the workspace see the same data
- **Personal layer**: memory, notes, todos, conversations — per-agent, persisted across restarts
- Ephemeral agents use the shared layer but have no personal directory

### Interaction Semantics

- `ask alice "hello"` — Direct request to agent, streaming response (request/response pattern)
- `send alice "hello"` — Post to shared channel with `@alice` mention (async, agent picks up when ready)
- `send @global "update"` — Broadcast to shared channel, no specific mention
- `peek` — Read shared channel message log

`ask` is synchronous dialogue. `send` is asynchronous messaging via the shared channel.

### Terminology

- **Workspace** — user-facing term. The YAML file is a "workspace definition". The runtime environment is a "workspace". CLI commands, docs, and directory names all use "workspace".
- **Workflow** — internal/legacy term. Code internals (parser, runner) may still use "workflow" but this is not exposed to users.

---

## Three Usage Modes

| Mode | Example | Lifecycle | Agent Source |
|------|---------|-----------|--------------|
| 1. Personal Agent | OpenClaw | always-on daemon, persistent | config.yml |
| 2. Temp A2A Testing | agent-browser | transient, one-shot | API (`new`) |
| 3. Workspaces | code review | single-run or long-running | workspace definition YAML |

---

## Command Reference

### Lifecycle

```
agent-worker onboard                        # Interactive config.yml setup
agent-worker up                             # Start daemon (background), load config.yml
agent-worker up -f                          # Start daemon (foreground, for debugging)
agent-worker down                           # Stop daemon (all agents + workspaces)
agent-worker status                         # Show daemon status, running agents/workspaces
```

### Interaction

```
agent-worker ask <agent> <message>          # Direct request, streaming response
agent-worker ask <agent> <message> --no-stream  # Sync response (replaces `serve`)
agent-worker send <target> <message>        # Post to channel (async, @mention routing)
agent-worker peek [target]                  # Read channel messages
```

### Agent Management

```
agent-worker ls                             # List running agents
agent-worker new <name> [options]           # Create temp agent (always ephemeral)
agent-worker rm <name>                      # Remove temp agent
```

`rm` only works on ephemeral agents. Config agents cannot be removed via CLI:

```
$ agent-worker rm alice
Error: "alice" is defined in config.yml — edit config to remove
```

### Workspaces

```
agent-worker run <file> [-- params]         # Single-run (exits on complete)
agent-worker start <file> [-- params]       # Long-running (via daemon)
agent-worker stop @<name>                   # Stop workspace (no tag)
agent-worker stop @<name>:<tag>             # Stop workspace (with tag)
```

### Info

```
agent-worker providers                      # Check provider API keys
agent-worker backends                       # Check available backends
```

---

## Target Addressing

```
alice                   → agent "alice" in global workspace
alice@review            → agent "alice" in workspace "review" (no tag)
alice@review:pr-123     → agent "alice" in workspace "review", tag "pr-123"
@review                 → workspace "review" (no tag, all agents)
@review:pr-123          → workspace "review", tag "pr-123" (all agents)
```

- Bare name (`alice`) → global workspace agent
- `agent@workspace` → specific agent in a named workspace
- `agent@workspace:tag` → specific agent in a tagged workspace instance
- `@workspace` / `@workspace:tag` → workspace-level (broadcast / all agents)

Tag is nullable. No default tag — omitting tag means "the workspace itself", not "tag=main".

CLI uses `:` as separator (Docker `image:tag` convention). Directory names use `@` instead (`review@pr-123/`) because `:` is not valid in filenames on some systems.

---

## Changes from Current CLI

| Change | Before | After | Reason |
|--------|--------|-------|--------|
| Add `onboard` | (none) | `onboard` | Interactive config.yml scaffolding |
| `daemon` -> `up`/`down` | `daemon`, `stop --all` | `up`, `down` | User thinks "start my system" |
| Remove `serve` | `ask` + `serve` | `ask` + `ask --no-stream` | Same thing, different transport |
| Remove `agent *` subgroup | `agent create/list/info/delete` | (removed) | .agents/ fully deprecated |
| `stop` agent -> `rm` | `stop alice` | `rm alice` | Disambiguate from workspace `stop` |
| `new` always ephemeral | `new --ephemeral` | `new` (always ephemeral) | Persistent agents go in config.yml |
| Remove `--workflow/--tag` from `new` | `new --workflow review` | (removed) | Ephemeral agents always join global |
| Workflow -> Workspace | `@workflow:tag` | `@workspace` or `@workspace:tag` | Unified terminology |
| Tag nullable | tag defaults to "main" | tag is optional/nullable | No tag = the workspace itself |
| Global workspace = `~/.agent-worker/` | `~/.agent-worker/.workflow/global/main/` | `~/.agent-worker/` | No redundant nesting |
| Other workspaces | `.workflow/<name>/<tag>/` | `workspaces/<name>/` or `<name>@<tag>/` | Cleaner, flat with @ for tags |
| Deprecate `.agents/` | `.agents/*.yaml` + context dirs | (removed) | config.yml is sole truth source |
| Agent context -> workspace | `.agents/<name>/` | `<workspace>/agents/<name>/` | Personal context under workspace |

---

## Implementation Notes

### AgentRegistry Simplification

`AgentRegistry` becomes a pure in-memory runtime registry:

- Remove `loadFromDisk()` — no more .agents/*.yaml discovery
- Remove `create()` — no more writing YAML files
- Remove `delete()` disk cleanup — `rm` only unregisters + stops loop
- Remove `agentsDir`, `agentYamlPath()` — no more .agents/ paths
- Change `resolveContextDir()` — personal context at `<workspace>/agents/<name>/`
- Keep: `registerDefinition()`, `registerEphemeral()`, `get()`, `has()`, `list()`, `size`

`AgentHandle.contextDir` is resolved per workspace:
- Global workspace agent: `~/.agent-worker/agents/<name>/`
- Named workspace agent: `~/.agent-worker/workspaces/<ws>/agents/<name>/`
- Tagged workspace agent: `~/.agent-worker/workspaces/<ws>@<tag>/agents/<name>/`

Ephemeral agents get no `contextDir` (no personal context).

### Files to Delete

- `packages/agent-worker/src/agent/yaml-parser.ts` — dead (.agents/*.yaml parsing)
- `agent *` CLI subcommand group in `commands/agent.ts` — dead
- `packages/agent-worker/src/daemon/workspace-registry.ts` — already deleted

### Workspace Terminology Migration

User-facing rename (CLI, docs, error messages):
- "workflow" → "workspace"
- "workflow YAML" → "workspace definition"
- `@workflow:tag` → `@workspace` or `@workspace:tag` (`:` separator unchanged)

Internal code can keep "workflow" names for now (parser, runner, types) — rename incrementally.

---

## Usage Flows

### Mode 1: Personal Agent

```bash
# First time
agent-worker onboard                         # Creates ~/.agent-worker/config.yml
agent-worker up                              # Starts daemon, auto-starts agents

# Daily use
agent-worker ask alice "summarize my emails"  # Direct (streaming response)
agent-worker send alice "check PR #42"        # Async (posted to channel)
agent-worker peek                             # Read channel history

# Management
agent-worker status                          # What's running
agent-worker down                            # Shut down
```

### Mode 2: Temp A2A Testing

```bash
agent-worker new test-bot -m openai/gpt-4 -s "You are a test agent"
agent-worker ask test-bot "run browser test"
agent-worker rm test-bot
```

### Mode 3a: Single-run Workspace

```bash
agent-worker run review.yaml -- --target main
# Runs to completion, prints results, exits
```

### Mode 3b: Long-running Workspace

```bash
agent-worker start monitor.yaml
agent-worker peek @monitor
agent-worker stop @monitor
```

---

## `onboard` Flow (Draft)

```
$ agent-worker onboard

Welcome to agent-worker!

Agent name [alice]:
Model [anthropic/claude-sonnet-4-5]:
System prompt: You are my personal assistant.

Add a channel? (telegram/slack/none) [none]: telegram
Bot token env var [$TELEGRAM_BOT_TOKEN]:
Chat ID env var [$TELEGRAM_CHAT_ID]:

Created: ~/.agent-worker/config.yml

  agents:
    alice:
      model: anthropic/claude-sonnet-4-5
      system_prompt: You are my personal assistant.
  channels:
    - adapter: telegram
      bot_token: ${TELEGRAM_BOT_TOKEN}
      chat_id: ${TELEGRAM_CHAT_ID}

Start with: agent-worker up
```

---

## `up` Behavior

1. If daemon already running: print status, exit
2. Spawn daemon process in background (detached)
3. Daemon loads `~/.agent-worker/config.yml`
4. Auto-creates and starts all agents from config (with personal context dirs)
5. If channels configured: creates workspace eagerly, starts channel bridges
6. Print summary: agents started, channels connected

`up -f` runs in foreground (current `daemon` behavior, useful for debugging).

---

## `new` Options

```
agent-worker new <name>
  -m, --model <model>         Model identifier
  -b, --backend <type>        Backend (sdk/claude/codex/cursor/mock)
  -s, --system <prompt>       System prompt
  -f, --system-file <file>    System prompt from file
  --provider <name>           Provider SDK name
  --base-url <url>            Override base URL
  --api-key <ref>             API key env var
  --wakeup <schedule>         Periodic wakeup
  --wakeup-prompt <text>      Wakeup prompt
  --json                      JSON output
```

Removed: `--ephemeral` (always ephemeral), `--workflow/--tag` (ephemeral agents always join global), `--port`/`--host` (use `up` to configure daemon).

---

## Decisions (Closed)

1. **`rm` does NOT work on config.yml agents.** Persistent agents are managed by editing config.yml. `rm` is strictly for ephemeral agents created with `new`.

2. **`.agents/` is fully deprecated.** No migration path, no backward compatibility. config.yml is the sole source of truth for persistent agents.

3. **Per-agent personal context exists, under workspace.** Agents have individual memory/notes/todos/conversations at `<workspace>/agents/<name>/`. The shared workspace (channel, documents) is separate from personal context.

4. **`ask` vs `send` are distinct operations.** `ask` = synchronous request/response. `send` = asynchronous message to channel.

5. **Ephemeral agents cannot join workspaces.** `new` creates agents in the global workspace only. Workspace agents are defined by workspace definition YAML files.

6. **"Workspace" is the user-facing term.** "Workflow" is internal/legacy. YAML files are "workspace definitions".

7. **Tag is nullable.** No default tag. Omitting tag means the workspace itself. CLI target uses `:` separator (`@review:pr-123`). Directory uses `@` separator (`review@pr-123/`) because `:` is invalid in filenames on some systems.

8. **`~/.agent-worker/` IS the global workspace.** No `.workflow/global/main/` nesting.

---

## Open Questions

1. Should `up` without config.yml auto-run `onboard`?
2. `ask` without daemon — auto-run `up` first? (current `new` does this)
3. Should `onboard` support adding multiple agents?
