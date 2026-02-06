# Agent Worker Workflow Implementation

Implementation tasks for the workflow design. See [DESIGN.md](./DESIGN.md) for full specification.

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
| 1. Context Provider | ✅ Complete | `context/` module with Memory + File providers |
| 2. Context MCP Server | ✅ Complete | MCP tools + stdio/Unix socket transports |
| 3. Kickoff Model | ✅ Complete | runner with setup + kickoff execution |
| 4. CLI Updates | ✅ Complete | start/stop/list commands + context subcommand |
| 5. Run/Start Modes | ✅ Complete | run idle detection + start --background + graceful shutdown |
| 6. Agent MCP Integration | ✅ Complete | mcp-config.ts + mcp-stdio bridge |

---

## Phase 7: Inbox Model

- [ ] Add `InboxMessage` and `InboxState` types
- [ ] Add inbox methods to `ContextProvider` interface
- [ ] Implement `getInbox()` - get unread @mentions for agent (**does NOT acknowledge**)
- [ ] Implement `ackInbox()` - acknowledge messages up to timestamp
- [ ] Add priority detection (multiple mentions, urgent keywords)
- [ ] Add MCP tools: `inbox_check`, `inbox_ack`
- [ ] **Remove auto-acknowledge from `channel_read`** (breaking change)
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

- [ ] Add `documents` config option for additional document files
- [ ] Add `file` parameter to `document_read`, `document_write`, `document_append`
- [ ] Implement `listDocuments()` - list all document files
- [ ] Implement `createDocument()` - create new document file
- [ ] Implement `deleteDocument()` - remove document file
- [ ] Add MCP tools: `document_list`, `document_create`
- [ ] Support nested document directories (e.g., `findings/auth.md`)

## Phase 10: Document Ownership (Optional)

Single-writer model to prevent concurrent document conflicts:

### Configuration
- [ ] Move `documentOwner` to context level (cross-provider, not in config.*)
- [ ] Update `FileContextConfig` and `MemoryContextConfig` interfaces
- [ ] Default: single agent = disabled, multiple + not specified = election (via Phase 11)

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
- [ ] Implement `loadProposals()` from proposals.json (active only)
- [ ] Implement `saveProposals()` to proposals.json (filter active)
- [ ] Store proposals in `.workflow/instance/proposals.json`
- [ ] Implement `archiveDecision()` - append to decisions.md
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
