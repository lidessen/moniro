# Phase 0 Pre-Implementation Cleanup

**Date**: 2026-02-27
**Agent**: Session 018 (Phase 0 implementer)
**Status**: Complete — all 6 tasks done, 880 tests pass

## What Was Done

Structural preparation for AGENT-TOP-LEVEL architecture:

1. **Renamed types**: `AgentDefinition` → `WorkflowAgentDef`, `ResolvedAgent` → `ResolvedWorkflowAgent` across 14 files. Frees the names for Phase 1.

2. **Decoupled AgentConfig**: `workflow` and `tag` are now optional. Standalone agents no longer pretend to belong to a workflow at creation. CLI handles the undefined case.

3. **Added lifecycle tests**: 8 new tests covering create → findLoop → execute → delete → cleanup paths. Safety net for the structural changes in tasks 4-5.

4. **Extracted loop ownership**: `DaemonState.loops: Map<string, AgentLoop>` now exists alongside `workflows`. `findLoop()` checks daemon loops first, then workflow-scoped loops. `ensureAgentLoop()` stores in both. This is the key structural inversion for Phase 3.

5. **Formalized standalone convention**: `standaloneKey()` helper, `STANDALONE_PREFIX` constant, `WorkflowHandle.standalone` flag. GET /health and GET /workflows filter out standalone handles. The magic string `standalone:` is now centralized and typed.

6. **Made buildAgentPrompt composable**: `PromptSection` type, each section is an independent function, `DEFAULT_SECTIONS` list, `assemblePrompt()` combinator. Phase 5 can inject soul/memory/todo as new sections without touching existing code.

## Design Decisions

- **Did NOT build FileStateStore**: Phase 3 replaces SessionState entirely with JSONL ConversationLog + ThinThread. Building FileStateStore for the current shape would be wasted work.

- **Did NOT refactor ContextProvider**: Current interface maps cleanly to Workspace. Personal context is a new module, not a split of the existing one.

- **Kept standalone WorkflowHandle**: It still manages runtime resources (MCP server, context provider). Removing it entirely requires a new structure for per-agent resource management, which is Phase 3 scope.

## What's Next

Phase 1: Agent Definition + Context
- New `AgentDefinition` type (prompt, soul, context fields)
- Agent YAML parser (`.agents/*.yaml`)
- `AgentHandle` with context operations
- `AgentRegistry` — loads and manages definitions
- CLI: `agent create`, `agent list`, `agent info`
- Agent context directory auto-creation

## Lesson

The rename was the easiest task but had the highest value — it removed naming ambiguity before it could compound across new code. Type names are architectural signals. Getting them right early saves confusion for every agent that follows.
