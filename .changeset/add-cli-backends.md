---
"agent-worker": minor
---

Add CLI backend support for Claude Code, Codex, and Cursor

- New pluggable backend system supporting multiple execution engines
- `sdk`: Vercel AI SDK (default)
- `claude`: Claude Code CLI (`claude -p` for non-interactive mode)
- `codex`: OpenAI Codex CLI (`codex exec`)
- `cursor`: Cursor Agent CLI (`cursor-agent -p`)
- New `agent-worker backends` command to check CLI tool availability
- Unified model specification across all backends with `createBackend()`
