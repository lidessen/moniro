# Todo Template

```markdown
---
type: todo
status: active | completed | blocked
priority: high | medium | low
tags: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
completed: YYYY-MM-DD
blocked_by: ""
---

# {Task Title}

## Description

What needs to be done and why.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Notes

Progress notes, blockers, related context.

## References

- file:path/to/code.ts
- Related: [[decision-slug]]
```

## When to Use Local Todos

Use `.memory/todos/` when:

- Working offline
- No GitHub/GitLab configured
- Quick personal tasks
- Project doesn't use Issues

Use GitHub/GitLab Issues when:

- Cross-device sync needed
- Team visibility required
- Want notifications/assignees
