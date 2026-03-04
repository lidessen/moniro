# Remote Sync

Use GitHub/GitLab Issues as cross-device memory layer. Issues ARE the memory, not a copy.

## Philosophy

```
.memory/context.md ←──references──→ GitHub/GitLab Issues
       │                                    │
   Local details                     Shared tasks
   Agent notes                       Tracking issue
   Session history                   Work issues
```

- **Issues = Tasks**: Use real Issues for cross-device todos
- **Tracking Issue = Roadmap**: One Issue links all active work
- **context.md = Index**: References Issues + local-only notes
- **Local todos/**: Fallback when offline or no remote configured

## Access Methods

| Method        | Best For         | Priority           |
| ------------- | ---------------- | ------------------ |
| MCP Tools     | Agent operations | 1st (if available) |
| CLI (gh/glab) | Hooks, scripts   | 2nd                |
| Local-only    | Offline work     | Fallback           |

### MCP Tools

```
mcp__github__get_issue(owner, repo, issue_number)
mcp__github__create_issue(owner, repo, title, body)
mcp__github__update_issue(owner, repo, issue_number, body)
mcp__github__list_issues(owner, repo, labels)
```

### CLI Detection

```bash
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  echo "github"
elif command -v glab &>/dev/null && glab auth status &>/dev/null 2>&1; then
  echo "gitlab"
else
  echo "none"
fi
```

## context.md Format

```markdown
---
tracking: "#99"
active_issues: ["#42", "#43"]
synced: YYYY-MM-DDTHH:MM:SSZ
---

# Project Context

## Active Work

<!-- Cache of Issue states - may be stale if synced > 1 hour ago -->

- #42 Implement auth - open
- #43 Add rate limiting - open

## Local Context

<!-- Agent-specific notes not in Issues -->

- Auth: JWT + refresh tokens
- Stack: Node.js, TypeScript

## Key Decisions

| Date       | Decision   | Rationale                |
| ---------- | ---------- | ------------------------ |
| YYYY-MM-DD | PostgreSQL | JSONB + relational joins |
```

## Sync Workflow

```
Session Start:
├── Read .memory/context.md
├── Fetch Issues (MCP or CLI)
└── Update Active Work section

Working:
├── Create Issue → add to active_issues
├── Update local notes in context.md
└── Write to .memory/notes/, decisions/

Session End:
├── Update tracking Issue with summary
├── Update synced timestamp
└── Create .memory/sessions/ record
```

## Conflict Handling

**Principle**: Remote (Issues) is source of truth for task state.

| Scenario                  | Resolution                            |
| ------------------------- | ------------------------------------- |
| Issue closed remotely     | sync-pull removes from Active Work    |
| Local edits while offline | sync-push appends, doesn't overwrite  |
| Concurrent edits          | Remote wins on pull; push is additive |

**sync-push strategy**: Append session summary to tracking Issue rather than replacing body. Use HTML comments to mark agent-managed sections:

```markdown
<!-- AGENT-MEMORY-START -->

## Current State

...

<!-- AGENT-MEMORY-END -->
```

## Hook Integration

### Claude Code

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [{ "type": "command", "command": "memory-sync-pull.sh" }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{ "type": "command", "command": "memory-sync-push.sh" }]
      }
    ]
  }
}
```

### Cursor

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "memory-sync-pull.sh" }],
    "sessionEnd": [{ "command": "memory-sync-push.sh" }]
  }
}
```

## What Goes Where

| Content            | Location             | Why                      |
| ------------------ | -------------------- | ------------------------ |
| Cross-device tasks | GitHub/GitLab Issues | Notifications, assignees |
| Tracking/Roadmap   | Tracking Issue       | Single source of truth   |
| Local-only tasks   | .memory/todos/       | Offline, no remote       |
| Context cache      | context.md           | Fast local access        |
| Decisions          | .memory/decisions/   | Detailed rationale       |
| Sessions           | .memory/sessions/    | Local continuity         |
| Notes              | .memory/notes/       | Learnings, references    |
