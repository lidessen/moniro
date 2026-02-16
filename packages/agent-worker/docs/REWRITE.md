# Rewrite Design

Starting from established decisions (three-tier architecture, SQLite, subprocess, structured messages), redesign the entire system. Not constrained by existing implementation.

Rewrite order: **Daemon → Worker → Interface**. Interface follows the Daemon.

**Related decisions**:
- [Three-Tier Architecture](../../../.memory/decisions/2026-02-16-three-tier-architecture.md)
- [Technology Choices](../../../.memory/decisions/2026-02-16-technology-choices.md)

---

## Part 0: Product Form (What to Keep)

The rewrite changes the implementation, not the product. What the user sees should be preserved.

### CLI Commands

```bash
# Agent lifecycle
agent-worker new <name> [--model] [--backend] [--system]
agent-worker list
agent-worker stop <target>
agent-worker info <name>

# Conversation (single agent)
agent-worker ask <agent> <message>       # SSE streaming
agent-worker serve <agent> <message>     # JSON response

# Workflow (multi-agent)
agent-worker run <workflow.yaml> [--tag]
agent-worker start <workflow.yaml> [--tag] [--background]
agent-worker stop <target>

# Messages
agent-worker send <target> <message>
agent-worker peek [target]

# Documents
agent-worker doc read [--file]
agent-worker doc write <content> [--file]

# Scheduling
agent-worker schedule <target> set <interval>
agent-worker schedule <target> clear
```

### Workflow YAML

```yaml
name: code-review

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md
    schedule: 30s              # polling interval
    backend: default           # sdk | claude | codex | cursor | mock

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

context:
  provider: sqlite             # default
  documentOwner: reviewer      # optional single-writer

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  PR diff: ${{ diff }}
  @reviewer please review.
```

### MCP Tools (Daemon MCP, exposed to workers)

```
Channel:    channel_send, channel_read
Inbox:      my_inbox, my_inbox_ack
Status:     my_status_set
Team:       team_members
Document:   team_doc_read, team_doc_write, team_doc_append, team_doc_create, team_doc_list
Proposal:   team_proposal_create, team_vote, team_proposal_status, team_proposal_cancel
Resource:   resource_create, resource_read
```

### Target Syntax

```
alice                → alice@global:main
alice@review         → alice@review:main
alice@review:pr-123  → full specification
@review:pr-123       → workflow:tag scope
```

---

## Part 1: Daemon (Kernel)

Single process, single SQLite file, the sole authority for all state.

### Responsibilities

```
Daemon
├── Database        ── SQLite, system state (messages, proposals, agents, workflows)
├── Registry        ── agent/workflow registration, configuration
├── Scheduler       ── decides when (poll, cron, wake)
├── Context         ── decides what (channel, inbox, proposal)
├── Documents       ── pluggable provider (file or sqlite)
├── ProcessManager  ── decides how (spawn, kill, monitor child processes)
├── MCP Server      ── context + document tools, worker connections
└── HTTP Server     ── interface API, CLI/Web connections
```

### SQLite Schema

```sql
-- Daemon self-state
CREATE TABLE daemon_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Agent registration
CREATE TABLE agents (
  name        TEXT PRIMARY KEY,
  model       TEXT NOT NULL,
  backend     TEXT NOT NULL DEFAULT 'default',
  system      TEXT,              -- system prompt content
  workflow    TEXT NOT NULL DEFAULT 'global',
  tag         TEXT NOT NULL DEFAULT 'main',
  schedule    TEXT,              -- '30s', '5m', cron expression
  config_json TEXT,              -- extra config (mcp servers, tools, etc.)
  state       TEXT NOT NULL DEFAULT 'idle',  -- idle | running | stopped
  created_at  INTEGER NOT NULL
);

-- Workflow configuration
CREATE TABLE workflows (
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL,
  config_yaml TEXT,              -- original YAML (null for @global)
  state       TEXT NOT NULL DEFAULT 'running',  -- running | stopped
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (name, tag)
);

-- Messages (Channel + Inbox unified storage)
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  sender      TEXT NOT NULL,     -- agent name or 'system'
  content     TEXT NOT NULL,
  recipients  TEXT,              -- JSON array, @mention parsed at write time
  kind        TEXT NOT NULL DEFAULT 'message',  -- message | system | tool_call
  metadata    TEXT,              -- JSON, tool_call data etc.
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_messages_workflow ON messages(workflow, tag, created_at);

-- Inbox acknowledgment state (per agent per workflow)
CREATE TABLE inbox_ack (
  agent     TEXT NOT NULL,
  workflow  TEXT NOT NULL,
  tag       TEXT NOT NULL,
  cursor    TEXT NOT NULL,       -- last acked message id
  PRIMARY KEY (agent, workflow, tag)
);

-- NOTE: Documents are NOT in SQLite by default.
-- Documents use a separate pluggable DocumentProvider (see below).

-- Resources (large content)
CREATE TABLE resources (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  content     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text',  -- markdown | json | text | diff
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Proposals
CREATE TABLE proposals (
  id          TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  type        TEXT NOT NULL,     -- election | decision | approval | assignment
  title       TEXT NOT NULL,
  options     TEXT NOT NULL,     -- JSON array
  resolution  TEXT NOT NULL DEFAULT 'plurality',
  binding     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | resolved | expired | cancelled
  creator     TEXT NOT NULL,
  result      TEXT,              -- winning option
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE votes (
  proposal_id TEXT NOT NULL,
  agent       TEXT NOT NULL,
  choice      TEXT NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, agent),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id)
);

-- Worker process state
CREATE TABLE workers (
  agent       TEXT NOT NULL,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  pid         INTEGER,           -- OS process ID
  state       TEXT NOT NULL DEFAULT 'idle',  -- idle | running | dead
  started_at  INTEGER,
  last_heartbeat INTEGER,
  PRIMARY KEY (agent, workflow, tag)
);

-- Session history (optional, for agent conversation continuation)
CREATE TABLE sessions (
  agent       TEXT NOT NULL,
  workflow    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  messages    TEXT NOT NULL,     -- JSON array of conversation messages
  usage       TEXT,              -- JSON token usage
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (agent, workflow, tag)
);
```

### Document Storage (Independent Provider)

Documents are user-facing workspace content — agents write findings, goals, decisions. Unlike messages and proposals (internal system state that needs ACID), documents benefit from being real files on disk that users and tools can read/edit directly.

Document storage is pluggable via `DocumentProvider`, independent from the SQLite context store:

```typescript
interface DocumentProvider {
  read(workflow: string, tag: string, path: string): Promise<string | null>
  write(workflow: string, tag: string, path: string, content: string): Promise<void>
  append(workflow: string, tag: string, path: string, content: string): Promise<void>
  list(workflow: string, tag: string): Promise<string[]>
  create(workflow: string, tag: string, path: string, content: string): Promise<void>
}
```

| Provider | Storage | Use case |
|----------|---------|----------|
| **FileDocumentProvider** | `.workflow/<wf>/<tag>/documents/` | Default. Human-readable, editable by IDE/editor, git-friendly |
| **SqliteDocumentProvider** | `documents` table in SQLite | All-in-one. No filesystem footprint. Useful for ephemeral workflows |

Default is file-based. Configurable in workflow YAML:

```yaml
# Default: documents on filesystem
context:
  documents: file    # or omit — file is default

# All-in-one: documents in SQLite
context:
  documents: sqlite

# Custom path
context:
  documents:
    provider: file
    dir: ./my-docs/
```

**Ownership enforcement** lives in the daemon (not in the provider). The daemon checks ownership before calling `provider.write()`. This keeps providers simple — they're pure storage adapters.

**Why separate from SQLite?**

| | Messages/Proposals | Documents |
|--|-------------------|-----------|
| Nature | Internal system state | User-facing workspace content |
| Access pattern | Write-once, query-many | Read-write by agents and humans |
| Concurrency | Multiple writers, needs ACID | Usually single-writer (ownership) |
| Human readability | Not needed (CLI/MCP access) | Valuable (inspect, edit, diff, git) |
| Lifecycle | Permanent log | Evolving content |

### Daemon Startup Flow

```
daemon start
  │
  ├── Open/create SQLite (WAL mode)
  ├── Execute schema migration (if new database)
  ├── Restore agents + workflows from DB
  ├── Start HTTP server
  ├── Start MCP server
  ├── Write daemon.json (pid, host, port) ── used by Interface for discovery
  │
  ├── Restore running workflows:
  │   for each workflow where state = 'running':
  │     for each agent in workflow:
  │       scheduler.resume(agent)  ── resume scheduling
  │
  └── ready
```

### Daemon Shutdown Flow

```
daemon shutdown (SIGINT/SIGTERM)
  │
  ├── Stop all schedulers
  ├── Notify all worker child processes to exit (SIGTERM → wait → SIGKILL)
  ├── Update workers table (state = 'dead')
  ├── Close HTTP server
  ├── Close MCP server
  ├── Close SQLite
  └── Delete daemon.json
```

### Scheduler

One scheduler instance per agent. Scheduler decides **when**, ProcessManager executes **how**.

```
Scheduler(agent)
  │
  state: idle | waiting | triggered
  │
  ├── triggers:
  │   ├── inbox_poll    ── periodically check inbox (default 5s)
  │   ├── cron          ── cron expression
  │   ├── interval      ── fixed interval
  │   └── wake          ── external signal (triggered on @mention write)
  │
  └── on trigger:
        │
        ├── Query inbox:
        │   SELECT * FROM messages m
        │   LEFT JOIN inbox_ack a ON ...
        │   WHERE recipients LIKE '%"agent"%'
        │     AND (a.cursor IS NULL OR m.id > a.cursor)
        │
        ├── If messages exist OR cron/interval trigger:
        │   processManager.run(agent, context)
        │
        └── If no messages and poll trigger:
            sleep → next poll
```

### ProcessManager

Manages the lifecycle of worker child processes.

```
processManager.run(agent)
  │
  ├── Prepare worker config (only pass identity and connection info, not context data):
  │   {
  │     agent: { name, model, backend, system },
  │     daemon_mcp_url: "http://localhost:<port>/mcp?agent=<name>",
  │     worker_mcp_configs: [...],   ── agent's own MCP server configs
  │   }
  │
  │   ❌ Do not pass inbox, channel, document
  │   ✅ Worker fetches on demand via Daemon MCP after startup:
  │      my_inbox() → channel_read() → team_doc_read()
  │
  ├── Spawn child process:
  │   fork('worker-entry.ts', { env: { WORKER_CONFIG: JSON.stringify(config) } })
  │   or
  │   spawn(['claude', '--mcp-config', ...])   ── CLI backend
  │
  ├── Listen to child process:
  │   on 'message' → IPC communication (heartbeat, intermediate results)
  │   on 'exit'    → handle result
  │
  ├── Timeout protection:
  │   setTimeout → if timeout, SIGTERM → SIGKILL
  │
  └── On completion:
      ├── Success → ack inbox, write response to channel
      ├── Failure → retry (exponential backoff, max 3)
      └── Update workers table
```

### @mention Parsing at Write Time

`channel_send` is the sole entry point for writing messages. Daemon is responsible for parsing @mentions.

```typescript
// daemon internal
function channelSend(sender: string, content: string, workflow: string, tag: string) {
  // 1. Parse @mentions
  const recipients = parseMentions(content)  // ["reviewer", "all", ...]

  // 2. Expand @all
  if (recipients.includes('all')) {
    recipients = getAllAgents(workflow, tag)
  }

  // 3. Auto-convert long messages to resource
  let finalContent = content
  if (content.length > THRESHOLD) {
    const resourceId = createResource(content, sender, workflow, tag)
    finalContent = `[See resource: ${resourceId}]`
  }

  // 4. Write to messages table
  const id = nanoid()
  db.run(`INSERT INTO messages (id, workflow, tag, sender, content, recipients, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, workflow, tag, sender, finalContent, JSON.stringify(recipients), Date.now())

  // 5. Trigger wake (if any recipient's scheduler is waiting)
  for (const r of recipients) {
    scheduler.wake(r)
  }

  return id
}
```

### Inbox Query

```sql
-- Get agent's unread messages
SELECT m.* FROM messages m
LEFT JOIN inbox_ack a
  ON a.agent = ? AND a.workflow = m.workflow AND a.tag = m.tag
WHERE m.workflow = ? AND m.tag = ?
  AND m.recipients LIKE ?         -- '%"reviewer"%' (JSON contains)
  AND (a.cursor IS NULL OR m.created_at > (
    SELECT m2.created_at FROM messages m2 WHERE m2.id = a.cursor
  ))
ORDER BY m.created_at ASC;

-- Ack: update cursor
INSERT OR REPLACE INTO inbox_ack (agent, workflow, tag, cursor)
VALUES (?, ?, ?, ?);
```

### Daemon MCP Server

Context tools exposed to workers. Each worker identifies itself via `?agent=<name>` when connecting.

```
Tool handlers are all thin wrappers over SQLite queries:

channel_send(message, to?)
  → channelSend(agent, message, workflow, tag)
  → parse @mention at write time

channel_read(since?, limit?)
  → SELECT FROM messages WHERE workflow = ? AND tag = ? ...

my_inbox()
  → inbox query (SQL above)

my_inbox_ack(until)
  → INSERT OR REPLACE INTO inbox_ack ...

team_doc_read(file?)
  → documentProvider.read(workflow, tag, file)

team_doc_write(content, file?)
  → check ownership → documentProvider.write(workflow, tag, file, content)

team_proposal_create(...)
  → INSERT INTO proposals ...

team_vote(proposal, choice, reason?)
  → INSERT INTO votes ...
  → check quorum → if reached, resolve proposal
```

### Daemon HTTP API

For the Interface layer. Separate entry point from MCP server, same data source.

```
GET  /health                → { pid, uptime, agents, workflows }
POST /shutdown              → graceful shutdown

POST /agents                → register agent
GET  /agents                → list agents
GET  /agents/:name          → agent info
DELETE /agents/:name        → delete agent

POST /run                   → execute agent (SSE stream)
POST /serve                 → execute agent (JSON response)

POST /workflows             → start workflow
GET  /workflows             → list workflows
DELETE /workflows/:key      → stop workflow

POST /send                  → send message to channel
GET  /peek                  → read recent channel

ALL  /mcp                   → Daemon MCP endpoint
```

---

## Part 2: Worker (Execution Unit)

Child process. Receives config, executes LLM conversation, returns result. Knows nothing about scheduling or lifecycle.

### Worker Entry Point

```typescript
// worker-entry.ts — child process entry point
// Forked/spawned by daemon processManager

const config = JSON.parse(process.env.WORKER_CONFIG)
// config = { agent: { name, model, backend, system }, daemon_mcp_url, worker_mcp_configs }
// ❌ config does not contain inbox/channel/document — all context fetched on demand via MCP

// 1. Connect to Daemon MCP (get context tools)
const daemonMCP = await connectDaemonMCP(config.daemon_mcp_url)

// 2. Connect to Worker MCP (own task tools, if any)
const workerTools = await connectWorkerMCPs(config.worker_mcp_configs)

// 3. Fetch context via Daemon MCP, build prompt
const inbox    = await daemonMCP.call('my_inbox')
const channel  = await daemonMCP.call('channel_read', { limit: 50 })
const document = await daemonMCP.call('team_doc_read')
const prompt   = buildPrompt({ ...config, inbox, channel, document })

// 4. Execute LLM session (LLM can also call MCP tools at any time during execution)
const result = await runSession({
  model: config.agent.model,
  backend: config.agent.backend,
  system: config.agent.system,
  prompt,
  tools: { ...daemonMCP.tools, ...workerTools },
})

// 5. Return result (IPC or stdout)
process.send?.({ type: 'result', data: result })
process.exit(0)
```

### Backend Adaptation

Worker internally selects execution method based on backend type:

```
backend = 'default' (SDK)
  → Vercel AI SDK generateText() + tool loop
  → directly uses daemonTools + workerTools

backend = 'claude'
  → spawn claude CLI as sub-subprocess
  → --mcp-config points to daemon MCP
  → itself is a subprocess of a subprocess

backend = 'codex' | 'cursor'
  → similar to claude, spawn corresponding CLI

backend = 'mock'
  → scripted responses, for testing
```

For CLI backends (claude/codex/cursor), worker-entry.ts is itself a thin wrapper: prepares the MCP config file, spawns the CLI process, waits for completion.

### Worker ↔ Daemon Communication

```
                     ┌──────────────────────────┐
                     │        Daemon             │
                     │                           │
           IPC ◄─────┤  ProcessManager           │
       (control)     │      │                    │
                     │      │                    │
           HTTP ─────┤  MCP Server               │
        (data)       │                           │
                     └──────────────────────────┘
                              ▲
                              │
                     ┌────────┴─────────────────┐
                     │        Worker             │
                     │                           │
                     │  IPC: heartbeat, result   │
                     │  MCP: channel_send, etc.  │
                     └──────────────────────────┘

Control channel (IPC / stdio):
  daemon → worker: start config
  worker → daemon: heartbeat, result, error
  daemon → worker: stop signal (SIGTERM)

Data channel (MCP over HTTP):
  worker → daemon: channel_send, my_inbox, team_doc_read, ...
  Standard MCP protocol, interface identical to in-process
```

### Prompt Building

After startup, the worker fetches context via Daemon MCP, then builds the prompt locally. Daemon does not touch the prompt.

```
Worker startup flow:
  1. connectDaemonMCP(url)     ── establish connection
  2. my_inbox()                ── fetch unread messages
  3. channel_read(limit: 50)   ── fetch recent messages
  4. team_doc_read()           ── fetch documents
  5. buildPrompt(...)          ── assemble locally

Prompt structure:

## Your Identity
{system_prompt}

## Inbox ({count} messages for you)
{inbox messages, formatted}

## Recent Activity
{recent channel messages}

## Current Workspace
{document content, if any}

## Instructions
Process your inbox messages. Use MCP tools to collaborate with your team.
```

Prompt building is the worker's responsibility — daemon only provides raw data (inbox, channel, document), worker decides how to present it to the LLM.

---

## Part 3: Interface (Interface Layer)

Stateless. Pure protocol translation. Follows the Daemon HTTP API.

### CLI Implementation

```
CLI
├── Discover daemon (read daemon.json → check pid alive → get host:port)
├── If daemon not running → auto-start
├── Send HTTP request → receive response → format output
└── Holds no state
```

Each command = one HTTP call:

```typescript
// All commands are thin HTTP wrappers
const commands = {
  'new':      (args) => POST('/agents', { name, model, ... }),
  'list':     ()     => GET('/agents'),
  'ask':      (args) => POST('/run', { agent, message }),  // SSE
  'send':     (args) => POST('/send', { target, message }),
  'run':      (args) => POST('/workflows', { workflow, tag }),
  'stop':     (args) => DELETE(`/workflows/${key}`),
  // ...
}
```

SSE streaming output:

```
POST /run → SSE stream
  event: chunk   data: "thinking..."
  event: chunk   data: "Here's my analysis:"
  event: tool    data: {"name": "channel_send", "args": {...}}
  event: done    data: {"usage": {...}}
```

### What Interface Does NOT Do

- Does not parse workflow YAML (daemon does)
- Does not manage agent state (daemon manages)
- Does not build prompts (worker does)
- Does not cache anything

---

## Part 4: Module Structure

```
src/
├── daemon/                        # The kernel
│   ├── index.ts                   # Entry, lifecycle (start/shutdown)
│   ├── db.ts                      # SQLite schema, migrations, query helpers
│   ├── registry.ts                # Agent + workflow CRUD
│   ├── scheduler.ts               # Poll / cron / wake logic
│   ├── process-manager.ts         # Spawn / kill / monitor child processes
│   ├── http.ts                    # HTTP API (Hono)
│   ├── mcp.ts                     # Daemon MCP server (context + document tools)
│   ├── context.ts                 # Channel, inbox, proposal operations (SQLite)
│   └── documents/                 # Document storage (pluggable, independent from SQLite)
│       ├── types.ts               # DocumentProvider interface
│       ├── file-provider.ts       # Default: filesystem (.workflow/<wf>/<tag>/documents/)
│       └── sqlite-provider.ts     # Optional: documents table in SQLite
│
├── worker/                        # The execution unit
│   ├── entry.ts                   # Subprocess entry point (main)
│   ├── session.ts                 # LLM conversation + tool loop
│   ├── prompt.ts                  # Prompt building from raw data
│   ├── mcp-client.ts             # Connect to Daemon MCP
│   └── backends/                  # LLM communication adapters
│       ├── types.ts               # Backend interface
│       ├── sdk.ts                 # Vercel AI SDK
│       ├── claude-cli.ts          # Claude Code CLI
│       ├── codex-cli.ts           # Codex CLI
│       ├── cursor-cli.ts          # Cursor CLI
│       └── mock.ts                # Testing
│
├── interface/                     # The shell
│   ├── cli.ts                     # CLI entry, arg parsing
│   ├── client.ts                  # HTTP client to daemon
│   ├── discovery.ts               # Find running daemon (daemon.json)
│   ├── output.ts                  # Output formatting
│   └── commands/                  # One file per command group
│       ├── agent.ts               # new, list, stop, info
│       ├── workflow.ts            # run, start, stop, list
│       ├── send.ts                # send, peek
│       ├── doc.ts                 # doc read, write, append
│       ├── schedule.ts            # schedule set, clear
│       └── info.ts                # providers, backends
│
├── workflow/                      # Workflow YAML handling (daemon uses this)
│   ├── parser.ts                  # YAML → typed config
│   ├── interpolate.ts             # Variable ${{ }} resolution
│   └── types.ts                   # Workflow config types
│
└── shared/                        # Cross-layer types
    ├── types.ts                   # Message, Agent, Proposal, etc.
    ├── protocol.ts                # IPC message types (daemon ↔ worker)
    └── constants.ts               # Tool names, defaults
```

### Dependency Rules

```
interface/ ── HTTP ──► daemon/
                         │
                         ├──► worker/entry.ts  (fork)
                         │       │
                         │       └──► worker/backends/
                         │
                         ├──► workflow/  (YAML parsing)
                         │
                         └──► shared/

worker/ ── MCP/HTTP ──► daemon/mcp
worker/ imports shared/ only
daemon/ imports shared/ + workflow/
interface/ imports shared/ only (+ HTTP client)

Forbidden:
  interface/ ──✗──► daemon/ (direct import)
  worker/ ──✗──► daemon/ (direct import)
  daemon/ ──✗──► interface/
```

---

## Part 5: Rewrite Execution Order

### Step 1: Daemon Core

Get the kernel running first. Can start, can shut down, can persist data.

```
daemon/db.ts          ── SQLite schema + migration
daemon/index.ts       ── start/shutdown lifecycle
daemon/registry.ts    ── agent/workflow CRUD (DB operations)
daemon/http.ts        ── minimal HTTP API (/health, /agents CRUD)
shared/types.ts       ── core types
```

Verification: daemon starts → SQLite created → HTTP available → register agent → shut down → restart → agent still there.

### Step 2: Context (Channel + Inbox)

Messaging system. Structured writes, indexed queries.

```
daemon/context.ts     ── channelSend, channelRead, inboxQuery, inboxAck
daemon/mcp.ts         ── channel_send, channel_read, my_inbox, my_inbox_ack tools
```

Verification: send message via MCP tool → @mention auto-parsed → inbox query returns unread → disappears after ack.

### Step 3: Worker Subprocess

Can spawn worker, can run LLM conversation, can connect back to daemon MCP.

```
worker/entry.ts       ── subprocess entry point
worker/session.ts     ── LLM tool loop
worker/mcp-client.ts  ── connect to daemon MCP
worker/backends/sdk.ts ── AI SDK backend
worker/prompt.ts      ── prompt building
daemon/process-manager.ts  ── spawn/kill/monitor
```

Verification: daemon spawns worker → worker connects to daemon MCP → calls channel_send → daemon receives message → worker exits.

### Step 4: Scheduler

Connect step 2 + step 3 together. Inbox has messages → trigger worker → worker processes → ack.

```
daemon/scheduler.ts   ── poll/cron/wake
```

Verification: send message @mentioning agent → scheduler detects → spawns worker → worker responds → channel has reply.

### Step 5: Interface CLI

Users can use it now.

```
interface/            ── everything
workflow/             ── YAML parsing
```

Verification: complete workflow from CLI start to finish.

### Step 6: Complete Remaining Features

```
daemon/context.ts     ── document, proposal, resource operations
daemon/mcp.ts         ── corresponding MCP tools
worker/backends/      ── claude-cli, codex-cli, cursor-cli, mock
```

---

## Design Principles (Guidance for the Rewrite)

1. **SQLite is the single source of truth for system state** (messages, proposals, agents, workflows). Documents are independent — pluggable provider, default file-based. Do not maintain a second copy of state in memory.
2. **Workers are short-lived**. Each invocation: spawn → execute → exit. Do not keep workers persistent (unless a clear future need arises).
3. **Daemon does not touch the prompt**. It provides raw data (inbox, channel, document); the worker decides how to present it to the LLM.
4. **Interface layer is a 1:1 mapping**. Each CLI command = one HTTP call. Do not add logic in the interface layer.
5. **Get the minimal loop working first, then add features**. After steps 1-4, you should be able to run a complete message-response cycle.
6. **Keep the table schema stable**. Once the schema is defined, adding columns is fine, but changing column semantics is not. Design well before creating tables.
