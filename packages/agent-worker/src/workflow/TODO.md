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
- [ ] Implement `getInbox()` - get unread @mentions for agent
- [ ] Implement `ackInbox()` - acknowledge messages up to timestamp
- [ ] Implement `peekInbox()` - view inbox without acknowledging
- [ ] Add priority detection (multiple mentions, urgent keywords)
- [ ] Add MCP tools: `inbox_check`, `inbox_ack`, `inbox_peek`
- [ ] Update agent system prompts with work loop guidance

## Phase 8: Multi-File Documents

- [ ] Add `documents` config option for additional document files
- [ ] Add `file` parameter to `document_read`, `document_write`, `document_append`
- [ ] Implement `listDocuments()` - list all document files
- [ ] Implement `createDocument()` - create new document file
- [ ] Implement `deleteDocument()` - remove document file
- [ ] Add MCP tools: `document_list`, `document_create`
- [ ] Support nested document directories (e.g., `findings/auth.md`)

---

## Future Improvements

Ideas for future enhancements (not currently planned):

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
