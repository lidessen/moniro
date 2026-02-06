# Agent Worker Workflow Implementation

Implementation tasks for the workflow design.

**Related documents:**
- [DESIGN.md](./DESIGN.md) - Design concepts and decisions
- [REFERENCE.md](./REFERENCE.md) - Implementation details, interfaces, code examples

---

## Phase 0: Migration (Refactor Existing Code)

Refactor existing Phase 1-6 implementation to align with new design.

### Storage Structure Migration

Current structure:
```
.workflow/instance/
├── .mention-state.json    # Flat in context dir
├── channel.md
└── notes.md               # Single document file
```

Target structure:
```
.workflow/instance/
├── _state/                # Internal state directory
│   ├── inbox-state.json   # Renamed from .mention-state.json
│   └── proposals.json     # Active proposals (Phase 11)
├── channel.md
└── documents/             # Multi-file document directory
    ├── notes.md           # Default entry point
    └── decisions.md       # Archived decisions (Phase 11)
```

### Types Changes (`context/types.ts`)

- [x] Rename `MentionNotification` → `InboxMessage`
- [x] Add `priority` field to `InboxMessage` (normal | high)
- [x] Add `InboxState` interface
- [x] Update `CONTEXT_DEFAULTS`:
  - [x] Keep `channel: 'channel.md'`
  - [x] Change `document: 'notes.md'` → `documentDir: 'documents/'`
  - [x] Add `defaultDocument: 'notes.md'`
  - [x] Add `stateDir: '_state/'`

### Provider Interface Changes (`context/provider.ts`)

- [x] Rename method: `getUnreadMentions()` → `getInbox()`
- [x] Rename method: `acknowledgeMentions()` → `ackInbox()`
- [x] Remove `getAllMentions()` (not needed with new inbox model)
- [x] Update `readDocument()` signature: add optional `file?: string` parameter
- [x] Update `writeDocument()` signature: add optional `file?: string` parameter
- [x] Update `appendDocument()` signature: add optional `file?: string` parameter
- [x] Add `listDocuments()` method
- [x] Add `createDocument(file: string, content: string)` method

### FileContextProvider Changes (`context/file-provider.ts`)

- [x] Update constructor: accept `documentDir` instead of `documentPath`
- [x] Update `mentionStatePath` → `_state/inbox-state.json`
- [x] Rename `mentionState` → `inboxState`
- [x] Rename `loadMentionState()` → `loadInboxState()`
- [x] Rename `saveMentionState()` → `saveInboxState()`
- [x] Rename `getUnreadMentions()` → `getInbox()`
- [x] Rename `acknowledgeMentions()` → `ackInbox()`
- [x] Remove `getAllMentions()` method
- [x] Update document methods for multi-file support:
  - [x] `readDocument(file?)` - default to `notes.md`
  - [x] `writeDocument(file?, content)` - default to `notes.md`
  - [x] `appendDocument(file?, content)` - default to `notes.md`
- [x] Add `listDocuments()` implementation
- [x] Add `createDocument(file, content)` implementation
- [x] Update `createFileContextProvider()` factory function

### MemoryContextProvider Changes (`context/memory-provider.ts`)

- [x] Rename `mentionState` → `inboxState`
- [x] Change `document` string → `documents` Map<string, string>
- [x] Rename `getUnreadMentions()` → `getInbox()`
- [x] Rename `acknowledgeMentions()` → `ackInbox()`
- [x] Remove `getAllMentions()` method
- [x] Update document methods for multi-file support
- [x] Add `listDocuments()` implementation
- [x] Add `createDocument(file, content)` implementation
- [x] Update `getMentionState()` → `getInboxState()` (test helper)

### MCP Server Changes (`context/mcp-server.ts`)

**Breaking Change:**
- [x] **Remove auto-acknowledge from `channel_read`**

Tool updates:
- [x] Update `channel_mentions` → `inbox_check` (rename only)
- [x] Add `inbox_ack` tool (explicit acknowledgment)
- [x] Add `file` parameter to `document_read`
- [x] Add `file` parameter to `document_write`
- [x] Add `file` parameter to `document_append`
- [x] Add `document_list` tool
- [x] Add `document_create` tool

> **Note**: `onMention` callback is added in Phase 8 (Agent Controller).

### Workflow Types Changes (`workflow/types.ts`)

- [x] Update `ResolvedFileContext`:
  - [x] Rename `document: string` → `documentDir: string`
- [x] Add `documentOwner?: string` to context config types
- [x] Update `FileContextConfig` for documentOwner at context level

### Runner Changes (`workflow/runner.ts`)

- [x] Update `createFileContextProvider()` call: pass `documentDir` instead of `documentFile`
- [x] Ensure `_state/` directory is created (via FileContextProvider)
- [x] Ensure `documents/` directory is created (via FileContextProvider)

### Parser Changes (`workflow/parser.ts`)

- [x] Update context resolution: `document` → `documentDir`
- [x] Add `documentOwner` parsing and validation

### Test Updates

- [ ] Update any tests using old method names
- [ ] Update any tests using old storage paths

### Validation (Phase 0)

- [x] **TypeScript**: All workflow files pass type checking
- [ ] **Unit tests**: MemoryContextProvider passes all tests with new interface
- [ ] **Unit tests**: FileContextProvider passes all tests with new interface
- [ ] **Unit tests**: MCP server tools work correctly (inbox_check, inbox_ack, document_*)
- [ ] **Integration test**: Create workflow, send messages, verify inbox/ack flow
- [ ] **Integration test**: Multi-file document operations (create, list, read, write)
- [ ] **Manual test**: `agent-worker run` with sample workflow, verify storage structure

> **Note**: No backward compatibility with old storage structure. Clean break - new design only.

---

## Phase 1: Context Provider

- [x] Define `ContextProvider` interface
- [x] Implement `FileContextProvider` (markdown storage)
- [x] Implement `MemoryContextProvider` (testing)
- [x] Channel: append-only with @mention extraction
- [x] Document: read/write workspace
- [x] Provider pattern in config: `{ provider: 'file' | 'memory', config?: {...} }`
- [x] Context enabled by default (no config = file provider)

## Phase 2: Context MCP Server

- [x] Add `@modelcontextprotocol/sdk` dependency
- [x] Create `createContextMCPServer()` function
- [x] Implement tools: `channel_send`, `channel_read`, `channel_peek`
- [x] Implement tools: `document_read`, `document_write`, `document_append`
- [x] Implement tool: `workflow_agents` for agent discovery
- [ ] Implement `notifications/mention` for @mention push (pending MCP SDK support)
- [x] Unix socket transport (primary)
- [ ] HTTP transport (fallback) - deferred, Unix socket sufficient
- [x] stdio transport (testing)

## Phase 3: Kickoff Model

- [x] Update workflow schema: `setup` + `kickoff` (replace `tasks`)
- [x] Parse and validate new schema
- [x] Send kickoff to channel on workflow start
- [ ] Trigger agents on @mention via MCP notification (requires polling or notification)

## Phase 4: CLI Updates

- [x] Rename `up` → `start`
- [x] Rename `down` → `stop`
- [x] Rename `ps` → `list`
- [x] Unify standalone and workflow agent listing (via `list` command)
- [x] Add `context` subcommand for CLI fallback

## Phase 5: Run/Start Modes

- [x] Run mode: exit when all agents idle (via @mention polling)
- [x] Start mode: persistent until stop (Ctrl+C or stop command)
- [x] Background mode for start (--background flag)
- [x] Integrate MCP server lifecycle with workflow (graceful shutdown)

## Phase 6: Agent MCP Integration

- [x] SDK backend: inject MCP client with Unix socket (via env vars)
- [x] Generate per-instance MCP config files (mcp-config.ts)
- [x] Claude CLI: pass `--mcp-config` with generated config
- [x] Codex CLI: manage `.codex/config.toml` with backup/restore
- [x] Cursor Agent: manage `.cursor/mcp.json` with backup/restore
- [x] Fallback: `agent-worker context mcp-stdio` bridge command

---

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| **0. Migration** | ✅ Complete | Refactored existing code to align with new design |
| 1. Context Provider | ✅ Complete | `context/` module - inbox/multi-doc implemented |
| 2. Context MCP Server | ✅ Complete | inbox_check/inbox_ack, document_* tools |
| 3. Kickoff Model | ✅ Complete | runner with setup + kickoff execution |
| 4. CLI Updates | ✅ Complete | start/stop/list commands + context subcommand |
| 5. Run/Start Modes | ✅ Complete | run idle detection + start --background + graceful shutdown |
| 6. Agent MCP Integration | ✅ Complete | mcp-config.ts + mcp-stdio bridge |
| 7. Inbox Model | 🔄 Pending | Priority detection (core merged into Phase 0) |
| 8. Agent Controller | 🔄 Pending | Controller + backend abstraction |
| 9. Multi-File Documents | 🔄 Pending | Nested dirs (core merged into Phase 0) |
| 10. Document Ownership | 🔄 Pending | Optional, requires Phase 11 for election |
| 11. Proposal & Voting | 🔄 Pending | Generic decision-making system |

### Implementation Order

```
Phase 0 (Migration)
    │
    ├── Phase 7 (Inbox: priority detection)
    │
    └── Phase 8 (Agent Controller) ──► Phase 9 (Nested dirs)
                                            │
                                            ▼
                                       Phase 11 (Voting)
                                            │
                                            ▼
                                       Phase 10 (Ownership)
```

**Recommended order**: 0 → 8 → 7 → 9 → 11 → 10

---

## Phase 7: Inbox Model

> **Note**: Core inbox changes are in Phase 0 Migration. This phase covers remaining work.

- [ ] Add priority detection (multiple mentions, urgent keywords)
- [ ] Update agent system prompts with work loop guidance

### Validation (Phase 7)

- [ ] **Unit test**: Priority detection for multiple mentions
- [ ] **Unit test**: Priority detection for urgent keywords
- [ ] **Manual test**: Agent receives correct priority in inbox

> **Design Decision**: `inbox_check` and `channel_read` do NOT acknowledge messages.
> Only explicit `inbox_ack` acknowledges. This allows: check inbox → process → ack on success.

## Phase 8: Agent Controller & Backend Abstraction

### Agent Controller
- [ ] Define `AgentController` interface (state: idle/running/stopped)
- [ ] Define `AgentControllerConfig` types with `RetryConfig`
- [ ] Implement `createAgentController()` factory
- [ ] Implement polling loop with `wake()` interrupt
- [ ] **Add `onMention` callback to `createContextMCPServer()` options**
- [ ] Call `onMention` in `channel_send` for each @mention (decoupled from controller)
- [ ] **Controller acknowledges inbox ONLY on successful agent run**
- [ ] Implement retry with exponential backoff (default: 3 attempts)
- [ ] **Add `retryAttempt` to `AgentRunContext`** (let agent know if retry)

### Context Management
- [ ] Define `AgentRunContext` interface (with `retryAttempt` field)
- [ ] Implement `buildAgentPrompt()` - unified prompt from inbox/channel/document
- [ ] Implement `formatInbox()` and `formatChannel()` helpers
- [ ] Configure recent channel limit (last N entries)

### Backend Abstraction
- [ ] Define `AgentBackend` interface
- [ ] Define `AgentRunResult` type
- [ ] Implement `SDKBackend` (Anthropic SDK with MCP tools)
- [ ] Implement `CLIBackend` base class
- [ ] Implement Claude CLI backend (`claude -p --mcp-config`)
- [ ] Implement Codex CLI backend (project-level config)
- [ ] Implement `getBackendForModel()` selector
- [ ] **Implement `parseModel()` with aliases and version mapping**
- [ ] **Add `detectCLIError()` for CLI backend success criteria**

### Idle Detection (Run Mode)
- [ ] Define `WorkflowIdleState` interface
- [ ] Implement `isWorkflowComplete()` - check all idle conditions
- [ ] Implement `checkWorkflowIdle()` with debounce
- [ ] Exit conditions: all idle + no unread inbox + no active proposals

### CLI Send Command
- [ ] Implement target pattern parsing: `agent`, `agent@instance`, `@instance`
- [ ] Standalone agent: direct to inbox
- [ ] Workflow agent (`agent@instance`): channel post with @mention
- [ ] Workflow channel (`@instance`): channel broadcast
- [ ] Mark user messages with `[user]` sender in channel

### Integration
- [ ] Update `runWorkflow()` to use controllers
- [ ] Add graceful shutdown for controllers
- [ ] Add backend configuration to workflow YAML (optional override)

### Validation (Phase 8)

- [ ] **Unit test**: AgentController state transitions (idle → running → idle)
- [ ] **Unit test**: wake() interrupts polling loop
- [ ] **Unit test**: Retry with exponential backoff
- [ ] **Unit test**: Inbox acknowledged only on success
- [ ] **Unit test**: SDKBackend runs agent with MCP tools
- [ ] **Unit test**: CLIBackend detects success/failure
- [ ] **Unit test**: Idle detection with debounce
- [ ] **Integration test**: Two-agent workflow with @mention handoff
- [ ] **Integration test**: Agent retry on failure, then success
- [ ] **Integration test**: Run mode exits when all idle
- [ ] **Manual test**: `agent-worker send` to workflow agent

## Phase 9: Multi-File Documents

> **Note**: Core multi-file changes are in Phase 0 Migration. This phase covers remaining work.

- [ ] Support nested document directories (e.g., `findings/auth.md`)
- [ ] Implement `deleteDocument()` - remove document file (optional, may not be needed)

### Validation (Phase 9)

- [ ] **Unit test**: Create nested document `findings/auth.md`
- [ ] **Unit test**: List documents shows nested paths
- [ ] **Unit test**: Read/write nested documents
- [ ] **Manual test**: Agent creates nested document via MCP

## Phase 10: Document Ownership (Optional)

Single-writer model to prevent concurrent document conflicts.

> **Note**: `documentOwner` config is added in Phase 0 Migration. This phase implements enforcement.

### Default Behavior
- [ ] Single agent workflow: ownership disabled (no restrictions)
- [ ] Multiple agents + `documentOwner` specified: use configured owner
- [ ] Multiple agents + not specified: trigger election (Phase 11)

### Ownership Enforcement
- [ ] Add ownership check to `document_write`, `document_create`, `document_append`
- [ ] Add `document_suggest` MCP tool for non-owners
- [ ] Non-owner write attempts return error with guidance to use `document_suggest`
- [ ] `document_suggest` posts @mention to owner in channel

### Validation (Phase 10)

- [ ] **Unit test**: Single agent workflow has no ownership restriction
- [ ] **Unit test**: Owner can write, non-owner gets error
- [ ] **Unit test**: `document_suggest` posts to channel with @mention
- [ ] **Integration test**: Non-owner suggests, owner applies change
- [ ] **Manual test**: 3-agent workflow with configured owner

> **When to use**: Workflows with 3+ agents, when document consistency matters.
> **When NOT to use**: Simple workflows, speed over consistency.

## Phase 11: Proposal & Voting System

Generic collaborative decision-making for elections, design decisions, task assignment, etc.

### Core Types
- [ ] Define `Proposal` interface (id, type, title, options, resolution, binding, status)
- [ ] Define `ProposalOption` interface (id, label, metadata)
- [ ] Define `ResolutionRule` interface (type, quorum, tieBreaker)
- [ ] Define `ProposalResult` interface (winner, votes, counts, resolvedAt, resolvedBy)
- [ ] Proposal types: election, decision, approval, assignment
- [ ] Resolution types: plurality, majority, unanimous

### Persistence & Archiving
- [ ] Define `ProposalsState` interface (proposals + version)
- [ ] Implement `loadProposals()` from `_state/proposals.json`
- [ ] Implement `saveProposals()` to `_state/proposals.json`
- [ ] Implement `archiveDecision()` - append to `documents/decisions.md`
- [ ] Remove resolved proposals from proposals.json after archiving
- [ ] Create decisions.md with header on first archive

### MCP Tools
- [ ] Add `proposal_create` tool
- [ ] Add `vote` tool (with duplicate vote handling - idempotent same, reject change)
- [ ] Add `proposal_status` tool
- [ ] Add `proposal_cancel` tool (creator only)

### Resolution Logic
- [ ] Implement `resolveProposal()` with plurality/majority/unanimous rules
- [ ] Implement `applyProposalResult()` for binding proposals
- [ ] Handle timeout resolution (via `handleElectionTimeout()`)
- [ ] Handle tie-breaker logic
- [ ] Timeout fallback: no votes → disable feature, partial votes → resolve

### Election Timing
- [ ] Election before kickoff (blocking) for document owner
- [ ] @mention all agents in election proposal to wake them
- [ ] Block document_write during active election
- [ ] 30s default timeout for elections

### Integration
- [ ] Auto-create document owner election when needed (binding)
- [ ] Post [PROPOSAL], [VOTE], [RESOLVED], [EXPIRED] messages to channel
- [ ] Update system prompt guidance for voting

### Validation (Phase 11)

- [ ] **Unit test**: Create proposal, vote, resolve with plurality
- [ ] **Unit test**: Majority resolution requires >50%
- [ ] **Unit test**: Unanimous resolution requires all votes
- [ ] **Unit test**: Duplicate vote (same choice) is idempotent
- [ ] **Unit test**: Duplicate vote (different choice) is rejected
- [ ] **Unit test**: Timeout with partial votes resolves correctly
- [ ] **Unit test**: Timeout with no votes disables feature
- [ ] **Unit test**: Proposal archived to decisions.md on resolution
- [ ] **Integration test**: Document owner election before kickoff
- [ ] **Integration test**: Agents vote, winner becomes owner
- [ ] **Manual test**: 3-agent workflow with election, verify owner enforced

> **Use cases**: Document owner election, design decisions, task assignment, merge approval

---

## Future Improvements

Ideas for future enhancements (not currently planned):

### Sub-Channels (Deferred)

Main channel + optional sub-channels for large workflows:

```yaml
context:
  provider: file
  config:
    channel: main.md
    subchannels:
      - security      # security.channel.md
      - performance   # performance.channel.md
```

**Potential use cases**:
- Large workflows with many agents (main channel too noisy)
- Private discussions (security review details)
- Parallel workstreams (different sub-teams)

**Why deferred**:
- Document multi-file already handles topic separation
- Instance isolation handles truly separate workflows
- Wait for real usage patterns before adding complexity

### Dynamic Tool Loading

Allow adding custom tools to the MCP server at runtime via CLI:

```bash
# Add a custom tool
agent-worker context tool add <name> --handler ./handler.js

# List registered tools
agent-worker context tool list

# Remove a tool
agent-worker context tool remove <name>
```

**Implementation approach**:
1. CLI sends IPC message to running MCP server
2. MCP server registers tool dynamically: `server.tool(name, desc, schema, handler)`
3. Call `server.sendToolListChanged()` to notify connected clients
4. Clients (Claude, etc.) auto-refresh tool list

**Use cases**:
- Project-specific tools (build, deploy, etc.)
- Integration with external services
- Workflow-specific actions beyond channel/document
