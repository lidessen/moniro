# Validation Result Persistence

How validation results are stored and used for learning.

## Table of Contents

- [Storage Structure](#storage-structure)
- [Record Format](#record-format)
- [Automatic Persistence](#automatic-persistence)
- [Querying History](#querying-history)
- [Retention Policy](#retention-policy)

---

## Storage Structure

Validation results persist in `.memory/validations/`:

```
.memory/
├── validations/
│   ├── 2026-01-31-commit-auth-refactor.md
│   ├── 2026-01-31-pr-feature-x.md
│   ├── 2026-01-30-commit-bugfix.md
│   └── index.md  # Summary index
│
├── decisions/    # Existing memory structure
├── notes/
└── todos/
```

### File Naming Convention

```
YYYY-MM-DD-context-slug.md

Examples:
├── 2026-01-31-commit-auth-refactor.md
├── 2026-01-31-pr-user-dashboard.md
├── 2026-01-31-validate-security-audit.md
└── 2026-01-31-session-end-check.md
```

### Index File

The `index.md` provides quick access to validation history:

```markdown
# Validation History

## Recent (Last 7 Days)

| Date       | Context               | Status     | Critical | Important | Link                                    |
| ---------- | --------------------- | ---------- | -------- | --------- | --------------------------------------- |
| 2026-01-31 | PR: feature-x         | ⚠️ warning | 0        | 2         | [→](2026-01-31-pr-feature-x.md)         |
| 2026-01-31 | Commit: auth-refactor | ✅ pass    | 0        | 0         | [→](2026-01-31-commit-auth-refactor.md) |
| 2026-01-30 | Commit: bugfix        | ✅ pass    | 0        | 0         | [→](2026-01-30-commit-bugfix.md)        |

## Trends

- Critical issues this week: 0
- Most common issue: size (3 occurrences)
- Validators with most findings: reviewability

## Patterns

- Console.log detected 5x in last 30 days
- Size warnings trending up (consider smaller commits)
```

---

## Record Format

Each validation record uses YAML frontmatter + markdown body:

```markdown
---
type: validation
context: commit
slug: auth-refactor
pipeline: standard
status: warning
timestamp: 2026-01-31T10:30:45Z
duration: 45s
summary:
  critical: 0
  important: 2
  suggestion: 3
  passed: 18
files_validated:
  - src/auth/login.ts
  - src/auth/session.ts
  - src/middleware/auth.ts
tags: [auth, refactor, session-abc123]
---

# Validation: auth-refactor

**Context**: Commit validation for auth module refactoring
**Pipeline**: standard
**Status**: ⚠️ Warning (2 important issues)

## Summary

| Severity      | Count |
| ------------- | ----- |
| 🔴 Critical   | 0     |
| 🟡 Important  | 2     |
| 🔵 Suggestion | 3     |
| ✅ Passed     | 18    |

## Findings

### Important (🟡)

#### 1. Size Warning

- **Validator**: reviewability
- **Message**: 562 lines changed across 3 files
- **Suggestion**: Consider splitting into smaller commits
- **Status**: Acknowledged (user proceeded)

#### 2. Signature Change

- **Validator**: impact
- **Location**: src/auth/session.ts:45
- **Message**: `createSession()` parameter added
- **Affected**: 8 call sites
- **Suggestion**: Make parameter optional
- **Status**: Fixed in subsequent commit

### Suggestions (🔵)

1. **Doc freshness**: AUTH.md not updated in 4 months
2. **TODO found**: src/auth/login.ts:23
3. **Naming**: Consider renaming `sess` to `session` for clarity

## Validator Results

| Validator     | Status     | Duration | Findings      |
| ------------- | ---------- | -------- | ------------- |
| syntax        | ✅ pass    | 3s       | 0             |
| reviewability | ⚠️ warning | 12s      | 1             |
| security      | ✅ pass    | 18s      | 0             |
| impact        | ⚠️ warning | 10s      | 1             |
| consistency   | ✅ pass    | 2s       | 3 suggestions |

## Actions Taken

- [x] Acknowledged size warning (justified: cohesive refactor)
- [x] Fixed signature change (added default parameter)
- [ ] Update AUTH.md documentation
- [ ] Address TODO comment

## Related

- Commit: abc1234
- Session: session-abc123
```

---

## Automatic Persistence

### When to Persist

```
Persistence triggers:
├── Pipeline completion (always)
├── Commit with validation (always)
├── PR/MR creation (always)
├── Explicit "validate" command (always)
└── Session end check (if findings exist)
```

### What Gets Persisted

```yaml
Always persisted:
  - timestamp
  - pipeline used
  - overall status
  - summary counts
  - validator results

Conditionally persisted:
  - full findings (if any exist)
  - files validated (if <50 files)
  - actions taken (if any)

Never persisted:
  - full file contents
  - secrets or sensitive data
  - raw validator output
```

### Persistence Flow

```
Pipeline completes
    │
    ▼
Generate record ──► Format as markdown
    │
    ▼
Check .memory/validations/ exists
    │
    ├── No → Create directory
    │
    ▼
Write record file
    │
    ▼
Update index.md
    │
    ▼
Prune old records (if needed)
```

---

## Querying History

### Quick Queries

```bash
# Recent validations
ls -la .memory/validations/

# Find failures
grep -l "status: fail" .memory/validations/*.md

# Find by context
grep -l "context: pr" .memory/validations/*.md

# Count by status this week
grep "^status:" .memory/validations/2026-01-*.md | sort | uniq -c
```

### Validation Commands

```
"validation history"       → Show recent validations
"validation trends"        → Analyze patterns over time
"validation report [date]" → Show specific validation
"validation issues"        → List unresolved issues
```

### History Report

```markdown
# Validation Trends (Last 30 Days)

## Overview

- Total validations: 47
- Pass rate: 85%
- Average duration: 34s

## Issue Frequency

| Issue Type          | Count | Trend        |
| ------------------- | ----- | ------------ |
| size                | 12    | ↑ increasing |
| noise (console.log) | 8     | ↓ decreasing |
| doc freshness       | 5     | → stable     |
| security (secrets)  | 0     | ✅ none      |

## Recommendations

Based on validation history:

1. Consider smaller commits (size warnings frequent)
2. Add pre-commit hook for console.log removal
3. Schedule documentation review (5 stale docs)
```

---

## Retention Policy

### Default Policy

```yaml
retention:
  # Keep recent records
  recent_days: 30

  # Keep important records longer
  keep_if:
    - status: fail # Always keep failures
    - context: pr # Keep PR validations
    - has_unresolved: true # Keep if issues pending

  # Archive old records
  archive_after: 90_days
  archive_location: .memory/validations/archive/

  # Delete very old
  delete_after: 365_days
```

### Retention Actions

```
Daily cleanup (automatic):
│
├── Records > 30 days old
│   └── Archive if important, delete if routine
│
├── Archived records > 90 days
│   └── Compress to yearly summary
│
└── Update index.md
```

### Preserving Important Records

Mark records for permanent retention:

```yaml
---
type: validation
retain: permanent
reason: "Major security audit before v2.0 release"
---
```

---

## Integration with Memory Skill

Validation records integrate with the broader memory system:

```
Memory Integration:
│
├── Cross-reference decisions
│   └── "Validation led to ADR-005: API versioning"
│
├── Link to session summaries
│   └── Session summary includes validation status
│
├── Feed housekeeping
│   └── Unresolved issues become housekeeping tasks
│
└── Inform orientation
    └── "3 unresolved validation issues from last session"
```

### Example Cross-Reference

In a decision record:

```markdown
## Context

Validation on 2026-01-30 revealed multiple breaking changes
in the API layer. See [validation report](../validations/2026-01-30-api-changes.md).

## Decision

Implement API versioning to prevent future breaking changes.
```

In a session summary:

```markdown
## Validation Summary

- 3 validations run
- 1 critical issue found and fixed (SQL injection)
- 2 size warnings (commits were cohesive, proceeded anyway)
```
