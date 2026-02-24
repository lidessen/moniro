# ADR: Agent as Top-Level Entity

**Date**: 2026-02-24
**Status**: Proposed
**Context**: User wants to replace openclaw with agent-worker; needs agents as first-class entities with persistent context

---

## Problem

Agents are currently embedded inside workflows (inline definitions in YAML or lightweight configs in the daemon). This prevents:
- Persistent agent identity (memory, notes, todo)
- Cross-workflow agent reuse
- Agent-level context that travels across collaborations
- Using agents standalone without defining a workflow

## Decision

Elevate Agent to a top-level entity with three orthogonal concepts:

1. **Agent** — Identity + persistent context (prompt, soul, memory, notes, todo)
2. **Workspace** — Collaboration space (channel, documents)
3. **Workflow** — Orchestration (how agents coordinate in a workspace)

Key changes:
- Agents defined in `.agents/*.yaml` with their own context directories
- Workflows reference agents via `ref:` instead of defining them inline
- Each agent carries its own soul, memory, notes, todo across workflows
- Inline definitions still work as workflow-local (temporary) agents
- No breaking changes to existing YAML or CLI

## Consequences

### Positive
- Agents accumulate knowledge over time (memory, notes persist)
- Single agent definition reused across multiple workflows
- Agents work standalone in global workspace without workflow
- Clear separation: who (agent) vs where (workspace) vs how (workflow)

### Risks
- Agent context growth management (memory/notes can grow unbounded)
- Prompt assembly complexity (base + soul + memory + todos + workflow append)
- More files on disk (.agents/, .workflows/, .workspace/)

## Implementation

Five phases documented in `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md`:
1. Agent Definition + Context
2. Workflow Agent References
3. Workspace Separation
4. Agent Context in Prompt
5. CLI + Project Config

## References

- Full design: `packages/agent-worker/docs/architecture/AGENT-TOP-LEVEL.md`
- Previous: `packages/agent-worker/docs/workflow/DESIGN.md` (workflow-centric design)
- Previous: `.memory/decisions/2026-02-08-cli-design-unified-terminology.md` (target syntax)
