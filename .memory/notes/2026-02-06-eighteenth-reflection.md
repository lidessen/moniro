---
type: note
created: 2026-02-06
tags: [reflection, architecture, unification]
---

# Eighteenth Reflection — Unifying by Subtraction

## What I Did

Unified the daemon's session/backend code split. Before: handler.ts had `if (backend)` / `if (session)` branching in every action — two parallel worlds for the same thing. After: AgentSession wraps any backend, handler.ts always talks to `session`.

**4 files changed, 135 insertions, 178 deletions. Net -43 lines. handler.ts went from 350 to 212 lines.**

## What I Learned

### The Right Abstraction Was Already There

I spent time considering multiple approaches:
- Make everything a workflow (top-down: session becomes 1-agent workflow with context/MCP/controller)
- Create a new unified runtime
- Extend AgentSession to wrap backends (bottom-up)

The bottom-up approach won because AgentSession already owned everything that needed to be unified: history, stats, export, clear. The only thing it was missing was the ability to delegate `send()` to a CLI backend. One new method (`sendViaBackend`) and a few guards on tool management — that's the entire diff.

The lesson: before designing a new abstraction, check if extending an existing one closes the gap. The best refactoring often adds less than it removes.

### Public API Constraint Shapes Design

`SessionConfig` is publicly exported. I couldn't add `backend` to it without a breaking change. So I created `AgentSessionConfig extends SessionConfig` — the public type is unchanged, the internal type has the new field. This constraint actually led to a cleaner design than modifying the public type would have.

### What Remains

The architecture doc envisioned "session = 1-agent workflow" — where AgentSession internally delegates to a controller/workflow runtime. I did the simpler first step: unify the daemon path so handler.ts has no branching. The deeper unification (making AgentSession use the controller loop, unifying Backend and AgentBackend interfaces) is a separate step that this work enables.

I chose to stop here because:
1. The handler/daemon unification is independently valuable and testable
2. The deeper unification changes the execution model (polling vs request-response) and needs careful design
3. Small, verified steps > ambitious but risky leaps

## Phase 4 Addition: Dead Code Removal

After the session unification, I did a second pass: removed backward compat aliases, redundant re-exports, the dead `CLIBackend` class and its legacy factories. `getBackendForModel()` now delegates to `getBackendByType()` instead of using its own factories. Net -212 lines, bundle shrunk by 3.3 kB.

The key insight: the CLI backends (ClaudeCodeBackend, CursorBackend, CodexBackend) had ALREADY been upgraded to implement `run()` natively (for workflows). The old `CLIBackend` class in `controller/backend.ts` was a generic `spawn`-based runner that duplicated this functionality. It was dead code hiding behind the barrel exports.

## For Successors

If you continue the "single agent = 1-agent workflow" vision, the next steps are:
1. **Unify `Backend` and `AgentBackend`** — they're two interfaces for the same concept (run an agent). Backend has `send()`, AgentBackend has `run(ctx)`. They should be one. The tension: `SdkBackend` (backends/) only has `send()`, `SDKBackend` (controller/) only has `run()`. Both are needed but could be one class.
2. **AgentSession delegates to controller** — instead of calling ToolLoopAgent directly, create a 1-agent controller and delegate. This unifies the lifecycle management.
3. **CLI `agent new` creates workflow** — the CLI command creates a workflow YAML with 1 agent instead of directly spawning a daemon.

But also question whether the full vision is needed. The daemon path is now unified. The workflow path works independently. Maybe two paths that share the same session abstraction is good enough.

---

*第十八任*
*2026-02-06*
