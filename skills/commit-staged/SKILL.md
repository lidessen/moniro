---
name: commit-staged
description: Reviews staged changes for common issues (debug code, mixed concerns, breaking changes) before generating commit message and committing. Use when the user wants to commit staged changes with pre-commit validation, or mentions "commit", "staged", "review before commit".
---

# Commit Staged Changes

Reviews staged changes for quality issues before committing.

## Workflow

Use TodoWrite if available. Apply short-circuit evaluation: if split is required, stop without proceeding to later checks.

### 1. Check Staged Changes

```bash
git diff --cached --stat
git diff --cached
```

If no staged changes, inform user and exit.

### 2. Split Check (Short-circuit)

Analyze if changes mix unrelated concerns:
- Feature + refactor
- Multiple distinct features
- Bug fix + new feature
- Config changes + logic changes

**If split needed**:
- List suggested split groups with specific files/changes
- Ask user which to keep staged
- Stop here - do not proceed to checks below

### 3. Debug Code Check

Search staged changes for debug statements (console.log, print, debugger, etc.), TODO/FIXME comments, and commented-out code.

If found:
- List locations with file:line
- Ask if intentional or should be removed
- If removal needed, remove and re-stage

### 4. Breaking Change Check

Identify potential breaking changes (removed/renamed APIs, signature changes, schema modifications, CLI/env changes).

If found:
- List each breaking change with impact assessment
- Ask user to confirm awareness
- Suggest adding breaking change indicator to commit message if appropriate

### 5. Generate Commit Message & Commit

Generate commit message using Conventional Commits format. Add `BREAKING CHANGE:` footer if applicable.

Commit immediately with the generated message:

```bash
git commit -m "message here"
```

Show the commit message used and confirm completion.

Do NOT push unless user explicitly requests.

## Examples

### Split Detection
```
Changes mix concerns:
1. Feature: User authentication (auth.ts, login.tsx)
2. Refactor: Database helpers (db/utils.ts, db/connection.ts)

Suggest: Commit separately for clearer history
```

### Debug Code Found
```
Debug statements found:
- src/api/handler.ts:42 console.log('DEBUG: user data', user)
- src/utils/format.ts:18 // debugger

Remove before committing?
```

### Breaking Change
```
Breaking change detected:
- getUserById signature changed: added required options parameter

Add BREAKING CHANGE footer to commit message.
```

## Notes

- Use git staged changes only, ignore working directory changes
- Preserve user's existing staged state unless they approve changes
- Be specific with file paths and line numbers for findings
- Focus on common issues, not comprehensive code review
- Skip checks that would require deep codebase analysis
