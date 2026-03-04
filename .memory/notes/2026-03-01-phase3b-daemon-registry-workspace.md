# Phase 3b: Daemon Agent Registry + Workspace

**Date**: 2026-03-01
**Agent**: Session 020 (第二十任)
**Status**: Complete — 994 tests pass, 0 regressions

## What Was Done

Replaced the daemon's internal data model with proper domain objects per the AGENT-TOP-LEVEL architecture:

1. **`Workspace` type** (`factory.ts`): Renamed `WorkflowRuntimeHandle` → `Workspace`. Same fields, clearer semantics. A workspace is the shared collaboration infrastructure (context, MCP, event log) that agents operate within.

2. **`WorkspaceRegistry`** (`daemon/workspace-registry.ts`): Simple registry managing active workspaces by key. Methods: set, get, has, delete, shutdownAll. Used by daemon for standalone agent workspaces.

3. **`AgentHandle` extensions** (`agent-handle.ts`):
   - Added `loop: AgentLoop | null` — agent owns its execution loop (lazy creation)
   - Added `ephemeral: boolean` — distinguishes persistent (.agents/*.yaml) from ephemeral (daemon API) agents
   - Constructor accepts new `ephemeral` parameter (defaults to false)

4. **`AgentRegistry.registerEphemeral()`** (`agent-registry.ts`): New method for daemon-created agents. No YAML file, no context directory creation. Also updated `delete()` to skip disk cleanup for ephemeral agents.

5. **`DaemonState` refactored** (`daemon.ts`):
   - `configs: Map<string, AgentConfig>` → `agents: AgentRegistry`
   - `loops: Map<string, AgentLoop>` → loops stored on `AgentHandle.loop`
   - Added `workspaces: WorkspaceRegistry`
   - `WorkflowHandle.contextProvider` → `WorkflowHandle.workspace: Workspace`
   - Removed `standalone?: boolean` from `WorkflowHandle`

6. **`standalone:` hack eliminated**: No more `STANDALONE_PREFIX`, `standaloneKey()`, or synthetic workflow handles for standalone agents. Standalone agents store their loop on `AgentHandle.loop` and their workspace in `WorkspaceRegistry` keyed by `"agent:{name}"`.

7. **Daemon helper refactored**:
   - `configToResolvedWorkflowAgent()` → `defToResolvedAgent()` (works with `AgentDefinition`)
   - `findLoop()` simplified — checks handle.loop first, then workflow loops
   - `ensureAgentLoop()` stores workspace in registry instead of fake workflow handle
   - `POST /agents` creates `AgentDefinition` + registers ephemeral via registry
   - Health/list endpoints use registry instead of Map
   - MCP endpoint uses workspace registry instead of workflow handle lookup

## Design Decisions

- **Ephemeral agents skip context dirs**: They exist only in daemon memory. No disk I/O for creation/deletion. This keeps `POST /agents` fast and clean.

- **`AgentHandle.loop` is mutable**: The loop is set lazily on first run/serve. This is intentional — loops are expensive to create (MCP server, backend), so they're only created when needed.

- **Workspace key format `"agent:{name}"`**: Clear prefix to distinguish from workflow keys (`"review:pr-123"`). Not `"standalone:"` because that implies a hack; `"agent:"` is the permanent convention.

- **`WorkflowHandle.workspace` holds a `Workspace` reference**: Workflows still manage their own loops via `WorkflowHandle.loops`, but their shared infrastructure is now typed as `Workspace`. This is structural — for POST /workflows, we wrap the runner's result in a Workspace-compatible object.

- **`send` CLI deferred**: The architecture doc lists it under Phase 3b, but the existing target.ts already handles parsing. Full daemon integration for `send` can be done independently; it doesn't block Phase 3c.

## What Changed (File Summary)

| File | Change |
|------|--------|
| `workflow/factory.ts` | `WorkflowRuntimeHandle` → `Workspace` (type rename) |
| `daemon/workspace-registry.ts` | **NEW** — WorkspaceRegistry class |
| `agent/agent-handle.ts` | Added `loop`, `ephemeral` fields |
| `agent/agent-registry.ts` | Added `registerEphemeral()`, updated `delete()` |
| `daemon/daemon.ts` | Full refactor: AgentRegistry + WorkspaceRegistry, removed standalone hack |
| `daemon/index.ts` | Export WorkspaceRegistry |
| `test/unit/daemon-api.test.ts` | Rewritten for new DaemonState shape |
| `docs/architecture/AGENT-TOP-LEVEL.md` | Phase 3b marked ✅ |

## What's Next

Phase 3c: Conversation Model — ThinThread + ConversationLog. Depends on this phase (agents must exist in daemon to own conversations).

Also remaining from Phase 3b: `send` CLI target parsing with daemon integration (deferred, not blocking).
