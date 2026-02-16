---
type: decision
status: active
tags: [architecture, agent-worker, sqlite, subprocess, storage, messaging]
created: 2026-02-16
---

# Technology Choices: Storage, Messaging, Process Model

## Context

After establishing the three-tier architecture (Interface → Daemon → Worker), specific technology choices are needed for several key subsystems.

Current implementation:
- **Context storage**: filesystem (channel.md append-write + inbox-state.json read state + documents/ directory)
- **Message @mention**: regex parsing at read time
- **Daemon state**: in-memory, lost on restart (daemon.json only stores pid/host/port)
- **Worker process model**: in-process (LocalWorker executes within daemon process)

Inspiration:
- **NanoClaw**: "One LLM. One database. One machine." — SQLite as the sole storage backend, all state in one file
- **nanobot**: BaseChannel abstraction + multiple storage backends, ContextProvider interface already in the code

## Decisions

### 1. Context Storage: SQLite (`bun:sqlite`)

**Choice**: Replace filesystem with SQLite as the production storage backend for context.

**Rationale**:

| Dimension | File | SQLite |
|-----------|------|--------|
| Concurrency safety | No guarantees (two workers calling channel_send simultaneously may lose messages) | WAL mode, ACID guarantees |
| Inbox query | Full-text scan of channel.md + parse @mention + compare inbox-state.json | `SELECT * FROM messages WHERE recipient = ? AND ack = false` |
| Proposal/voting | JSON file | Relational tables, naturally suited |
| Human readable | channel.md can be read directly | Requires tooling to view |
| Backup | Copy directory | Copy single file |

**Loss of human readability is acceptable**: Under the three-tier architecture, workers access context via Daemon MCP, not by reading files directly. Users view via CLI (Interface layer). Neither depends on file format.

**Interface unchanged**: `ContextProvider` interface remains unchanged; add new `SqliteContextProvider` implementation. `MemoryContextProvider` retained for testing. `FileContextProvider` can be retained but demoted to fallback.

### 2. Message @mention: Parse at Write Time

**Choice**: Daemon parses @mentions at `channel_send` time, writing structured data.

**Rationale**:

```
Current (parse at read time):
  channel_send("@reviewer there's a code issue") → append to channel.md
  inbox_check("reviewer") → read full text → regex match @reviewer → filter read

Target (parse at write time):
  channel_send("@reviewer there's a code issue")
    → daemon parses out recipients: ["reviewer"]
    → writes to messages table: { sender, recipients, content, timestamp }
  inbox_check("reviewer")
    → SELECT FROM messages m LEFT JOIN inbox_ack a ON ...
      WHERE recipients LIKE '%"reviewer"%' AND (a.cursor IS NULL OR m.id > a.cursor)
```

**Parsing at write time means**:
- Inbox queries become database operations, not text processing
- Messages are structured; metadata (sender, timestamp, recipients) separated from content
- @mention rules defined in one place (daemon), not each reader parsing independently

### 3. Daemon State Persistence: SQLite

**Choice**: Persist all daemon state to SQLite, supporting crash-recovery.

**Database schema direction**:

```
agent-worker.db
├── agents          # Registry (agent configs)
├── workflows       # Workflow configs + state
├── messages        # Channel + inbox (structured messages)
├── documents       # Document metadata (content may still be on filesystem)
├── proposals       # Proposal + voting state
└── daemon_state    # Daemon self-state (uptime, etc.)
```

**daemon.json is still retained**: Used by CLI to discover the daemon process (pid/host/port). This is the Interface layer's discovery mechanism, not state persistence.

**crash-recovery semantics**: After daemon restart, agent registry, workflow state, and pending messages are recovered from SQLite. Workers as child processes terminate with the daemon; after restart, the daemon reschedules them.

### 4. Worker Process Model: Child Process (Not Worker Threads)

**Choice**: Workers run as independent child processes (`child_process.fork()` / `Bun.spawn()`), not Worker Threads.

**Comparison**:

```
Worker Threads (Bun.Worker / worker_threads)
├── Shared process memory space
├── One worker OOM/crash → entire process may go down
├── Designed for: CPU-intensive parallel computation
└── Not isolation

Child Process (Bun.spawn / child_process.fork)
├── Independent process, independent memory space
├── Worker crash → daemon receives exit event, unaffected
├── Can spawn different runtimes (claude CLI, codex, any executable)
└── True process isolation
```

**Communication model (two paths)**:

```
Control channel (daemon → worker):
  IPC / stdio — startup parameters, stop signals, heartbeat
  Daemon unilaterally controls worker lifecycle

Data channel (worker → daemon):
  MCP over HTTP — worker calls channel_send, inbox_check, etc.
  Worker actively connects to daemon's MCP server
  Interface identical to in-process, only transport layer changes
```

**Worker does not need to know its process model**: It only knows "I have an MCP server URL to access context". `WorkerBackend` interface unchanged; add new `SubprocessWorkerBackend` implementation. `LocalWorker` (in-process) retained for development/testing.

## Consequences

1. **Add `SqliteContextProvider`**: Implements the `ContextProvider` interface using `bun:sqlite`. This is the largest implementation effort.
2. **Message model change**: `ChannelMessage` changes from markdown string to structured object (sender, recipients, content, timestamp, ack). Affects context type definitions and MCP tool handlers.
3. **Add `SubprocessWorkerBackend`**: `fork()` child process + IPC communication. Requires worker-entry.ts entry file.
4. **Schema migration**: Future schema changes require a migration strategy. The initial SQLite version must have a well-designed table structure.
5. **Testing strategy**: `MemoryContextProvider` continues for unit tests. Integration tests use `SqliteContextProvider` + temporary database.

## Related

- [Three-Tier Architecture](./2026-02-16-three-tier-architecture.md) — architecture decision (prerequisite)
- [ARCHITECTURE.md](../../packages/agent-worker/ARCHITECTURE.md) — main architecture document
- [workflow/DESIGN.md](../../packages/agent-worker/docs/workflow/DESIGN.md) — workflow design
