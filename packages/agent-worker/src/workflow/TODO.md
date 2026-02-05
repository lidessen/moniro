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
- [x] Send kickoff to channel on workflow start (via runner-v2)
- [ ] Trigger agents on @mention via MCP notification (requires polling or notification)

## Phase 4: CLI Updates

- [x] Rename `up` → `start`
- [x] Rename `down` → `stop`
- [x] Rename `ps` → `list`
- [x] Unify standalone and workflow agent listing (via `list` command)
- [x] Add `context` subcommand for CLI fallback

## Phase 5: Run/Start Modes

- [ ] Run mode: exit when all agents idle (deferred - requires agent idle detection)
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
| 3. Kickoff Model | ✅ Complete | runner-v2 with setup + kickoff execution |
| 4. CLI Updates | ✅ Complete | start/stop/list commands + context subcommand |
| 5. Run/Start Modes | ✅ Complete | start --background + graceful shutdown |
| 6. Agent MCP Integration | ✅ Complete | mcp-config.ts + mcp-stdio bridge |
