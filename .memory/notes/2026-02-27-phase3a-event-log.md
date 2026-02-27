# Phase 3a: Event Log Infrastructure

**Date**: 2026-02-27
**Agent**: Session 019 (第十九任)
**Status**: Complete — 954 tests pass, 0 regressions

## What Was Done

Implemented the three-layer event log infrastructure per the unified-logger ADR:

1. **EventSink interface** (`stores/timeline.ts`): Minimal write-only abstraction — `append(from, content, options?)`. Shared by all three layers.

2. **DefaultTimelineStore** (`stores/timeline.ts`): Per-agent JSONL append-only log using `StorageBackend`. Fire-and-forget writes, incremental read via byte offsets. Same pattern as existing `ChannelStore`.

3. **DaemonEventLog** (`daemon/event-log.ts`): Daemon-level JSONL using synchronous `appendFileSync` — daemon events are infrequent and must not be lost. Incremental read support for future `logs` CLI command.

4. **createEventLogger** (`logger.ts`): Bridges `Logger` → `EventSink`. Same interface as `createChannelLogger` — consumers don't know which sink they write to.

5. **createConsoleSink** (`logger.ts`): Stderr fallback for CLI without daemon. Drops debug events.

6. **Logger injection**: Daemon → `DaemonEventLog` at startup. Registry → child logger. AgentHandle, AgentWorker, SkillImporter all accept optional `Logger`.

7. **console.* elimination**: All library `console.log/warn/error` replaced with injected logger. Display-layer `console.*` (display-pretty.ts, runner.ts) preserved — that's intentional user output.

## Design Decisions

- **EventSink is synchronous void** (not `Promise<void>`): Logging must never block. Fire-and-forget is the only correct pattern for event logging in an agent loop. Both `ChannelStore` and `DaemonEventLog` handle async internally.

- **Logger is optional everywhere**: Added as optional constructor parameter, never required. CLI commands that don't go through the daemon can work without a logger — errors are silently skipped. This prevents breaking existing call sites.

- **Display-layer console.* preserved**: `display-pretty.ts` and `runner.ts` use `console.log/error` for user-facing terminal output. These are the display layer, not library code. The ADR's goal is "library code zero console.*", not "zero console.* everywhere."

- **discoverAgents default changed**: Was `console.warn`, now silent no-op when no logger. The registry always provides a warn function via its logger, so the only code path without logging is direct `discoverAgents()` calls — which should decide their own logging strategy.

## What's Next

Phase 3b: Daemon Agent Registry + Workspace — see AGENT-TOP-LEVEL.md for details.

Optional: `agent-worker logs` CLI command (deferred, can be added anytime).
