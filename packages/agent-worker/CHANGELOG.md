# agent-worker

## 0.3.0

### Minor Changes

- [#28](https://github.com/lidessen/skills/pull/28) [`2101512`](https://github.com/lidessen/skills/commit/21015121ef7fff314b0bd9172c2c56beb3ab5afb) Thanks [@lidessen](https://github.com/lidessen)! - Improve CLI messaging system with async-by-default behavior and better UX

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

- [#26](https://github.com/lidessen/skills/pull/26) [`1e921f4`](https://github.com/lidessen/skills/commit/1e921f43ee3efcff9ce5710e985f44ce65d3600f) Thanks [@lidessen](https://github.com/lidessen)! - Add `--import-skill` for temporary Git repository imports

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
  agent-worker session new --import-skill lidessen/skills:{memory,orientation}
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

- [#19](https://github.com/lidessen/skills/pull/19) [`9e65da6`](https://github.com/lidessen/skills/commit/9e65da6858480aaae93eb7f9bfabeaacf77a4998) Thanks [@lidessen](https://github.com/lidessen)! - Add CLI backend support for Claude Code, Codex, and Cursor

  - New pluggable backend system supporting multiple execution engines
  - `sdk`: Vercel AI SDK (default)
  - `claude`: Claude Code CLI (`claude -p` for non-interactive mode)
  - `codex`: OpenAI Codex CLI (`codex exec`)
  - `cursor`: Cursor Agent CLI (`cursor-agent -p`)
  - New `agent-worker backends` command to check CLI tool availability
  - Unified model specification across all backends with `createBackend()`
