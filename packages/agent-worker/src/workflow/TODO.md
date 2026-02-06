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

- [ ] Rename `MentionNotification` → `InboxMessage`
- [ ] Add `priority` field to `InboxMessage` (normal | high)
- [ ] Add `InboxState` interface
- [ ] Update `CONTEXT_DEFAULTS`:
  - [ ] Keep `channel: 'channel.md'`
  - [ ] Change `document: 'notes.md'` → `documentDir: 'documents/'`
  - [ ] Add `defaultDocument: 'notes.md'`
  - [ ] Add `stateDir: '_state/'`

### Provider Interface Changes (`context/provider.ts`)

- [ ] Rename method: `getUnreadMentions()` → `getInbox()`
- [ ] Rename method: `acknowledgeMentions()` → `ackInbox()`
- [ ] Remove `getAllMentions()` (not needed with new inbox model)
- [ ] Update `readDocument()` signature: add optional `file?: string` parameter
- [ ] Update `writeDocument()` signature: add optional `file?: string` parameter
- [ ] Update `appendDocument()` signature: add optional `file?: string` parameter
- [ ] Add `listDocuments()` method
- [ ] Add `createDocument(file: string, content: string)` method

### FileContextProvider Changes (`context/file-provider.ts`)

- [ ] Update constructor: accept `documentDir` instead of `documentPath`
- [ ] Update `mentionStatePath` → `_state/inbox-state.json`
- [ ] Rename `mentionState` → `inboxState`
- [ ] Rename `loadMentionState()` → `loadInboxState()`
- [ ] Rename `saveMentionState()` → `saveInboxState()`
- [ ] Rename `getUnreadMentions()` → `getInbox()`
- [ ] Rename `acknowledgeMentions()` → `ackInbox()`
- [ ] Remove `getAllMentions()` method
- [ ] Update document methods for multi-file support:
  - [ ] `readDocument(file?)` - default to `notes.md`
  - [ ] `writeDocument(file?, content)` - default to `notes.md`
  - [ ] `appendDocument(file?, content)` - default to `notes.md`
- [ ] Add `listDocuments()` implementation
- [ ] Add `createDocument(file, content)` implementation
- [ ] Update `createFileContextProvider()` factory function

### MemoryContextProvider Changes (`context/memory-provider.ts`)

- [ ] Rename `mentionState` → `inboxState`
- [ ] Change `document` string → `documents` Map<string, string>
- [ ] Rename `getUnreadMentions()` → `getInbox()`
- [ ] Rename `acknowledgeMentions()` → `ackInbox()`
- [ ] Remove `getAllMentions()` method
- [ ] Update document methods for multi-file support
- [ ] Add `listDocuments()` implementation
- [ ] Add `createDocument(file, content)` implementation
- [ ] Update `getMentionState()` → `getInboxState()` (test helper)

### MCP Server Changes (`context/mcp-server.ts`)

**Breaking Change:**
- [ ] **Remove auto-acknowledge from `channel_read`** (lines 104-107)

Tool updates:
- [ ] Update `channel_mentions` → `inbox_check` (rename only)
- [ ] Add `inbox_ack` tool (explicit acknowledgment)
- [ ] Add `file` parameter to `document_read`
- [ ] Add `file` parameter to `document_write`
- [ ] Add `file` parameter to `document_append`
- [ ] Add `document_list` tool
- [ ] Add `document_create` tool

> **Note**: `onMention` callback is added in Phase 8 (Agent Controller).

### Workflow Types Changes (`workflow/types.ts`)

- [ ] Update `ResolvedFileContext`:
  - [ ] Rename `document: string` → `documentDir: string`
- [ ] Add `documentOwner?: string` to context config types
- [ ] Update `FileContextConfig` for documentOwner at context level

### Runner Changes (`workflow/runner.ts`)

- [ ] Update `createFileContextProvider()` call: pass `documentDir` instead of `documentFile`
- [ ] Ensure `_state/` directory is created
- [ ] Ensure `documents/` directory is created

### Parser Changes (`workflow/parser.ts`)

- [ ] Update context resolution: `document` → `documentDir`
- [ ] Add `documentOwner` parsing and validation

### Test Updates

- [ ] Update any tests using old method names
- [ ] Update any tests using old storage paths

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
| **0. Migration** | 🔄 Pending | Refactor existing code to align with new design |
| 1. Context Provider | ⚠️ Needs Migration | `context/` module - update for inbox/multi-doc |
| 2. Context MCP Server | ⚠️ Needs Migration | Remove auto-ack, add inbox/doc tools |
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

## Phase 9: Multi-File Documents

> **Note**: Core multi-file changes are in Phase 0 Migration. This phase covers remaining work.

- [ ] Support nested document directories (e.g., `findings/auth.md`)
- [ ] Implement `deleteDocument()` - remove document file (optional, may not be needed)

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
