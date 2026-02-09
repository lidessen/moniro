---
"agent-worker": minor
---

CLI enhancements and stability improvements:

**New Features:**
- **CLI Observability**: Enhanced observability with improved help text and better debugging experience
- **JSON Support**: Added JSON output support and improved error messages for better programmatic usage
- **Minimax CN Provider**: Added `minimax_cn` provider with dedicated API key support (`MINIMAX_CN_API_KEY`)
- **Scheduled Wakeup**: Agent sessions can now be scheduled to wake up at specific times using cron expressions
- **Project-local Context**: Support for project-local context directories via `--context-dir` flag
- **Incremental Channel Reads**: Optimized channel reading with incremental sync via `StorageBackend.readFrom`
- **Display Modes**: Dual display modes - normal (timeline) vs debug (standard log) for better workflow output
- **Adaptive Layout**: Enhanced workflow output with adaptive layout and smart formatting including dot indicators with HH:MM:SS timestamps

**Bug Fixes:**
- **Inbox Run Isolation**: Fixed cross-run message leakage with `markRunStart()` preventing messages from previous runs
- **Message Display**: Removed 500-character truncation limit on agent messages for full output visibility
- **Channel Watcher**: Fixed channel watcher replaying previous run entries incorrectly
- **AI SDK v6 Compatibility**: Renamed `parameters` to `inputSchema` to align with AI SDK v6
- **MCP Tool Schemas**: Fixed SDK/mock runners to use actual MCP tool schemas instead of synthetic ones
- **Template Variables**: Fixed syntax error in template string escaping for esbuild (`${{ }}`)
- **Duplicate Logging**: Eliminated duplicate DONE/ERROR logs by having runners return data while controller logs once
- **Context Directory**: Fixed default context directory to use global `~/.agent-worker/contexts/`
- **Cron Validation**: Added upfront validation for cron field parsing with improved error messages
- **Feedback Tool**: Addressed review findings for better reliability

**Improvements:**
- Improved debug output formatting for tool calls with unified format and text labels
- Added inbox seen state and tool call logging in debug output
- Better error messages with statusCode, url, and body extraction from AI SDK errors
- Null-safe onStepFinish callback in SDK runner
- Suppressed AI SDK warnings in normal mode, showing errors only
- System log messages now appear in channel and peek output
