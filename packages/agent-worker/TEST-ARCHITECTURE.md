# Agent-Worker Test Architecture

## Current State Assessment

### Coverage Map

| Module | Unit | Integration | E2E | Notes |
|--------|------|-------------|-----|-------|
| **AgentWorker** | Partial | None | None | Config/state tested; `send()` never called through session |
| **AgentWorker.sendStream()** | None | None | None | Completely untested |
| **Backends (SDK/Claude/Codex/Cursor)** | Factory only | Mock CLI | CLI integration | `send()` never tested with mock models |
| **Backend model mapping** | Good | - | - | `getModelForBackend()` well covered |
| **Daemon handler** | None | None | CLI integration | Request dispatch never unit tested |
| **Daemon lifecycle** | None | None | Partial | Server start/stop only via CLI |
| **Session registry** | Good | - | - | register/unregister/list well tested |
| **CLI client (IPC)** | Error paths | None | Partial | Happy path never tested |
| **CLI commands** | Help/flags | Partial | Partial | Many rely on real daemon |
| **Workflow parser** | Good | - | - | validate, parse, interpolate well tested |
| **Workflow runner** | Good | - | - | Setup, kickoff, context init tested |
| **Agent controller** | Good | Good | - | Lifecycle, retry, wake, idle tested |
| **Context (Memory)** | Excellent | MCP tools | - | All operations well covered |
| **Context (File)** | Good | - | - | JSONL, inbox state, documents tested |
| **MCP server** | Good | HTTP transport | - | Tool handlers tested via internal API |
| **Proposals** | Excellent | Simulation | - | Create, vote, resolve, persist tested |
| **Skills system** | Excellent | - | - | Provider, import, security well tested |
| **Bash tools** | Good | - | - | Create, execute, sandbox tested |
| **Multi-agent workflow** | - | Good | - | Mock backends simulate conversations |

### Key Gaps

1. **AgentWorker.send() is never tested through the session** — tests use `generateText()` directly or just test session config. The core user-facing flow (create session → send message → get response with tool calls) is untested.

2. **AgentWorker.sendStream() is completely untested** — no streaming tests at all.

3. **Daemon handler dispatch is untested** — the request routing logic in `handler.ts` that connects CLI commands to session methods is never unit tested. We only discover handler bugs through CLI integration tests.

4. **Backend.send() is never tested with mock models** — `SdkBackend.send()` would need a mock model; CLI backends would need mock processes. Currently only `CursorBackend` has mock CLI tests.

5. **No concurrent access tests** — sessions, channels, and file providers are used concurrently in workflows but never tested for race conditions.

6. **Error propagation paths** — what happens when `send()` fails mid-stream? When a tool throws? When the model returns malformed output?

---

## Architecture Design

### Test Pyramid

```
                    ┌─────────┐
                    │   E2E   │  ← Full CLI process, real sockets
                   ╱│ (few)   │╲    Only in CI or manual
                  ╱ └─────────┘ ╲
                 ╱                ╲
                ╱  ┌────────────┐  ╲
               │   │ Integration│   │  ← Multiple modules together
               │   │ (moderate) │   │    Mock backends, in-process
               │   └────────────┘   │
              ╱                      ╲
             ╱  ┌──────────────────┐  ╲
            │   │     Unit Tests    │   │  ← Single module, mocked deps
            │   │    (majority)     │   │    Fast, deterministic
            │   └──────────────────┘   │
            └──────────────────────────┘
```

### File Organization

```
test/
├── helpers/
│   ├── mock-model.ts         # MockLanguageModelV3 factory helpers
│   ├── mock-backend.ts        # Reusable mock backend factory
│   ├── test-session.ts        # Session creation helpers (reduce boilerplate)
│   └── wait.ts                # waitFor, waitForChannel, waitForIdle
│
├── fixtures/
│   ├── mock-workflow.yaml     # (exists) Basic workflow
│   ├── multi-agent.yaml       # 3+ agent workflow
│   └── setup-workflow.yaml    # Workflow with setup tasks
│
├── unit/                      # Single module, mocked deps
│   ├── session-send.test.ts   # AgentWorker.send() with mock model
│   ├── session-stream.test.ts # AgentWorker.sendStream() with mock model
│   ├── session-tools.test.ts  # Tool calling through session.send()
│   ├── session-approval.test.ts # Approval workflow through send()
│   ├── handler.test.ts        # Daemon handler dispatch
│   ├── sdk-backend.test.ts    # SdkBackend.send() with mock model
│   └── http-transport.test.ts # HTTP transport unit tests
│
├── integration/               # Multiple modules, in-process
│   ├── session-backend.test.ts    # Session + CLI backend
│   ├── controller-context.test.ts # Controller + context + MCP
│   ├── workflow-e2e.test.ts       # Full workflow: parse → run → controller → idle
│   └── concurrent.test.ts         # Concurrent operations safety
│
├── session.test.ts            # (exists) Session config, state, utility tests
├── cli.test.ts                # (exists) CLI instance utilities
├── cli-integration.test.ts    # (exists) CLI process tests
├── cli-commands.test.ts       # (exists) Server, client, command logic
├── cli-backends.test.ts       # (exists) Mock CLI backend tests
├── mock-backend.test.ts       # (exists) Mock backend + agent identity
├── workflow.test.ts           # (exists) Parser, runner, MCP config
├── controller.test.ts         # (exists) Controller, prompt, send, idle
├── context.test.ts            # (exists) Context providers, MCP tools
├── proposals.test.ts          # (exists) Proposal voting system
├── skills.test.ts             # (exists) Skills provider, import
├── workflow-mock-backend.test.ts    # (exists) Multi-agent conversation
└── workflow-simulation.test.ts      # (exists) Simulation scenarios
```

### Shared Test Utilities

#### `helpers/mock-model.ts`

```typescript
// Factory for creating MockLanguageModelV3 with common patterns

import { MockLanguageModelV3 } from 'ai/test'

/** Simple text response */
export function textResponse(text: string, inputTokens = 10, outputTokens = 5) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: { inputTokens, outputTokens },
    },
  })
}

/** Response with tool call then text */
export function toolCallResponse(toolName: string, input: Record<string, unknown>, finalText: string) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [
        { type: 'tool-call' as const, toolCallId: `call-${Date.now()}`, toolName, input },
        { type: 'text' as const, text: finalText },
      ],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: { inputTokens: 20, outputTokens: 15 },
    },
  })
}

/** Sequence of responses (for multi-turn) */
export function sequenceResponses(responses: Array<{ text: string }>) {
  let callIndex = 0
  return new MockLanguageModelV3({
    doGenerate: () => {
      const resp = responses[Math.min(callIndex++, responses.length - 1)]
      return {
        content: [{ type: 'text' as const, text: resp.text }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
  })
}
```

#### `helpers/mock-backend.ts`

```typescript
// Reusable mock backend factory (consolidate from workflow-mock-backend.test.ts)

import type { Backend } from '../../src/backends/types'
import type { ContextProvider } from '../../src/workflow/context/provider'

type BehaviorFn = (
  prompt: string,
  provider: ContextProvider,
  options?: { system?: string }
) => Promise<void>

/**
 * Create a mock backend that uses type 'claude' for normal prompt routing.
 * Behavior function receives the built prompt and can interact with the
 * context provider to simulate MCP tool calls.
 */
export function createMockBackend(behavior: BehaviorFn, provider: ContextProvider): Backend {
  return {
    type: 'claude' as const,
    async send(message: string, options?: { system?: string }) {
      await behavior(message, provider, options)
      return { content: 'ok' }
    },
  }
}

/** No-op backend for idle tests */
export function noopBackend(): Backend {
  return {
    type: 'claude' as const,
    async send() {
      return { content: 'ok' }
    },
  }
}

/** Failing backend for retry tests */
export function failingBackend(failCount: number): Backend {
  let attempts = 0
  return {
    type: 'claude' as const,
    async send() {
      attempts++
      if (attempts <= failCount) throw new Error(`Attempt ${attempts} failed`)
      return { content: 'ok' }
    },
  }
}
```

#### `helpers/wait.ts`

```typescript
// Consolidated from workflow-mock-backend.test.ts and workflow-simulation.test.ts

export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Timeout after ${timeout}ms waiting for condition`)
}

export function getInboxSection(prompt: string): string {
  const start = prompt.indexOf('## Inbox')
  const end = prompt.indexOf('## Recent Activity')
  if (start === -1) return ''
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end)
}
```

---

## Priority Test Scenarios

### P0 — Core User Flows (must have)

#### 1. Session send() with mock model

The core API flow that every user will hit:

```
Session.send("hello") → model generates → response returned
```

**What to test:**
- Text-only response: send message, get text back, verify history and stats updated
- Multi-turn: send → response → send again → verify context accumulation
- Tool calling: model calls tool → tool executes → model uses result → final text
- Token usage tracking across multiple send() calls
- Error: model throws → session state remains consistent

#### 2. Session send() with backend delegation

When using CLI backends (claude, cursor, codex):

```
Session.send("hello") → backend.send() → response returned
```

**What to test:**
- Backend receives message and system prompt correctly
- Response mapped to AgentMessage format
- Usage stats accumulated (even if backend doesn't report usage)
- Backend error → propagated correctly

#### 3. Approval workflow through send()

The approval gate must actually block tool execution:

```
Session.send("delete file") → tool needs approval → pending approval returned
→ session.approve(id) → tool executed → result returned
```

**What to test:**
- Tool with approval: send → response includes pendingApprovals
- Approve: tool executes, result matches
- Deny: tool not executed, deny reason stored
- Conditional approval function: some args need approval, others don't

#### 4. Daemon handler dispatch

Every CLI command goes through the handler. Unit testing it:

**What to test:**
- `send` action → session.send() called with correct args
- `tool_add` action → session.addTool() called
- `tool_mock` action → session.mockTool() called
- `history` action → session.history() returned
- `pending` / `approve` / `deny` → approval workflow
- Unknown action → error response
- Session not found → error response

### P1 — Important Paths (should have)

#### 5. Streaming (sendStream)

```
Session.sendStream("hello") → yields chunks → final response
```

**What to test:**
- Yields text chunks in order
- Final return value has complete response, tool calls, usage
- Backend fallback: CLI backend → yields full response as single chunk

#### 6. Controller ↔ Context ↔ MCP full loop

Test that the controller correctly:
1. Reads inbox from context provider
2. Builds prompt with inbox content
3. Sends to backend
4. Backend uses MCP tools to write to channel
5. Channel message appears in correct inbox
6. Controller acknowledges inbox after success

Currently tested in workflow-mock-backend.test.ts but the "backend uses MCP tools" part is simulated by directly calling `provider.appendChannel()`. A more realistic test would have the mock backend actually call MCP tool handlers.

#### 7. Concurrent channel operations

```
3 agents write to channel simultaneously → no lost messages
10 rapid inbox checks → consistent state
```

**What to test:**
- Parallel appendChannel calls → all messages present
- Parallel getInbox + appendChannel → no corruption
- FileContextProvider under concurrent writes → JSONL integrity

#### 8. HTTP transport

The MCP server exposed over HTTP:

**What to test:**
- Server starts on random port
- Agent identity extracted from URL query parameter
- Tool call routed to correct handler
- Server cleanup on close

### P2 — Edge Cases (nice to have)

#### 9. Session state edge cases
- Restore session with corrupt state (missing fields)
- Send after clear() resets everything
- addTool on CLI backend → throws
- mockTool with execute that throws → error propagated in send()

#### 10. Workflow lifecycle edge cases
- Workflow with 0 agents → validation error
- Kickoff with missing variable → unresolved template kept
- Setup task timeout
- Controller stop during active run

#### 11. Backend availability checking
- checkBackends when binaries not found → false for CLI backends
- Timeout handling in isAvailable()

---

## Existing Issues to Fix

### 1. `proposals.test.ts` uses `vitest` instead of `bun:test`

```typescript
// Line 6: import { describe, test, expect, beforeEach } from 'vitest'
// Should be: import { describe, test, expect, beforeEach } from 'bun:test'
```

Also has double import of `afterEach` (line 658).

### 2. Backend timeout tests

`checkBackends` and `listBackends` tests timeout (5s) because they check CLI availability by spawning processes. Consider:
- Mocking `execa` for availability checks
- Or moving these to integration tests with longer timeout

### 3. CLI integration tests fragile

Tests depend on daemon startup timing (500ms sleeps). Consider:
- Using proper wait-for-socket-ready pattern
- Or restructuring to test command logic separately from process spawning

---

## Testing Strategy by Layer

### Layer 1: Pure Logic (no I/O, no async)

Files: `instance.ts`, `model-maps.ts`, `interpolate.ts`, `prompt.ts`

Strategy: Direct import → call → assert. Already well tested.

### Layer 2: Stateful Logic (async, in-memory)

Files: `worker.ts`, `memory-provider.ts`, `proposals.ts`, `controller.ts`

Strategy: Create instance → exercise API → verify state. Need `MockLanguageModelV3` for session.send(). Controller needs mock backend.

### Layer 3: I/O Boundary (filesystem, network, processes)

Files: `file-provider.ts`, `http-transport.ts`, `daemon.ts`, `handler.ts`, `cli backends`

Strategy: Temp directories for file tests. Random ports for HTTP. Mock process spawning for CLI backends.

### Layer 4: Full System (multiple components)

Files: `runner.ts`, CLI commands

Strategy: In-process with mock backends for runner tests. Process-level for CLI tests (slower, fewer).

---

## Mock Model Integration Pattern

The biggest gap is testing `AgentWorker.send()` → model → response. The pattern:

```typescript
import { MockLanguageModelV3 } from 'ai/test'
import { AgentWorker } from '../src/agent/session'

// Override model creation to use mock
// Option A: Pass mock model directly (requires API change)
// Option B: Mock the createModelAsync function
// Option C: Use ToolLoopAgent with mock model directly

// Recommended: Option B - mock at module level
import { mock } from 'bun:test'

// In beforeEach:
mock.module('../src/agent/models.ts', () => ({
  createModelAsync: async () => mockModel,
  createModel: () => mockModel,
  // ... other exports
}))
```

This approach lets us test the full `send()` flow including:
- Message accumulation
- Tool loop execution
- Usage tracking
- Approval gating
- Error handling

Without requiring any source code changes.

---

## Execution Plan

1. **Phase 1**: Create `test/helpers/` with shared utilities
2. **Phase 2**: Write `session-send.test.ts` — the biggest gap
3. **Phase 3**: Write `handler.test.ts` — daemon dispatch
4. **Phase 4**: Fix `proposals.test.ts` vitest→bun:test
5. **Phase 5**: Move timeout-prone tests, add concurrent tests
