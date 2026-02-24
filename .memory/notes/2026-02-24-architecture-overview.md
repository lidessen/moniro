---
type: note
created: 2026-02-24
tags: [agent-worker, architecture, design]
---

# Architecture Overview & Design Documents

## What Was Done

Created `packages/agent-worker/docs/architecture/OVERVIEW.md` — a design arc document that explains *why* the architecture is shaped the way it is, layer by layer.

Also created two proposed architecture documents (in the same session, prior to context compaction):
- `AGENT-TOP-LEVEL.md` — Agent as top-level persistent entity (soul, memory, notes, todo)
- `GUARD-AGENT.md` — Guard Agent (看守者) for context curation, memory mediation, identity governance

Updated `ARCHITECTURE.md` and `README.md` to reference the new documents.

## Key Insight

The architecture tells a story of progressive enrichment. Each layer exists because the previous one created a capability that exposed a new limitation:

1. AgentWorker → can talk to LLM but coupled to one SDK
2. Backend → any LLM tool, but no agent collaboration
3. Three-Layer Context → shared state, but no routing
4. @mention → routing, but no lifecycle management
5. Controller → lifecycle, but no team orchestration
6. Workflow → teams, but no structured decisions
7. Proposals → decisions, but context windows overflow
8. Smart Send → protected windows, but no multi-client access
9. Daemon → unified service, but no persistent agent identity
10. Agent Identity (proposed) → persistent soul/memory, but naive context assembly
11. Guard Agent (proposed) → curated context, mediated memory, governed evolution

The fundamental bet: don't make agents smarter, make their environment richer. Agents are ephemeral tool loops with better context each time they wake.

## Research Incorporated

Prior to writing the design documents, extensive research was conducted on:
- Guard/Gatekeeper patterns (GUARDIAN, SentinelAgent, PeerGuard, NeuralTrust)
- Context management (Anthropic's 4 strategies, Manus logit masking, Google ADK)
- Memory mediation (Collaborative Memory paper, MINJA attack, Letta memory blocks)
- Soul/Identity (SOUL.md pattern, OpenClaw 3-layer, behavioral over aspirational)
- Storage (AgentFS/Turso convergence of file interface + SQLite backend)

Key finding: OpenClaw's "files as truth, SQLite as derived index" pattern is the right hybrid for our use case — human-readable + git-friendly + queryable.

## For Those Who Come After

The OVERVIEW.md is designed as the "start here" for understanding design intent. ARCHITECTURE.md remains the module reference. The two proposed documents (AGENT-TOP-LEVEL.md, GUARD-AGENT.md) are detailed enough to implement from — they include types, schemas, phased implementation plans, and open questions.

The next step is implementation of Phase 1 of AGENT-TOP-LEVEL: `AgentDefinition` type, YAML parser, `AgentHandle`, `AgentRegistry`.
