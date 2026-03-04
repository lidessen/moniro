# Three-Package Split Design Session

**Date**: 2026-03-02
**Agent**: Session 022
**Status**: Design complete, ready for implementation

## What Was Done

Designed the three-package split for `packages/agent-worker/` through iterative discussion with the user. Four key design decisions were made through dialectic:

### Decision 1: Three Layers

Split into `@moniro/agent` (Worker), `@moniro/workflow` (Orchestration), `agent-worker` (System). Each maps to a distinct use case: fire-and-forget, one-shot workflow, persistent daemon.

### Decision 2: System Can Depend on Agent Directly

The dependency graph is not strictly linear. System layer can import from both Agent and Workflow:

```
@moniro/agent
    ▲       ▲
    │       │
@moniro/workflow   │
    ▲       │
    │       │
agent-worker ───┘
```

Rule: no upward dependencies. Same or lower layer only.

### Decision 3: Tools Split Agent Infrastructure vs Workflow Implementation

- **Agent layer**: tool registration infrastructure (`create-tool.ts`) + skills loading (provider, importer). The ability to HAVE tools.
- **Workflow layer**: specific tool implementations (bash, feedback). The actual environment capabilities.

Agent provides slot; Workflow fills them.

### Decision 4: Personal Context in Agent Layer

Personal context tools (memory, notes, todos) belong in the Agent layer as an optional toolkit with pluggable storage.

**Why Agent, not System?**
1. Skills (Agent layer) need to read/write memory — circular dependency if personal context is only in System
2. Even fire-and-forget agents benefit from session-scoped context (in-memory storage, lost on GC)
3. Personal context is just tools + storage interface — no coupling added

**The split**:
- Agent layer: `PersonalContextStorage` interface + `MemoryStorage` (ephemeral) + `FileStorage` (generic) + `createPersonalContextTools(storage)`
- Workflow layer: does NOT touch personal context (only shared context: channel/inbox/docs)
- System layer: wires `FileStorage` to `AgentHandle.contextDir` persistent paths

Three scenarios, same tool definitions, different storage backends:
- Standalone: `MemoryStorage` (session-scoped, lost on GC)
- Workflow: could use `FileStorage` with workflow-scoped dir
- System: `FileStorage` pointing to `.agents/<name>/context/`

## Artifacts Created

| File | Content |
|------|---------|
| `packages/agent-worker/docs/architecture/PACKAGE-SPLIT.md` | Full design: file mapping, APIs, dependency graph, migration path |
| `packages/agent-worker/ARCHITECTURE.md` | Updated with three-package direction section |
| `.memory/context.md` | Updated: Phase 4 = Package Split, phases renumbered |
| `.memory/todos/index.md` | Updated: Phase 4 steps as active tasks |

## Migration Path

Four steps, each producing green build + passing tests:
1. Barrel exports within existing package (boundary validation)
2. Extract `@moniro/agent`
3. Extract `@moniro/workflow`
4. Clean up `agent-worker` (System only)

## For Those Who Come After

The design was reached through dialectic, not top-down planning. Each decision was challenged:
- "Should System depend on Agent directly?" → Yes, the graph needn't be linear.
- "Should tools split between layers?" → Yes: infrastructure vs implementation.
- "Should personal context be Agent or System?" → Agent, because skills need it and storage is pluggable.

The key insight: **personal context is tools + storage interface, not persistence**. Persistence is just one storage backend. This keeps the Agent layer clean while enabling the full range of use cases.

When implementing, start with Step 1 (barrel exports). This validates the boundaries before any physical file moves. If circular dependencies surface during barrel creation, the boundaries need adjustment — better to find that before splitting packages.
