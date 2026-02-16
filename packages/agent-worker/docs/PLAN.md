# Rewrite Plan

Concrete execution plan for the agent-worker rewrite. Derived from [REWRITE.md](./REWRITE.md).

**Strategy**: Clean rewrite. Move `src/` → `src-old/`, build new `src/` from scratch. Reuse portable modules (backends, parser, target) by copying and adapting, not by importing from old code. Delete `src-old/` when the new code passes all key scenarios.

---

## Current State

| Module | Files | Lines | Reuse |
|--------|-------|-------|-------|
| `agent/` (worker, tools, skills) | 14 | 2,113 | Partial — tools/, skills/ are portable |
| `backends/` | 11 | 2,396 | High — adapters are standalone |
| `cli/` | 10 | 1,445 | Medium — client.ts, target.ts portable, commands rewrite |
| `daemon/` | 6 | 1,414 | Low — daemon.ts/registry.ts fully rewritten |
| `workflow/` | 10 | 2,792 | Low-Medium — parser.ts, interpolate.ts portable, runner.ts rewrite |
| `workflow/context/` | 20 | 2,349 | Low — file-provider → document provider, rest rewrite for SQLite |
| `workflow/controller/` | 9 | 1,363 | Low — controller.ts → scheduler + process-manager |
| `index.ts` | 1 | 75 | Rewrite |
| **Total** | **82** | **14,709** | |

Tests: 31 files, 13,157 lines. Tests against the new API will need rewriting, but test logic/scenarios are valuable reference.

---

## Phase 0: Preparation

### 0.1 Archive old code
```bash
git mv src src-old
mkdir -p src/{daemon,worker,interface,workflow,shared}
mkdir -p src/daemon/documents
mkdir -p src/worker/backends
mkdir -p src/interface/commands
```

### 0.2 Copy portable modules (adapt later)
```
src-old/backends/          → src/worker/backends/    (copy, adapt interfaces)
src-old/workflow/parser.ts → src/workflow/parser.ts   (copy as-is)
src-old/workflow/interpolate.ts → src/workflow/interpolate.ts (copy as-is)
src-old/workflow/types.ts  → src/workflow/types.ts    (copy, trim)
src-old/cli/target.ts      → src/interface/target.ts  (copy as-is)
src-old/agent/models.ts    → src/worker/models.ts     (copy as-is)
src-old/agent/tools/       → src/worker/tools/        (copy as-is)
src-old/agent/skills/      → src/worker/skills/       (copy as-is)
```

### 0.3 Add bun:sqlite dependency
No npm dependency needed — `bun:sqlite` is built-in. Verify with a minimal test.

### 0.4 Update build config
Update `tsdown` entry points, `package.json` bin field, exports.

**Gate**: New `src/` compiles (empty stubs). `bun:sqlite` available.

---

## Phase 1: Daemon Core

Build the kernel. Can start, persist data, serve HTTP.

### 1.1 shared/types.ts
Core type definitions used across all layers.
```
Message, Agent, Workflow, Proposal, Vote, Resource
WorkerConfig, SessionResult
```
~100 lines. Reference: `src-old/workflow/context/types.ts`, `src-old/agent/types.ts`.

### 1.2 daemon/db.ts
SQLite schema, migrations, query helpers.
```
createDatabase(path) → Database
migrate(db)          → run CREATE TABLE IF NOT EXISTS
query helpers        → typed wrappers for common operations
```
~200 lines. Schema from REWRITE.md. WAL mode enabled on open.

### 1.3 daemon/registry.ts
Agent + workflow CRUD, backed by SQLite.
```
registerAgent(db, config)    → INSERT INTO agents
listAgents(db, workflow, tag) → SELECT FROM agents
getAgent(db, name)           → agent or null
removeAgent(db, name)        → DELETE
createWorkflow(db, config)   → INSERT INTO workflows
listWorkflows(db)            → SELECT FROM workflows
```
~150 lines. Reference: `src-old/daemon/registry.ts` (449 lines, in-memory Map → now SQL).

### 1.4 daemon/index.ts
Daemon lifecycle: start, shutdown, signal handling.
```
startDaemon(options) → { server, db, shutdown() }
  1. Open SQLite (WAL mode)
  2. Migrate schema
  3. Start HTTP server
  4. Write daemon.json
  5. Return handle

shutdownDaemon(handle)
  1. Close HTTP server
  2. Close SQLite
  3. Delete daemon.json
```
~150 lines. Reference: `src-old/daemon/daemon.ts` (724 lines — much simpler now).

### 1.5 daemon/http.ts
Minimal HTTP API with Hono.
```
GET  /health
POST /shutdown
POST /agents
GET  /agents
GET  /agents/:name
DELETE /agents/:name
```
~150 lines. Just route → registry function → JSON response.

### 1.6 Tests
```
test/daemon-core.test.ts
  - daemon starts, creates SQLite
  - register agent, list, get, delete
  - shutdown, restart, agents persisted
  - daemon.json written/deleted
```

**Gate**: Daemon starts → SQLite created → HTTP works → register agent → shut down → restart → agent still there.

**Estimated**: ~750 lines new code.

---

## Phase 2: Context (Channel + Inbox)

Structured messaging with write-time @mention parsing.

### 2.1 daemon/context.ts
Channel and inbox operations, all SQLite.
```
channelSend(db, sender, content, workflow, tag)
  → parseMentions(content) → INSERT INTO messages
  → return { id, recipients }

channelRead(db, workflow, tag, options?)
  → SELECT FROM messages ORDER BY created_at

inboxQuery(db, agent, workflow, tag)
  → SELECT ... LEFT JOIN inbox_ack ... WHERE recipients LIKE ...

inboxAck(db, agent, workflow, tag, cursor)
  → INSERT OR REPLACE INTO inbox_ack
```
~200 lines.

### 2.2 daemon/mcp.ts (partial — channel + inbox tools)
MCP server exposing context tools. Uses `@modelcontextprotocol/sdk`.
```
channel_send, channel_read, my_inbox, my_inbox_ack, my_status_set, team_members
```
~250 lines. Reference: `src-old/workflow/context/mcp/` (split across 10 files, ~1100 lines — consolidate).

### 2.3 Tests
```
test/context.test.ts
  - channel_send stores structured message
  - @mention parsed into recipients
  - @all expanded
  - inbox returns only unread messages for agent
  - inbox_ack advances cursor
  - long message → resource auto-conversion
```

**Gate**: Send message via MCP → @mention parsed → inbox query returns it → ack → gone.

**Estimated**: ~450 lines new code.

---

## Phase 3: Worker Subprocess

Spawn worker, run LLM, connect back to daemon MCP.

### 3.1 worker/entry.ts
Subprocess entry point.
```
1. Parse WORKER_CONFIG from env
2. Connect to Daemon MCP (HTTP)
3. Connect to Worker MCPs (if any)
4. Fetch context: my_inbox(), channel_read(), team_doc_read()
5. Build prompt
6. Run LLM session
7. Send result via IPC
8. Exit
```
~100 lines.

### 3.2 worker/session.ts
LLM conversation + tool loop. Core of the worker.
```
runSession({ model, backend, system, prompt, tools }) → SessionResult
```
~200 lines. Reference: `src-old/agent/worker.ts` (570 lines — extract core loop).

### 3.3 worker/prompt.ts
Build prompt from raw context data.
```
buildPrompt({ system, inbox, channel, document }) → string
```
~80 lines. Reference: `src-old/workflow/controller/prompt.ts` (163 lines).

### 3.4 worker/mcp-client.ts
Connect to Daemon MCP server, return tool definitions.
```
connectDaemonMCP(url) → { tools, call(name, args) }
```
~100 lines.

### 3.5 worker/backends/ (adapt from old)
Copy from `src-old/backends/`, adapt interface to new types.
- `types.ts` — Backend interface
- `sdk.ts` — Vercel AI SDK (primary, test with this first)
- `mock.ts` — For testing
- Others (claude-cli, codex, cursor) — Phase 6

~200 lines adapted.

### 3.6 daemon/process-manager.ts
Spawn, monitor, kill worker child processes.
```
spawnWorker(config) → { pid, promise, kill() }
  → fork('worker/entry.ts', { env: { WORKER_CONFIG } })
  → listen for IPC messages + exit
  → timeout protection
```
~200 lines.

### 3.7 Tests
```
test/worker-subprocess.test.ts
  - daemon spawns worker
  - worker connects to daemon MCP
  - worker calls channel_send
  - daemon receives message
  - worker exits cleanly
  - worker timeout → killed
  - worker crash → daemon unaffected
```

**Gate**: Daemon spawns worker → worker connects MCP → calls channel_send → daemon sees message → worker exits.

**Estimated**: ~880 lines new code.

---

## Phase 4: Scheduler

Connect inbox → trigger → spawn → ack loop.

### 4.1 daemon/scheduler.ts
Per-agent scheduling: poll, cron, wake.
```
class Scheduler {
  start(agent)    → begin polling/cron
  stop(agent)     → stop scheduling
  wake(agent)     → immediate trigger

  // Internal loop:
  // check inbox → if messages, processManager.run(agent)
  // on success → ack inbox
  // on failure → retry (backoff)
}
```
~250 lines. Reference: `src-old/workflow/controller/controller.ts` (469 lines — scheduling extracted).

### 4.2 Integrate into daemon/index.ts
Wire scheduler + process-manager into daemon lifecycle.
- On startup: restore schedulers for running workflows
- On @mention write: scheduler.wake()
- On shutdown: stop all schedulers, kill all workers

~50 lines of integration code.

### 4.3 daemon/http.ts — add execution endpoints
```
POST /run    → run workflow (SSE stream)
POST /serve  → run agent (JSON response)
POST /send   → send message
GET  /peek   → read recent channel
```
~150 lines added.

### 4.4 Tests
```
test/scheduler.test.ts
  - send @mention → scheduler triggers → worker runs → response in channel
  - worker failure → retry with backoff
  - idle detection (all agents idle, no inbox, no proposals)
  - cron schedule fires
  - wake() immediate trigger
```

**Gate**: Send message @mentioning agent → scheduler detects → spawns worker → worker responds → channel has reply → inbox acked.

**Estimated**: ~450 lines new code.

---

## Phase 5: Interface CLI

Users can use the system.

### 5.1 interface/discovery.ts
Find running daemon.
```
findDaemon() → { host, port } | null
  → read ~/.agent-worker/daemon.json → check pid alive
ensureDaemon() → { host, port }
  → findDaemon() || spawn daemon
```
~80 lines. Reference: `src-old/daemon/registry.ts` (discovery part).

### 5.2 interface/client.ts
HTTP client to daemon.
```
class DaemonClient {
  agents: { create, list, get, remove }
  run(agent, message) → SSE stream
  send(target, message)
  peek(target)
  workflows: { start, stop, list }
}
```
~200 lines. Reference: `src-old/cli/client.ts` (239 lines).

### 5.3 interface/cli.ts + commands/
Commander-based CLI. One file per command group.
```
cli.ts          ── entry, program definition
commands/
  agent.ts      ── new, list, stop, info
  workflow.ts   ── run, start, stop, list
  send.ts       ── send, peek
  doc.ts        ── doc read, write, append
  schedule.ts   ── schedule set, clear
  info.ts       ── providers, backends
```
~600 lines. Reference: `src-old/cli/commands/` (885 lines).

### 5.4 workflow/ (copy + adapt)
YAML parsing, already copied in Phase 0. Wire into daemon.
```
POST /workflows → parse YAML → register agents → start schedulers → kickoff
```
~100 lines integration.

### 5.5 Tests
```
test/cli.test.ts
  - agent-worker new / list / stop
  - agent-worker run workflow.yaml
  - agent-worker send / peek
  - full workflow lifecycle from CLI
```

**Gate**: Complete workflow from CLI start to finish. `agent-worker run review.yaml` works end-to-end.

**Estimated**: ~980 lines new code.

---

## Phase 6: Complete Remaining Features

### 6.1 Documents (pluggable provider)
```
daemon/documents/types.ts         ── DocumentProvider interface
daemon/documents/file-provider.ts ── filesystem (default)
daemon/mcp.ts                     ── team_doc_read, write, append, create, list
```
~300 lines. Reference: `src-old/workflow/context/file-provider.ts` (198 lines) + mcp handlers.

### 6.2 Proposals
```
daemon/context.ts                 ── add proposal/vote SQL operations
daemon/mcp.ts                     ── team_proposal_create, team_vote, team_proposal_status, cancel
```
~400 lines. Reference: `src-old/workflow/context/proposals.ts` (600 lines).

### 6.3 Resources
```
daemon/context.ts                 ── resource_create, resource_read
daemon/mcp.ts                     ── corresponding MCP tools
```
~100 lines.

### 6.4 Remaining backends
```
worker/backends/claude-cli.ts     ── copy + adapt
worker/backends/codex-cli.ts      ── copy + adapt
worker/backends/cursor-cli.ts     ── copy + adapt
```
~500 lines adapted from old code.

### 6.5 Skills + Feedback tools
```
worker/tools/bash.ts              ── already copied in Phase 0
worker/tools/skills.ts            ── already copied in Phase 0
worker/tools/feedback.ts          ── already copied in Phase 0
worker/skills/                    ── already copied in Phase 0
```
Wire into worker session.

### 6.6 Tests
Port key test scenarios from old tests. Focus on:
- Proposal lifecycle (create → vote → resolve)
- Document ownership enforcement
- Multi-agent workflow simulation
- Backend-specific tests

**Gate**: All features from Product Form (Part 0 of REWRITE.md) working.

**Estimated**: ~1300 lines new code.

---

## Phase 7: Cleanup

### 7.1 Delete src-old/
Once all scenarios pass with new code.

### 7.2 Update tests
Rewrite test helpers. Port remaining test scenarios.

### 7.3 Update docs
- REFERENCE.md — update key source files section
- Remove TODO.md old phase tracking

### 7.4 Update package.json
- Build entries
- bin entry points
- Exports

---

## Summary

| Phase | What | New Lines (est.) | Gate |
|-------|------|------------------|------|
| **0** | Preparation | 0 | Compiles, bun:sqlite works |
| **1** | Daemon Core | ~750 | HTTP + SQLite + agent CRUD + persistence |
| **2** | Context | ~450 | channel_send → @mention → inbox → ack |
| **3** | Worker Subprocess | ~880 | Spawn → MCP connect → channel_send → exit |
| **4** | Scheduler | ~450 | @mention → trigger → worker → response |
| **5** | Interface CLI | ~980 | Full workflow from CLI |
| **6** | Remaining Features | ~1300 | Documents, proposals, resources, backends |
| **7** | Cleanup | 0 | Delete src-old/, update docs |
| **Total** | | **~4,810** | |

Current code: 14,709 lines → estimated new code: ~4,810 lines. **67% reduction** by eliminating compatibility layers, consolidating scattered modules, and using SQLite instead of ad-hoc file parsing.

### What Stays the Same (User-Facing)
- CLI commands and syntax
- Workflow YAML format
- Target syntax (`agent@workflow:tag`)
- MCP tool names and parameters
- Backend options

### What Changes (Internal)
- Storage: files → SQLite
- Worker: in-process → child process
- Message: markdown text → structured records
- State: in-memory → persistent
- Module layout: 6 directories → 5 clean directories with strict boundaries
