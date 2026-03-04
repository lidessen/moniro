# Workflow Implementation Status

**Related**: [DESIGN.md](./DESIGN.md) | [REFERENCE.md](./REFERENCE.md)

## Progress

| Phase                    | Status | Summary                                             |
| ------------------------ | ------ | --------------------------------------------------- |
| 0. Migration             | ✅     | Refactored storage structure, provider/types rename |
| 1. Context Provider      | ✅     | File + Memory providers with inbox/multi-doc        |
| 2. Context MCP Server    | ✅     | inbox*check/ack, document*\_, channel\_\_ tools     |
| 3. Kickoff Model         | ✅     | Setup + kickoff execution                           |
| 4. CLI Updates           | ✅     | start/stop/list + context subcommand                |
| 5. Run/Start Modes       | ✅     | Idle detection + background + graceful shutdown     |
| 6. Agent MCP Integration | ✅     | mcp-config + mcp-stdio bridge                       |
| 7. Inbox Model           | ✅     | Priority detection                                  |
| 8. Agent Loop            | ✅     | Loop + backends + idle detection                    |
| 9. Multi-File Documents  | ✅     | Nested dirs support                                 |
| 10. Document Ownership   | 🔄     | Optional, requires election                         |
| 11. Proposal & Voting    | ✅     | ProposalManager, MCP tools, resolution logic        |

## Pending: Phase 10 — Document Ownership

Single-writer model to prevent concurrent document conflicts.

- [ ] Ownership enforcement: owner can write, non-owner gets error
- [ ] `document_suggest` MCP tool for non-owners (posts @mention to owner)
- [ ] Election-before-kickoff for document owner (blocking)
- [ ] Block `document_write` during active election

**When to use**: 3+ agents, document consistency matters.

## Deferred Items

- Proposal archiving to `decisions.md`
- Sub-channels for large workflows
- Dynamic tool loading via CLI
- MCP push notifications (pending SDK support)
- Manual test coverage for several phases (see git history for full checklist)
