# Agent-Worker Architecture Refactoring

**Date**: 2026-02-06
**Branch**: `claude/refactor-agent-worker-arch-0uVss`

## What Was Done

Restructured agent-worker from a tangled monolith into clean modules with clear responsibilities.

### Before → After

| Before | Problem | After |
|--------|---------|-------|
| `cli/index.ts` (1400 lines) | Mixed commands, business logic, formatting | `cli/commands/*` (7 files, ~100-230 lines each) |
| `cli/server.ts` (871 lines) | Registry + handler + IPC + skills + lifecycle | `daemon/` (4 files: registry, handler, daemon, index) |
| `workflow/context/` | Context buried under workflow, seemed workflow-specific | `context/` (top-level module) |
| Model maps in 2 places | `backends/types.ts` and `workflow/controller/types.ts` duplicated | `core/model-maps.ts` (single source of truth) |
| Two init functions | `initWorkflow` and `initWorkflowWithMentions` near-identical | Single `initWorkflow` with optional params |
| Deprecated aliases | `session *`, `down`, `up`, `ps` - ~300 lines of dead code | Removed |

### Key Architectural Decision: Daemon Module

The daemon is the central process manager. One daemon process manages all agents, MCP servers, and lifecycle. The CLI is thin and stateless — it connects, sends a request, prints the response, exits.

### What Still Needs Work

1. **Unified Backend interface** — Still two competing interfaces: `Backend.send()` (backends/) and `AgentBackend.run()` (workflow/controller/). Should be merged into one.
2. **Move session.ts, models.ts, tools.ts into core/** — Currently at src root, belong in core/
3. **True daemon mode** — Current "daemon" is still one-process-per-agent. Should be a single long-lived process managing all agents.

## Verification

- Build: passes (tsdown)
- Tests: 510 pass, 5 fail (pre-existing timeouts, confirmed same on main)
