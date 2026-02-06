# Agent-Worker Architecture Refactoring

**Date**: 2026-02-06
**Branch**: `claude/refactor-agent-worker-arch-0uVss`

## Phase 1: Module Restructuring

| Before | Problem | After |
|--------|---------|-------|
| `cli/index.ts` (1400 lines) | Mixed commands, business logic, formatting | `cli/commands/*` (7 files) |
| `cli/server.ts` (871 lines) | Registry + handler + IPC + skills + lifecycle | `daemon/` (4 files) |
| `workflow/context/` | Context buried under workflow | `context/` (top-level) |
| Model maps in 2 places | Duplicated across backends/ and controller/ | `core/model-maps.ts` (single source) |
| Two init functions | `initWorkflow` and `initWorkflowWithMentions` | Single `initWorkflow` |
| Deprecated aliases | ~300 lines dead code | Removed |

## Phase 2: Consolidation

| Before | Problem | After |
|--------|---------|-------|
| session.ts, models.ts, tools.ts, types.ts at src root | Scattered domain logic | `core/` module |
| `skills-compatibility.ts` (179 lines) | Per-backend filesystem guessing | Deleted. Skills always tool-based. |
| `CLIAdapterBackend` wrapper | Bridge between two interfaces | Deleted. CLI backends implement `run()` natively. |
| 90 lines ANSI formatting in runner.ts | Presentation mixed with business logic | `workflow/display.ts` |

## Key Architectural Decisions

### 1. Single agent = 1-agent workflow (NEXT STEP)

The fundamental insight from the user: single-agent and multi-agent should be THE SAME runtime. A "session" is a workflow with one agent. Differences through simplified parameters, not forked code paths.

This eliminates:
- `handler.ts` if/else branching (session vs backend)
- Two lifecycle managers (AgentSession vs controller)
- Two backend interfaces

Implementation path:
1. AgentSession internally creates 1-agent workflow runtime (lazy)
2. handler.ts processes all requests through workflow runtime
3. CLI `agent new` creates 1-agent workflow
4. Delete AgentSession's own agentic loop, delegate to controller

### 2. Skills always via tools

Skills are loaded by agent-worker and exposed as tools, regardless of backend. Transport (direct SDK tool vs MCP) is a backend concern.

### 3. Daemon as center

One process manages all agents, MCP servers, lifecycle. CLI is stateless.

## Verification

- Build: passes (tsdown)
- Tests: 510 pass, 5 fail (pre-existing timeouts, same on main)
