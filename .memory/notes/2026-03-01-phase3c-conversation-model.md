# Phase 3c: Conversation Model

**Date**: 2026-03-01
**Agent**: Session 021 (第二十一任)
**Status**: Complete — 1014 tests pass (20 new), 0 regressions

## What Was Done

Implemented conversation continuity for agents: ThinThread (bounded in-memory context) + ConversationLog (JSONL persistent history).

1. **`ConversationMessage` type** (`agent/conversation.ts`): Simple message type — `{ role: "user"|"assistant"|"system", content: string, timestamp: string }`. Intentionally distinct from the workflow `Message` type (which has mentions, DMs, event kinds).

2. **`ConversationLog` class** (`agent/conversation.ts`): JSONL append-only storage at `.agents/<name>/conversations/personal.jsonl`. Uses `appendFileSync` for durability (no lost messages on crash). Reads are synchronous (`readFileSync`). Methods: `append`, `readAll`, `readTail`.

3. **`ThinThread` class** (`agent/conversation.ts`): Bounded in-memory buffer. Drops oldest when over capacity. `render()` formats for prompt injection. `ThinThread.fromLog()` restores from ConversationLog tail on agent startup — this gives conversation continuity across restarts.

4. **`thinThreadSection` prompt section** (`workflow/loop/prompt.ts`): New `PromptSection` that renders conversation history. Added to `DEFAULT_SECTIONS` after `inboxSection`. Returns null when no thin thread is present (backwards compatible — workflow agents unaffected).

5. **`AgentRunContext.thinThread`** (`workflow/loop/types.ts`): Optional `ConversationMessage[]` field. Populated by `sendDirect` from the ThinThread buffer.

6. **`AgentLoopConfig` extensions** (`workflow/loop/types.ts`): Added `conversationLog?` and `thinThread?` fields. Passed through from `WiredLoopConfig` → `createAgentLoop`.

7. **`sendDirect` integration** (`workflow/loop/loop.ts`): User messages push to ThinThread + append to ConversationLog before the run. Assistant responses push/append after successful run. The thin thread messages are included in `AgentRunContext` for prompt assembly.

8. **`AgentHandle` lazy accessors** (`agent/agent-handle.ts`): `conversationLog` (returns null for ephemeral agents), `thinThread` (restores from log if exists). Both are lazy-created on first access, surviving across loop stop/restart cycles.

9. **Daemon wiring** (`daemon/daemon.ts`): `ensureAgentLoop` passes `handle.conversationLog` and `handle.thinThread` to `createWiredLoop`.

## Design Decisions

- **Sync I/O for ConversationLog**: `appendFileSync` + `readFileSync`. The conversation file is per-agent and small. Sync append guarantees ordering and durability. The hot path (prompt assembly) reads from ThinThread's in-memory buffer, not from disk.

- **ConversationMessage is NOT the workflow Message type**: Conversation messages are lightweight (role, content, timestamp). Workflow Messages have mentions, DMs, event kinds, tool call metadata. These are different domains — personal conversation vs. multi-agent channel.

- **Ephemeral agents get ThinThread but no ConversationLog**: Ephemeral agents (created via `POST /agents`) exist only in daemon memory. They get an in-memory ThinThread for conversation context during the session, but no disk persistence.

- **ThinThread.fromLog restores on startup**: When an agent handle is accessed for the first time, if a conversation log exists on disk, ThinThread loads the last N messages. This gives seamless conversation continuity across daemon restarts.

- **thinThreadSection in DEFAULT_SECTIONS is safe**: It returns null when `ctx.thinThread` is undefined or empty. Workflow agents never have thinThread set, so the section is a no-op for them.

- **Conversation tracking only in sendDirect (not poll loop)**: The poll loop is for multi-agent workflows where context comes from the channel/inbox. Conversation tracking applies to standalone agents in request-response mode. This can be extended to poll loop in future phases.

## What Changed (File Summary)

| File | Change |
|------|--------|
| `agent/conversation.ts` | **NEW** — ConversationMessage, ConversationLog, ThinThread |
| `agent/agent-handle.ts` | Added lazy `conversationLog` and `thinThread` accessors |
| `agent/index.ts` | Export new types and classes |
| `workflow/loop/types.ts` | `AgentRunContext.thinThread`, `AgentLoopConfig.conversationLog/thinThread` |
| `workflow/loop/prompt.ts` | `thinThreadSection`, `formatConversation`, added to DEFAULT_SECTIONS |
| `workflow/loop/loop.ts` | sendDirect conversation tracking (user/assistant messages) |
| `workflow/factory.ts` | WiredLoopConfig accepts + passes conversation objects |
| `daemon/daemon.ts` | ensureAgentLoop passes handle conversation objects |
| `test/unit/conversation.test.ts` | **NEW** — 32 tests covering all conversation model components |
| `docs/architecture/AGENT-TOP-LEVEL.md` | Phase 3c marked ✅ |

## What's Next

Phase 3d: Priority Queue + Preemption — upgrade AgentLoop to a priority queue with three lanes (immediate/normal/background) and cooperative preemption between steps.

Also remaining: `send` CLI target parsing with daemon integration (deferred since Phase 3b, not blocking).
