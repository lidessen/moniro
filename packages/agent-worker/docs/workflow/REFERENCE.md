# Technical Reference

Implementation reference. For design concepts, see [DESIGN.md](./DESIGN.md). For rewrite architecture, see [REWRITE.md](../REWRITE.md).

Source of truth is always the code in `src/`. This doc covers non-obvious patterns and tool APIs.

---

## Architecture

Three-tier architecture: **Interface → Daemon → Worker**

```
Interface (CLI)          Daemon (Kernel)           Worker (Execution)
┌──────────────┐   HTTP  ┌──────────────────┐  fork  ┌──────────────┐
│ cli.ts       │───────►│ http.ts          │───────►│ entry.ts     │
│ commands/    │        │ db.ts (SQLite)   │◄──MCP──│ session.ts   │
│ client.ts    │        │ registry.ts      │        │ backends/    │
│ discovery.ts │        │ context.ts       │        │ prompt.ts    │
└──────────────┘        │ scheduler.ts     │        │ mcp-client.ts│
                        │ process-manager  │        └──────────────┘
                        │ mcp.ts           │
                        │ proposals.ts     │
                        │ documents/       │
                        └──────────────────┘
```

---

## MCP Tool Listing

The daemon MCP server exposes these tools to workers:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `channel_send` | `message: string` | Send message to channel (sender = agent identity) |
| `channel_read` | `since?: string, limit?: number` | Read channel entries |
| `my_inbox` | (none) | Get unread @mentions for this agent |
| `my_inbox_ack` | `until: string` | Acknowledge messages up to message ID |
| `my_status_set` | `task?: string, state?: 'idle'\|'running', metadata?: object` | Update your status and current task |
| `team_members` | `includeStatus?: boolean` | List all agents (optionally with status) |
| `team_doc_read` | `file?: string` | Read document (default: `notes.md`) |
| `team_doc_write` | `content: string, file?: string` | Write document |
| `team_doc_append` | `content: string, file?: string` | Append to document |
| `team_doc_list` | (none) | List all document files |
| `team_doc_create` | `file: string, content: string` | Create new document (fails if exists) |
| `team_proposal_create` | `type, title, options[], resolution?, binding?` | Create proposal |
| `team_vote` | `proposal: string, choice: string, reason?: string` | Vote on proposal |
| `team_proposal_status` | `proposal?: string` | Check proposal status (or all active) |
| `team_proposal_cancel` | `proposal: string` | Cancel proposal (creator only) |

Agent identity flows through query parameter `?agent=<name>` on the MCP connection URL.

---

## Proposal Types

| Type | Use Case | Example |
|------|----------|---------|
| `election` | Role selection | Document owner |
| `decision` | Design choices | "Use REST or GraphQL?" |
| `approval` | Sign-off | Merge approval |
| `assignment` | Task allocation | "Who handles auth?" |

Resolution strategies: `plurality` (most votes, 2+ required) | `majority` (>50%, 2+ required) | `unanimous` (all agree, 2+ required)

---

## Target Syntax

Docker-style `agent@workflow:tag`:

```
alice                → alice@global:main
alice@review         → alice@review:main
alice@review:pr-123  → full specification
@review:pr-123       → workflow:tag scope (no agent)
```

Display rules: `@global` and `:main` are hidden when displaying targets.

---

## Key Source Files

| File | Purpose |
|------|---------|
| **Daemon** | |
| `src/daemon/index.ts` | Daemon lifecycle (start, shutdown, daemon.json) |
| `src/daemon/db.ts` | SQLite schema, migrations, WAL mode |
| `src/daemon/registry.ts` | Agent + workflow CRUD |
| `src/daemon/http.ts` | HTTP API (Hono) — agents, workflows, send, peek |
| `src/daemon/context.ts` | Channel send/read, inbox query/ack, @mention parsing |
| `src/daemon/mcp.ts` | MCP server — all context + document + proposal tools |
| `src/daemon/scheduler.ts` | Per-agent scheduling (poll, cron, wake) |
| `src/daemon/process-manager.ts` | Spawn/kill/monitor worker child processes |
| `src/daemon/proposals.ts` | Proposal + vote operations (SQLite) |
| `src/daemon/documents/file-provider.ts` | File-based document storage |
| **Worker** | |
| `src/worker/entry.ts` | Subprocess entry point |
| `src/worker/session.ts` | LLM conversation + tool loop |
| `src/worker/prompt.ts` | Prompt building from raw context data |
| `src/worker/mcp-client.ts` | Connect to daemon MCP |
| `src/worker/backends/sdk.ts` | Vercel AI SDK backend |
| `src/worker/backends/claude-cli.ts` | Claude Code CLI backend |
| `src/worker/backends/codex-cli.ts` | Codex CLI backend |
| `src/worker/backends/cursor-cli.ts` | Cursor CLI backend |
| `src/worker/backends/mock.ts` | Mock backend (testing) |
| `src/worker/backends/index.ts` | Backend factory |
| **Interface** | |
| `src/interface/cli.ts` | CLI entry point (Commander) |
| `src/interface/client.ts` | HTTP client to daemon (with retry) |
| `src/interface/discovery.ts` | Find/start daemon (daemon.json) |
| `src/interface/output.ts` | JSON output formatting |
| `src/interface/commands/agent.ts` | daemon, new, ls, stop, status commands |
| `src/interface/commands/workflow.ts` | run, start commands |
| `src/interface/commands/send.ts` | send, peek commands |
| `src/interface/commands/info.ts` | providers, backends commands |
| **Workflow** | |
| `src/workflow/parser.ts` | YAML parsing + validation |
| `src/workflow/types.ts` | Workflow config types |
| **Shared** | |
| `src/shared/types.ts` | Core types (Message, Agent, Proposal, etc.) |
| `src/shared/protocol.ts` | IPC message types (daemon ↔ worker) |
| `src/shared/constants.ts` | Tool names, defaults |

---

## Tests

All tests use `bun:test`. Run with `bun test test/`.

| File | Tests | Coverage |
|------|-------|----------|
| `test/daemon-core.test.ts` | 7 | Daemon lifecycle, agent CRUD, persistence |
| `test/context-new.test.ts` | 24 | Channel, inbox, @mention parsing, MCP tools |
| `test/worker-subprocess.test.ts` | 7 | Worker spawn, MCP connection, IPC |
| `test/scheduler.test.ts` | 7 | Scheduling, wake, idle detection |
| `test/interface.test.ts` | 29 | Target parsing, workflow parser, CLI commands |
| `test/features.test.ts` | 19 | Proposals, documents, backends, workflow lifecycle |
