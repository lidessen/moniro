# agent-worker

## 0.8.0

### Minor Changes

- [`944236b`](https://github.com/lidessen/moniro/commit/944236b4a70b8912d489ea048a32514e79cd0fe7) - BREAKING: Rename MCP tools (inbox*\* → my_inbox*_, document\__ → team*doc*\*, etc.), add agent status management, increase idle timeout to 10min, improve event handling with typed adapters

## 0.7.0

### Minor Changes

- [`cdc3e23`](https://github.com/lidessen/moniro/commit/cdc3e23c43cb518e411e240d1e12379eee742ef3) - feat: add pretty display mode with @clack/prompts and refactor tool call type system

## 0.6.0

### Minor Changes

- [`3f6e3a6`](https://github.com/lidessen/moniro/commit/3f6e3a65d95f176637fd9c2bfe88765d201ae2a5) - Fix CLI version display, add signal handling, implement smart message handling with auto-resource conversion, and optimize agent prompts

## 0.5.0

### Minor Changes

- [`52128d1`](https://github.com/lidessen/moniro/commit/52128d1ecbc36568a08e6fa1daa0ab55958ead69) - Improve CLI backend timeouts and add streaming progress

## 0.4.0

### Minor Changes

- [#51](https://github.com/lidessen/moniro/pull/51) [`4c1cb1f`](https://github.com/lidessen/moniro/commit/4c1cb1fe409887788867ff4c30ecaa8efb25e773) Thanks [@lidessen](https://github.com/lidessen)! - CLI enhancements and stability improvements:

  **Observability & Developer Experience:**

  - **Enhanced CLI Observability**: Improved help text and better debugging experience
  - **JSON Output Support**: Added JSON output support for better programmatic usage and integration
  - **Dual Display Modes**: Normal (timeline) vs debug (standard log) for better workflow output visibility
  - **Adaptive Layout**: Enhanced workflow output with smart formatting including dot indicators with `HH:MM:SS` timestamps
  - **Improved Debug Output**: Better formatting for tool calls with unified format and text labels
  - **Inbox Seen State**: Added inbox seen state and tool call logging in debug output
  - **System Logs in Channel**: System log messages now appear in channel and `peek` output

  **New Providers & Capabilities:**

  - **Minimax CN Provider**: Added `minimax_cn` provider with dedicated `MINIMAX_CN_API_KEY` environment variable support
  - **Scheduled Wakeup**: Agent sessions can now be scheduled to wake up at specific times using cron expressions
  - **Project-local Context**: Support for project-local context directories via `--context-dir` flag

  **Performance Improvements:**

  - **Incremental Channel Reads**: Optimized channel reading with incremental sync via `StorageBackend.readFrom`

  **Bug Fixes:**

  _Runtime Isolation:_

  - Fixed cross-run message leakage with `markRunStart()` preventing messages from previous runs
  - Fixed channel watcher replaying previous run entries incorrectly
  - Eliminated duplicate `DONE`/`ERROR` logs by having runners return data while controller logs once

  _Display Issues:_

  - Removed 500-character truncation limit on agent messages for full output visibility
  - Fixed syntax error in template string escaping for esbuild (`${{ }}`)

  _Compatibility & SDK Integration:_

  - Renamed `parameters` to `inputSchema` to align with AI SDK v6
  - Fixed SDK/mock runners to use actual MCP tool schemas instead of synthetic ones
  - Null-safe `onStepFinish` callback in SDK runner
  - Suppressed AI SDK warnings in normal mode, showing errors only

  _Configuration & Validation:_

  - Fixed default context directory to use global `~/.agent-worker/contexts/`
  - Added upfront validation for cron field parsing with improved error messages
  - Addressed review findings for feedback tool reliability

  **Error Messaging:**

  - Better error messages with `statusCode`, `url`, and `body` extraction from AI SDK errors

- [#51](https://github.com/lidessen/moniro/pull/51) [`4c1cb1f`](https://github.com/lidessen/moniro/commit/4c1cb1fe409887788867ff4c30ecaa8efb25e773) Thanks [@lidessen](https://github.com/lidessen)! - **BREAKING CHANGE**: Simplify tool management in CLI

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

## 0.4.0

### Major Changes

- Multi-agent workflow system with shared context and @mention-driven collaboration

  - YAML-based workflow definition with `agents`, `setup`, and `kickoff`
  - Channel (communication) + Document (workspace) shared context model
  - @mention system for natural agent coordination
  - MCP-based architecture — works with any MCP-compatible agent backend
  - Context providers: File (persistent) and Memory (ephemeral/testing)
  - Agent Controller with polling loop, retry, exponential backoff, idle detection
  - Proposal & Voting system (election, decision, approval, assignment)
  - Variable interpolation (`${{ }}`) in workflow YAML
  - Run mode (exit when idle) and Start mode (persistent)
  - Instance isolation for parallel workflows

- Mock backend for testing workflows without real LLM API calls

- CLI commands: `run`, `start`, `stop`, `context`

- Test architecture overhaul
  - Shared test helpers: mock-model, mock-backend, wait utilities
  - Unit tests for AgentSession.send() and daemon handler dispatch
  - Fixed all 21 pre-existing test failures (546 pass, 0 fail)

## 0.3.0

### Minor Changes

- [#28](https://github.com/lidessen/moniro/pull/28) [`2101512`](https://github.com/lidessen/moniro/commit/21015121ef7fff314b0bd9172c2c56beb3ab5afb) Thanks [@lidessen](https://github.com/lidessen)! - Improve CLI messaging system with async-by-default behavior and better UX

  **Breaking Changes:**

  - CLI now sends messages asynchronously by default (non-blocking). Use `--wait` flag for synchronous mode
  - Renamed `history` command to `peek` for more intuitive message viewing

  **New Features:**

  - Added `peek` command with smart defaults (shows last 10 messages by default)
  - Added `peek --all` to show all messages
  - Added `peek --find <text>` to search/filter messages (case-insensitive)
  - Added `--wait` flag to send command for synchronous mode when needed
  - Added `--debug` flag for detailed troubleshooting information

  **Improvements:**

  - Added 60-second timeout for async message processing to prevent indefinite hangs
  - Improved async response message: "Processing in background. Use `peek` to check the response."
  - Fixed stdin handling in Claude CLI backend to prevent blocking issues
  - Added comprehensive backend limitations documentation

  **Bug Fixes:**

  - Fixed issue where async messages could hang indefinitely in certain environments
  - Improved error messaging for timeout scenarios

## 0.2.0

### Minor Changes

- [#26](https://github.com/lidessen/moniro/pull/26) [`1e921f4`](https://github.com/lidessen/moniro/commit/1e921f43ee3efcff9ce5710e985f44ce65d3600f) Thanks [@lidessen](https://github.com/lidessen)! - Add `--import-skill` for temporary Git repository imports

  This release adds support for importing agent skills directly from Git repositories during session creation. Skills are cloned to a session-specific temporary directory and automatically cleaned up when the session ends.

  **New Features:**

  - `--import-skill` CLI option for importing skills from Git repositories
  - Import spec format: `[provider:]owner/repo[@ref]:{skill1,skill2,...}`
  - Brace expansion support for importing multiple skills: `{a,b,c}`
  - Multi-provider support: GitHub (default), GitLab, Gitee
  - Session-scoped temporary directory with automatic cleanup on shutdown
  - `SkillImporter` class for programmatic skill imports
  - New exports: `SkillImporter`, `parseImportSpec`, `buildGitUrl`, `getSpecDisplayName`

  **Examples:**

  ```bash
  # CLI usage
  agent-worker session new --import-skill vercel-labs/agent-skills:dive
  agent-worker session new --import-skill lidessen/moniro:{memory,orientation}
  agent-worker session new --import-skill gitlab:myorg/skills@v1.0.0:custom
  ```

  ```typescript
  // SDK usage
  import {
    SkillImporter,
    SkillsProvider,
    createSkillsTool,
  } from "agent-worker";

  const importer = new SkillImporter(sessionId);
  await importer.import("vercel-labs/agent-skills:dive");
  await skillsProvider.addImportedSkills(importer);

  // Cleanup when done
  await importer.cleanup();
  ```

  **Security:**

  - Input validation to prevent git argument injection attacks
  - Path traversal protection for skill file access
  - Strict validation of owner/repo/ref names (alphanumeric, hyphen, underscore, dot only)
  - Protection against shell metacharacters and malicious input

  **Note:** For permanent skill installation, use the Vercel skills CLI (`npx skills add`). This feature is designed for temporary, session-scoped skill imports.

## 0.1.0

### Minor Changes

- [#19](https://github.com/lidessen/moniro/pull/19) [`9e65da6`](https://github.com/lidessen/moniro/commit/9e65da6858480aaae93eb7f9bfabeaacf77a4998) Thanks [@lidessen](https://github.com/lidessen)! - Add CLI backend support for Claude Code, Codex, and Cursor

  - New pluggable backend system supporting multiple execution engines
  - `sdk`: Vercel AI SDK (default)
  - `claude`: Claude Code CLI (`claude -p` for non-interactive mode)
  - `codex`: OpenAI Codex CLI (`codex exec`)
  - `cursor`: Cursor Agent CLI (`cursor-agent -p`)
  - New `agent-worker backends` command to check CLI tool availability
  - Unified model specification across all backends with `createBackend()`
