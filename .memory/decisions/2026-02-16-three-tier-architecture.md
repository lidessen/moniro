---
type: decision
status: active
tags: [architecture, agent-worker, three-tier, daemon, worker]
created: 2026-02-16
---

# Three-Tier Architecture: Interface → Daemon → Worker

## Context

agent-worker's goal is to build a multi-agent collaboration system. The previous architecture implied three-layer separation (CLI / daemon / agent+controller), but did not explicitly define the contract and boundaries of each layer.

Inspiration:
- **NanoClaw**: Minimal pipeline WhatsApp → SQLite → Polling → Container → Response, container-runner as pure execution unit
- **nanobot (HKUDS)**: Agent Kernel vision, minimal stable kernel + plugin interfaces (BaseChannel, BaseTool, LLMProvider)
- **OpenClaw**: Cautionary example — 52 modules, 45 dependencies of bloat, a reminder to keep the daemon kernel lean

## Decision

Establish a three-tier architecture:

```
Interface (Interface Layer) → Daemon (Kernel Layer) → Worker (Worker Layer)
```

### Interface — Interface Layer

- Stateless, pure protocol translation
- CLI, Web UI, External MCP clients are equal peers
- Holds no state, makes no scheduling decisions

### Daemon — Kernel Layer

- Single process, sole authority for all state
- Owns: Registry, Scheduler, Context, StateStore, Lifecycle
- Decides: who executes when, with what context
- Holds Daemon MCP: exposes context tools to workers (analogous to syscall interface)

### Worker — Worker Layer

- Pure execution: `f(prompt, tools) → result`
- Gains collaboration capabilities via Daemon MCP (channel, document, proposal)
- Holds own Worker MCP for execution capabilities (bash, file ops, custom tools)
- Knows nothing about scheduling, does not handle retry, holds no lifecycle state

### Two Kinds of MCP

| Type | Held by | Purpose | Analogy |
|------|---------|---------|---------|
| Daemon MCP | Daemon | Context tools (channel_send, inbox_read, document_write...) | syscall interface |
| Worker MCP | Worker | Task tools (bash, file, custom MCP servers) | process libraries |

### Context Exposed via MCP

```
✗  Daemon assembles context → stuffs into prompt → passes to worker
✓  Daemon starts MCP server → worker connects → calls context tools on demand
```

Workers can only access context through Daemon MCP tools, never directly reading or writing context storage. This is the sandboxing guarantee.

## Consequences

1. **AgentController responsibilities must be split**: scheduling/retry/polling goes to daemon scheduler, execution goes to worker. Controller as an independent concept will dissolve.
2. **Interface layer needs independent abstraction**: Currently the MCP endpoint is inside the daemon; need to distinguish Daemon MCP (for workers) from Interface MCP (for external clients).
3. **Worker becomes purer**: Remove worker awareness of scheduling, making it callable by any orchestrator.
4. **Unified terminology**: Execution unit is uniformly called "worker", no longer mixing runner/agent/session.

## Related

- [Technology Choices](./2026-02-16-technology-choices.md) — follow-up technology choices (SQLite, subprocess, message model)
- [ARCHITECTURE.md](../../packages/agent-worker/ARCHITECTURE.md) — main architecture document (updated)
- [workflow/DESIGN.md](../../packages/agent-worker/docs/workflow/DESIGN.md) — workflow design (updated)
- [2026-02-08 CLI Unified Terminology](./2026-02-08-cli-design-unified-terminology.md) — previous terminology unification decision
- [2026-02-06 Arch Refactor Notes](../.memory/notes/2026-02-06-agent-worker-arch-refactor.md) — Phase 3/4 refactoring notes
