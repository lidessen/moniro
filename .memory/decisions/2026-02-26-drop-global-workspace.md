# ADR: Drop Global Workspace, Simplify to Personal + Workspace

**Date**: 2026-02-26
**Status**: Accepted
**Amends**: 2026-02-24-agent-top-level-architecture.md

---

## Problem

The AGENT-TOP-LEVEL proposal (2026-02-24) introduced three layers of context:
1. Agent personal context (memory, soul, notes, todo)
2. Global workspace (shared channel/documents for standalone agents)
3. Workflow workspace (per-workflow channel/documents)

The "global workspace" was an awkward concept — a shared container pretending to be a workspace, trying to answer "where do standalone agents live?" But standalone agents don't need a shared space; they need their own personal context and DM capability.

In the current implementation, standalone agents already expose the contradiction:
- Each gets its own workflow key (`standalone:{name}`) — runtime isolation
- But all share the same directory (`.workflow/global/main/`) — accidental storage sharing
- Worst of both: neither truly shared nor truly isolated

## Decision

**Drop the global workspace. Two data types only: Agent personal context + Workspace.**

### The model

```
Agent (defined in .agents/)
├── Personal context (memory, notes, conversations, config)
│   └── Always available, travels with the agent
│
├── State: idle
│   └── No workspace, DM only, uses personal context
│
└── State: active (in one or more workspaces)
    └── Personal context + workspace context (channel, documents, inbox)
```

### Key design points

1. **"Standalone" is a state, not a type.** All agents in `.agents/` are the same kind of entity. An agent with no active workspace is "idle" — it accepts DMs and works from personal context. No fake `standalone:{name}` workflow needed.

2. **DM is DM, not a workspace message.** `send alice "hi"` goes directly to alice's personal context. It does not post to any channel or workspace.

3. **Collaboration requires explicit workspace.** Two idle agents cannot communicate without a workflow/workspace. This is a correct constraint — want collaboration? Create a workspace. No implicit global fallback.

4. **Borrowing model (借调).** When alice is referenced in a workflow, she's "seconded" to that workspace. She has personal (home) + workspace (local) data. Default read/write targets workspace; accessing personal data is explicit.

5. **Inline agents unchanged.** Workflows can still define agents inline. Inline agents have no personal context — they're temporary, workflow-local.

### Send semantics

```
send alice "hi"              → DM to alice (personal context, no workspace)
send @review @alice "task"   → post to review workspace channel, @mention alice
send alice@review "task"     → wake alice in review workspace context
```

### Data structure (updated)

```
.agents/
├── alice.yaml              # Agent definition
└── alice/                  # Agent personal context
    ├── memory/             # Persistent structured knowledge
    ├── notes/              # Freeform reflections
    ├── conversations/      # DM history
    └── todo/               # Cross-session tasks

.workflows/
├── review.yaml             # Workflow definition

.workspace/                 # Runtime workspaces (no global/)
├── review/main/
│   ├── channel.md
│   ├── documents/
│   └── inbox/
└── review/pr-123/
    ├── channel.md
    ├── documents/
    └── inbox/
```

Note: `.workspace/global/` is gone. No global workspace directory.

### Context layers when borrowed

```
alice in review/pr-123:
  Layer 1: .agents/alice/                 ← personal (identity + memory) — always
  Layer 2: .workspace/review/pr-123/      ← workspace (collaboration) — current mission

  Read/write defaults to Layer 2 (workspace)
  Layer 1 accessible via explicit scope (scope: "personal" / scope: "home")
```

## Consequences

### Positive
- Simpler mental model: personal + workspace, no third layer
- DM is a natural concept, no channel pretending to be DM
- Eliminates the `standalone:{name}` hack in daemon
- Explicit workspace creation for collaboration (no hidden shared state)
- Agent idle state needs no runtime infrastructure (no MCP server until workspace)

### Trade-offs
- Multi-standalone-agent coordination requires creating a workflow (intentional friction)
- Daemon needs new code path for DM (not workspace-based, just agent personal context)

## Implementation Impact

Phase 3 of AGENT-TOP-LEVEL ("Workspace Separation") changes:
- Remove global workspace from WorkspaceRegistry
- Add DM code path in daemon (agent personal context only, no workspace)
- `ensureAgentLoop` for idle agents creates loop with personal context only (no MCP workspace tools)
- When agent joins workflow, add workspace context to existing loop or create new loop with both

## References

- Full design: `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md`
- Superseded concept: "Global Workspace" from the 2026-02-24 proposal
- CLI terminology: `.memory/decisions/2026-02-08-cli-design-unified-terminology.md`
