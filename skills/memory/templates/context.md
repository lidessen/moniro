# Context Template

```markdown
---
tracking: "" # Tracking Issue number, e.g., "#99"
active_issues: [] # Active work Issues, e.g., ["#42", "#43"]
synced: YYYY-MM-DDTHH:MM:SSZ # Last sync timestamp
---

# Project Context

## Active Work

<!-- sync-pull updates this section automatically -->
<!-- Format: - #N Title - status -->

## Local Context

<!-- Agent-specific notes not suitable for Issues -->

- Tech stack:
- Key constraints:
- Current focus:

## Key Decisions

<!-- Summary of important decisions with dates -->
<!-- Link to .memory/decisions/ for full ADRs -->

| Date | Decision | Rationale |
| ---- | -------- | --------- |

## Recent Sessions

<!-- Last 3-5 sessions for continuity -->

| Date | Summary |
| ---- | ------- |
```

## Usage

context.md is the **anchor point** for memory sync:

1. **First time**: Create with empty tracking/active_issues
2. **Setup sync**: Create tracking Issue, add number to frontmatter
3. **During work**: Agent updates Local Context and Key Decisions
4. **sync-pull**: Updates Active Work section from Issues
5. **sync-push**: Updates tracking Issue with current state

## Sections

| Section         | Updated by       | Purpose                        |
| --------------- | ---------------- | ------------------------------ |
| Active Work     | sync-pull (auto) | Current Issues status          |
| Local Context   | Agent (manual)   | Quick reference, not in Issues |
| Key Decisions   | Agent (manual)   | Decision index, links to ADRs  |
| Recent Sessions | Agent (manual)   | Session continuity             |

## Without Remote

If no `gh`/`glab` CLI available:

- Leave `tracking` empty
- Use `active_issues` as local todo list
- Agent manually updates Active Work section
