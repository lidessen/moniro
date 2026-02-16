# Implementation Status

**Related**: [DESIGN.md](./DESIGN.md) | [REFERENCE.md](./REFERENCE.md) | [REWRITE.md](../REWRITE.md)

## Rewrite Progress

| Phase | Status | Summary |
|-------|--------|---------|
| 0. Preparation | ✅ | Archived old code, created new directory structure |
| 1. Daemon Core | ✅ | SQLite + HTTP + agent/workflow CRUD + persistence |
| 2. Context | ✅ | Channel, inbox, @mention parsing, MCP tools |
| 3. Worker Subprocess | ✅ | fork, MCP client, session, prompt builder |
| 4. Scheduler | ✅ | Poll/cron/wake, process manager integration |
| 5. Interface CLI | ✅ | Commander CLI, daemon discovery, HTTP client, workflow parser |
| 6. Remaining Features | ✅ | Proposals, documents, backends (SDK, Claude, Codex, Cursor) |
| 7. Cleanup | ✅ | Deleted src-old/, updated package.json, pruned deps |

**Result**: 14,709 lines → ~4,800 lines (67% reduction). 93 tests across 6 files.

## Deferred Items

- Document ownership enforcement (single-writer model)
- Proposal archiving to `decisions.md`
- SQLite document provider (alternative to file-based)
- E2E tests for real CLI backends (Claude, Codex, Cursor)
- SSE streaming for `POST /run`
- Variable interpolation in workflow kickoff (`${{ }}` syntax)
