# agent-worker Architecture

## Overview

agent-worker provides programmatic control over AI agent conversations — both single-agent sessions and multi-agent workflows.

## Module Structure

```
src/
├── index.ts                    # Public API (library usage)
├── types.ts                    # Core shared types
│
├── core/                       # Pure domain logic (no I/O, no process management)
│   ├── session.ts              # AgentSession — SDK-based agentic loop
│   ├── models.ts               # Model creation, provider registry
│   ├── model-maps.ts           # Model name translation (single source of truth)
│   └── tools.ts                # ToolDefinition → AI SDK tool conversion
│
├── backends/                   # AI provider adapters (unified interface)
│   ├── types.ts                # Backend interface definition
│   ├── index.ts                # Factory + availability checks
│   ├── sdk.ts                  # Vercel AI SDK backend
│   ├── claude.ts               # Claude Code CLI backend
│   ├── codex.ts                # Codex CLI backend
│   ├── cursor.ts               # Cursor CLI backend
│   └── mock.ts                 # Mock backend (testing)
│
├── daemon/                     # Central process manager
│   ├── daemon.ts               # Daemon: manages agents, MCP servers, lifecycle
│   ├── registry.ts             # Persistent agent registry (~/.agent-worker/)
│   ├── ipc-server.ts           # Unix socket server (transport only)
│   ├── ipc-client.ts           # Unix socket client
│   └── handler.ts              # Request → Response dispatch
│
├── context/                    # Agent collaboration system
│   ├── types.ts                # Channel, inbox, document types
│   ├── provider.ts             # ContextProvider interface + implementation
│   ├── storage.ts              # StorageBackend interface
│   ├── file-storage.ts         # File-based storage
│   ├── memory-storage.ts       # In-memory storage (testing)
│   ├── mcp-server.ts           # MCP server exposing context tools
│   ├── http-transport.ts       # HTTP transport for MCP
│   └── proposals.ts            # Proposal/voting system
│
├── workflow/                   # Multi-agent orchestration
│   ├── types.ts                # Workflow schema types
│   ├── parser.ts               # YAML workflow parser
│   ├── interpolate.ts          # Variable interpolation (${{ }})
│   ├── runner.ts               # Workflow runtime (init + run)
│   ├── controller.ts           # Agent controller (poll + retry + wake)
│   ├── prompt.ts               # Agent prompt building
│   └── logger.ts               # Structured logger
│
├── skills/                     # Skills system
│   ├── provider.ts             # SkillsProvider (scan/load)
│   ├── importer.ts             # Git-based skill import
│   └── import-spec.ts          # Import spec parsing
│
└── cli/                        # Thin presentation layer
    ├── index.ts                # Entry: setup program, import commands
    ├── commands/               # One file per command group
    │   ├── agent.ts            # new, list, status, use, end
    │   ├── send.ts             # send, peek, stats, export, clear
    │   ├── tool.ts             # tool add, import, mock, list
    │   ├── workflow.ts         # run, start, stop
    │   ├── approval.ts         # pending, approve, deny
    │   └── info.ts             # providers, backends
    └── format.ts               # Output formatting utilities
```

## Responsibility Boundaries

### core/ — Pure Domain Logic

No I/O, no process management, no network. Just data structures and algorithms.

- `session.ts`: Stateful agentic loop using Vercel AI SDK's ToolLoopAgent
- `models.ts`: Create LanguageModel from model identifiers (gateway/direct)
- `model-maps.ts`: Translate model names between backends (the SINGLE source of truth)
- `tools.ts`: Convert ToolDefinition[] to AI SDK tool objects

### backends/ — AI Provider Adapters

Each backend wraps one AI tool/API behind a unified interface:

```typescript
interface Backend {
  readonly type: BackendType
  send(message: string, options?: SendOptions): Promise<BackendResponse>
  run(ctx: AgentRunContext): Promise<AgentRunResult>
  isAvailable(): Promise<boolean>
}
```

- `send()` — Simple request/response (single-agent CLI mode)
- `run()` — Full workflow context (inbox, channel, MCP tools)
- Both methods on every backend, no adapter layers needed

### daemon/ — Central Process Manager

The daemon is the heart of agent-worker. One daemon process manages:

- **Agent lifecycle**: Create, monitor, destroy agents
- **MCP servers**: Shared context MCP servers for workflows
- **Registry**: Track active agents in `~/.agent-worker/registry.json`
- **IPC**: Unix socket server for CLI communication
- **Health**: Idle timeouts, process monitoring, cleanup

Key design: the daemon is the only long-lived process. CLI commands are
short-lived — they connect, send a request, print the response, and exit.

### context/ — Agent Collaboration

A standalone collaboration system, not workflow-specific:

- **Channel**: Append-only message log with @mentions
- **Inbox**: Per-agent filtered view of channel (mentions + DMs)
- **Documents**: Shared team workspace files
- **Resources**: Content-addressed blob storage
- **Proposals**: Voting system for collaborative decisions
- **MCP Server**: Exposes all above via Model Context Protocol

### workflow/ — Multi-Agent Orchestration

Declarative YAML-defined multi-agent workflows:

- **Parser**: YAML → typed workflow definition
- **Runner**: Initialize runtime (context + MCP + setup commands)
- **Controller**: Per-agent polling loop (check inbox → run → ack → wait)
- **Prompt**: Build structured prompts from workflow context

### cli/ — Thin Presentation Layer

CLI does three things:
1. Parse arguments (commander)
2. Send IPC request to daemon
3. Format and print response

No business logic. No state management. If the daemon isn't running,
start it. Everything else is the daemon's job.

## Key Design Decisions

### Why a daemon?

Without a daemon, each agent is its own process with its own socket server.
This means N processes for N agents, stale registry entries when processes
crash, no shared state, and complex process management in the CLI.

With a daemon, there's ONE process managing everything. The CLI is stateless.
Agent lifecycle, MCP servers, health checks — all centralized.

### Why unified Backend interface?

Previously there were two hierarchies:
- `backends/Backend.send()` for single-agent
- `workflow/controller/AgentBackend.run()` for workflows

Both wrapped the same CLI tools. The adapter layer (`CLIAdapterBackend`)
existed only to bridge them. With one interface, no adapter needed.

### Why top-level context/?

The context system (channel, inbox, documents, MCP) is independently
useful. Nesting it under `workflow/` implied it was workflow-specific.
Promoting it makes the dependency direction clear:
- `workflow/` depends on `context/`
- `context/` depends on nothing
