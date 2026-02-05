# Agent Worker v2 Implementation Plan

Implementation tasks for the workflow v2 design. See [DESIGN.md](./DESIGN.md) for full specification.

---

## Phase 1: Context Provider

- [x] Define `ContextProvider` interface
- [x] Implement `FileContextProvider` (markdown storage)
- [x] Implement `MemoryContextProvider` (testing)
- [x] Channel: append-only with @mention extraction
- [x] Document: read/write workspace

## Phase 2: Context MCP Server

- [x] Add `@modelcontextprotocol/sdk` dependency
- [x] Create `createContextMCPServer()` function
- [x] Implement tools: `channel_send`, `channel_read`, `channel_peek`
- [x] Implement tools: `document_read`, `document_write`, `document_append`
- [ ] Implement `notifications/mention` for @mention push (pending MCP SDK support)
- [x] Unix socket transport (primary)
- [ ] HTTP transport (fallback) - deferred, Unix socket sufficient
- [x] stdio transport (testing)

## Phase 3: Kickoff Model

- [x] Update workflow schema: `setup` + `kickoff` (replace `tasks`)
- [x] Parse and validate new schema
- [ ] Send kickoff to channel on workflow start
- [ ] Trigger agents on @mention via MCP notification

## Phase 4: CLI Updates

- [x] Rename `up` → `start`
- [x] Rename `down` → `stop`
- [x] Rename `ps` → `list`
- [x] Unify standalone and workflow agent listing (via `list` command)
- [x] Add `context` subcommand for CLI fallback

## Phase 5: Run/Start Modes

- [ ] Run mode: exit when all agents idle
- [ ] Start mode: persistent until stop
- [ ] Background mode for start
- [ ] Integrate MCP server lifecycle with workflow

## Phase 6: Agent MCP Integration

- [ ] SDK backend: inject MCP client with Unix socket
- [ ] Generate per-instance MCP config files
- [ ] Claude CLI: pass `--mcp-config` and `--strict-mcp-config` at runtime
- [ ] Codex CLI: manage `.codex/config.toml` with backup/restore
- [ ] Cursor Agent: manage `.cursor/mcp.json` with backup/restore
- [ ] Fallback: `agent-worker context` CLI wrapper for unsupported backends

---

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Context Provider | ✅ Complete | `context/` module with Memory + File providers |
| 2. Context MCP Server | ✅ Complete | MCP tools + stdio/Unix socket transports |
| 3. Kickoff Model | 🔄 In Progress | Schema + parser done, runtime pending |
| 4. CLI Updates | ✅ Complete | start/stop/list commands + context subcommand |
| 5. Run/Start Modes | Not started | |
| 6. Agent MCP Integration | Not started | |
