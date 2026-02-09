---
"agent-worker": minor
---

**BREAKING CHANGE**: Simplify tool management in CLI

This release restructures how tools are managed in the agent-worker CLI, moving from runtime tool management to creation-time configuration for a simpler and cleaner interface.

**What Changed:**
- Added `--tool <file>` parameter to `new` command for specifying MCP tools at creation
- Promoted `agent-worker mock tool <name> <response>` (from tool subcommand)
- Promoted `agent-worker feedback [target]` (from tool subcommand)
- Deprecated `agent-worker tool add/import/list` commands

**Migration Guide:**

**Before (deprecated):**
```bash
# Old way - dynamic tool addition at runtime
agent-worker new alice
agent-worker tool add alice ./my-tools.ts
agent-worker tool list alice
agent-worker tool mock get_weather '{"temp": 72}'
```

**After (new API):**
```bash
# New way - specify tools at creation time
agent-worker new alice --tool ./my-tools.ts

# Mock tool responses (promoted to top-level)
agent-worker mock tool get_weather '{"temp": 72}'

# View agent feedback (promoted to top-level)
agent-worker feedback alice
```

**Rationale:** Dynamic tool addition at runtime has minimal use cases. Specifying tools at agent creation time is sufficient and provides a simpler, more predictable experience.
