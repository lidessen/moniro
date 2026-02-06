# agent-worker Architecture

## Overview

agent-worker provides programmatic control over AI agent conversations — both single-agent sessions and multi-agent workflows.

## Module Structure

```
src/
├── index.ts                    # Public API (library usage)
│
├── core/                       # Pure domain logic
│   ├── index.ts                # Re-exports
│   ├── types.ts                # Core types (AgentMessage, ToolDefinition, etc.)
│   ├── session.ts              # AgentSession — SDK-based agentic loop
│   ├── models.ts               # Model creation, provider registry
│   ├── model-maps.ts           # Model name translation (single source of truth)
│   └── tools.ts                # ToolDefinition → AI SDK tool conversion
│
├── backends/                   # AI provider adapters
│   ├── types.ts                # Backend interface (send + run + isAvailable)
│   ├── index.ts                # Factory + availability checks
│   ├── sdk.ts                  # Vercel AI SDK backend
│   ├── claude-code.ts          # Claude Code CLI backend
│   ├── codex.ts                # Codex CLI backend
│   ├── cursor.ts               # Cursor CLI backend
│   └── mock.ts                 # Mock backend (testing)
│
├── daemon/                     # Central process manager
│   ├── index.ts                # Re-exports
│   ├── daemon.ts               # Daemon: manages agents, MCP, lifecycle
│   ├── registry.ts             # Persistent agent registry (~/.agent-worker/)
│   └── handler.ts              # Request → Response dispatch
│
├── context/                    # Agent collaboration (standalone)
│   ├── index.ts                # Re-exports
│   ├── types.ts                # Channel, inbox, document types
│   ├── provider.ts             # ContextProvider interface + implementation
│   ├── storage.ts              # StorageBackend interface
│   ├── file-provider.ts        # File-based storage
│   ├── memory-provider.ts      # In-memory storage (testing)
│   ├── mcp-server.ts           # MCP server exposing context tools
│   ├── http-transport.ts       # HTTP transport for MCP
│   └── proposals.ts            # Proposal/voting system
│
├── workflow/                   # Agent orchestration
│   ├── types.ts                # Workflow schema types
│   ├── parser.ts               # YAML workflow parser
│   ├── interpolate.ts          # Variable interpolation (${{ }})
│   ├── runner.ts               # Workflow runtime (init + run)
│   ├── display.ts              # Channel output formatting (ANSI)
│   ├── logger.ts               # Structured logger
│   └── controller/             # Agent lifecycle management
│       ├── controller.ts       # Poll + retry + wake loop
│       ├── backend.ts          # Backend selection + factories
│       ├── prompt.ts           # Agent prompt building
│       ├── send.ts             # Send target parsing
│       ├── mcp-config.ts       # MCP config generation
│       └── types.ts            # Controller types
│
├── skills/                     # Skills system (always tool-based)
│   ├── index.ts                # Re-exports
│   ├── provider.ts             # SkillsProvider (scan/load)
│   ├── importer.ts             # Git-based skill import
│   └── import-spec.ts          # Import spec parsing
│
├── tools/                      # Built-in tools
│   ├── bash.ts                 # Bash tool
│   └── skills.ts               # Skills tool (createSkillsTool)
│
└── cli/                        # Thin presentation layer
    ├── index.ts                # Entry: setup program, import commands
    ├── client.ts               # Unix socket IPC client
    ├── instance.ts             # Agent@instance naming utilities
    └── commands/               # One file per command group
        ├── agent.ts            # new, list, status, use, end
        ├── send.ts             # send, peek, stats, export, clear
        ├── tool.ts             # tool add, import, mock, list
        ├── workflow.ts         # run, start, stop
        ├── approval.ts         # pending, approve, deny
        ├── context.ts          # context channel/document commands
        └── info.ts             # providers, backends
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

### Single agent = 1-agent workflow (NEXT)

The fundamental insight: single-agent mode and multi-agent workflows
should be THE SAME runtime. A "session" is just a workflow with one agent.

```
Workflow (core abstraction)
├── 1 agent  →  "session" (simplified CLI + programmatic API)
├── N agents →  "workflow" (YAML config, full collaboration)
└── Shared infrastructure (daemon, MCP, context, backend)
```

This eliminates:
- handler.ts `if(backend)/if(session)` branching
- Two separate lifecycle managers (AgentSession vs controller)
- Two backend interfaces (Backend.send vs AgentBackend.run)
- Inconsistent tool/skill delivery across modes

CLI stays simple: `agent-worker new -m model` creates a 1-agent workflow
implicitly. User doesn't need to think about workflows.

Programmatic API stays simple: `AgentSession` becomes a facade over a
1-agent workflow runtime. Context/MCP initializes lazily.

**Implementation path:**
1. AgentSession internally creates 1-agent workflow runtime (lazy)
2. handler.ts processes all requests through workflow runtime
3. CLI `agent new` creates 1-agent workflow (not a separate process)
4. Delete AgentSession's own agentic loop, delegate to controller

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

### Why unified skills via tools?

Skills are always loaded by agent-worker and exposed as tools, regardless
of backend. The transport mechanism (direct SDK tool vs MCP) is a
backend detail. This eliminates the per-backend filesystem path guessing
that was in `skills-compatibility.ts`.
