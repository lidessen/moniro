# Setup

## Automatic (Hook-based)

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'DIR=\"${CLAUDE_PROJECT_DIR:-.}/.memory\"; [ -d \"$DIR\" ] || mkdir -p \"$DIR\"/{notes,decisions,todos,sessions}'"
          }
        ]
      }
    ]
  }
}
```

### Cursor

Add to `.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": "bash -c 'DIR=\"$(pwd)/.memory\"; [ -d \"$DIR\" ] || mkdir -p \"$DIR\"/{notes,decisions,todos,sessions}'"
      }
    ]
  }
}
```

## Manual

```bash
mkdir -p .memory/{notes,decisions,todos,sessions}
```

## Git Configuration

**Hybrid (Recommended)** - Share valuable knowledge, keep personal context private:

```gitignore
# Share decisions/notes/todos, keep sessions and context personal
.memory/sessions/
.memory/context.md
```

**Personal** - Nothing shared:

```gitignore
.memory/
```

**Team** - Everything shared: Commit entire `.memory/` to repository.

## Initial context.md

After creating directories, optionally create `.memory/context.md`:

```markdown
---
tracking: ""
active_issues: []
synced: ""
---

# Project Context

## Active Work

## Local Context

## Key Decisions

| Date | Decision | Rationale |
| ---- | -------- | --------- |
```

This file becomes the anchor for remote sync if configured.
