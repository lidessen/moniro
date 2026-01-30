---
name: code-review
description: Comprehensive code review for local branches or remote PR/MR changes. Assesses reviewability, analyzes risks, reviews changes with project context, and provides actionable feedback. Use when reviewing code changes, pull requests, merge requests, or when mentions "review", "PR", "MR", "code quality".
---

# Code Review

Performs systematic code review with project context awareness, risk analysis, and actionable feedback.

## Quick Start

**Basic usage examples**:
- "Review this PR: https://github.com/owner/repo/pull/123"
- "Review changes between main and feature-branch"
- "Review my current branch against main"
- "Continue reviewing from last saved progress"

**Key features**:
- Multi-stage review process with quality gates
- Automatic reviewability assessment
- Risk-based prioritization
- Project-aware review strategy
- Progress tracking for large reviews

## Workflow

Use TodoWrite tool for ALL stages to track progress and ensure completion.

### Stage 1: Initialize Review

**Goal**: Identify what to review and ensure code is up-to-date.

1. **Identify review type** from user input:
   - **PR/MR URL**: Extract platform (GitHub/GitLab), repo, and PR/MR number
   - **Branch comparison**: Parse "from..to" or "from...to" syntax
   - **Current branch**: Default to comparing current branch against main/master
   - **Saved progress**: Look for `.code-review-progress.md` file

2. **Fetch latest code**:
   ```bash
   # For PR/MR - prefer local review for better tool access
   git fetch origin pull/123/head:pr-123  # GitHub
   git fetch origin merge-requests/123/head:mr-123  # GitLab

   # For branches
   git fetch origin <branch-name>
   ```

3. **Collect basic metrics**:
   ```bash
   git diff --stat <from>..<to>
   git log --oneline <from>..<to>
   git diff --numstat <from>..<to> | awk '{files++; added+=$1; deleted+=$2} END {print files, added, deleted}'
   ```

4. **Capture metadata**:
   - Total files changed
   - Lines added/deleted
   - Number of commits
   - File types distribution
   - Commit messages

**Exit criteria**: Have confirmed branches, latest code, and basic metrics.

### Stage 2: Reviewability Assessment

**Goal**: Determine if changes are in reviewable state or need restructuring.

Act as a **regular developer** (not expert) evaluating review mental burden.

**Check for mixed concerns** (priority order):

1. **Format-only changes** mixed with logic:
   - Identify files with >80% formatting (whitespace, import sorting, style)
   - Suggest: "Move formatting to separate commit/PR"

2. **Refactoring** mixed with new features:
   - Detect: Renamed functions/classes + new functionality
   - Suggest: "Split refactoring and feature into separate PRs"

3. **Multiple unrelated features**:
   - Identify distinct feature areas (different modules/domains)
   - Suggest: "Split into focused PRs by feature area"

4. **Infrastructure** mixed with business logic:
   - Detect: CI config, build scripts, deployment + feature code
   - Suggest: "Separate infrastructure changes"

**Size assessment**:
- **Small** (<200 lines, <5 files): "Good size for thorough review"
- **Medium** (200-800 lines, 5-20 files): "Manageable with focused attention"
- **Large** (800-2000 lines, 20-50 files): "Consider breaking down or use progress tracking"
- **X-Large** (>2000 lines, >50 files): "Requires split review sessions - will create progress document"

**If issues found**:
- List specific concerns with file examples
- Provide restructuring suggestions
- Ask user: "Proceed with review or restructure first?"
- If user chooses restructure, stop here

**Exit criteria**: Changes are reviewable OR user confirmed to proceed anyway.

### Stage 3: Project Context Understanding

**Goal**: Understand project style and determine review strategy.

1. **Identify project type** (check in order):
   ```bash
   # Check key files
   ls package.json pyproject.toml Cargo.toml go.mod pom.xml *.csproj

   # Identify framework
   grep -l "react\|vue\|angular\|svelte" package.json
   grep -l "django\|flask\|fastapi" requirements.txt pyproject.toml
   ```

2. **Detect review strategy** (auto-detect or ask user):

   **Conservative** (financial, healthcare, infrastructure):
   - Indicators: Security scanning configs, extensive tests, regulatory comments
   - Focus: Risk analysis, backwards compatibility, security, data integrity

   **Balanced** (most projects):
   - Indicators: Standard project structure, moderate test coverage
   - Focus: Best practices, maintainability, common pitfalls

   **Best Practice** (greenfield, modern stack):
   - Indicators: Latest frameworks, comprehensive tooling, high test coverage
   - Focus: Architecture patterns, performance, modern idioms

   **If uncertain**, ask user: "What review approach: conservative / balanced / best-practice?"

3. **Load project conventions** (scan quickly):
   - CONTRIBUTING.md, DEVELOPMENT.md, CODING_STYLE.md
   - README.md sections on development
   - Existing code patterns (2-3 similar files)

4. **Identify tech stack and common patterns**:
   - Language/framework versions
   - Testing approach
   - Error handling patterns
   - State management (for frontends)

**Exit criteria**: Know review strategy and project conventions.

### Stage 3.5: Review Depth Strategy

**Goal**: Determine what to focus on based on change size - maximize signal, minimize noise.

**Core principle**: Focus on problems that **tools cannot catch**. Don't waste time on what lint/typecheck/tests already verify.

**Size-based depth adjustment**:

**Small changes (<200 lines, <5 files)**:
- **Can afford detail**: Review code quality, naming, minor issues
- **But prioritize**: Logic correctness, edge cases, security
- **Skip**: Formatting (if project has linter), obvious style issues

**Medium changes (200-800 lines, 5-20 files)**:
- **Focus on**: Architecture, API contracts, data flow, security, performance
- **Ignore**: Style/formatting issues, naming nitpicks
- **Verify**: Changed function signatures → check all call sites
- **Tool-delegated**: Let lint/typecheck catch syntax, types, imports

**Large changes (800-2000 lines, 20-50 files)**:
- **Focus only on**: High-risk areas, architectural decisions, breaking changes
- **Ignore**: All style/quality issues unless security-critical
- **Impact analysis**: Modified shared functions → validate call chain safety
- **Tool-delegated**: All formatting, imports, basic type errors

**X-Large changes (>2000 lines, >50 files)**:
- **Focus exclusively on**: Critical paths, security, data integrity, breaking changes
- **Ignore**: Everything else
- **Impact analysis**: Deep dive on signature changes, state modifications
- **Require**: CI passing (lint, tests, typecheck) before review

**High-value details to ALWAYS check** (regardless of size):

1. **Impact analysis for signature changes**:
   ```bash
   # If function signature changed, find all callers
   git diff <from>..<to> -- path/to/file.ts | grep "^-.*function.*\|^+.*function"
   # Then search codebase for usage
   grep -r "functionName" --include="*.ts"
   ```
   - Verify all call sites still compatible
   - Check if change is backward compatible
   - Identify potential runtime errors

2. **Data flow completeness**:
   - New data field → verify: validation, storage, retrieval, display all updated
   - Deleted field → verify: migrations, backward compatibility
   - Changed type → verify: serialization, database schema, API contracts

3. **State management safety**:
   - Concurrent modification → check locking/atomicity
   - State transitions → verify all paths maintain invariants
   - Shared state → check thread safety, immutability

4. **Critical path correctness**:
   - Authentication/authorization changes → trace full flow
   - Payment/transaction logic → verify atomicity, rollback
   - Data deletion → confirm safeguards, audit trail

**Low-value details to SKIP** (when time is limited):

- Variable naming (unless truly confusing)
- Code formatting (if linter exists)
- Import organization
- Comment style
- Minor refactoring preferences
- Subjective "cleaner" alternatives

**Tool responsibility assumption**:
```bash
# Before reviewing, check if CI/tools are running:
# - Linter (eslint, pylint, clippy)
# - Type checker (tsc, mypy, flow)
# - Tests (unit, integration)
# - Security scanners (if present)

# If CI is green, trust it for:
# - Syntax errors
# - Type errors
# - Import errors
# - Formatting violations
# - Test coverage
```

**Exception**: If no CI or tools, adjust depth up one level (Medium → Small depth).

**Exit criteria**: Know what depth to review at for this change size.

### Stage 4: Risk Analysis

**Goal**: Identify high-risk changes requiring extra scrutiny.

**For Conservative projects OR Large changes, perform full risk analysis**:

**High-risk categories** (prioritize review attention):

1. **Security-sensitive**:
   - Authentication, authorization, session management
   - Input validation, SQL queries, command execution
   - Cryptography, secrets handling
   - File system operations, path traversal

2. **Data integrity**:
   - Database schema changes, migrations
   - Data transformation, imports/exports
   - Cache invalidation logic

3. **Public API changes**:
   - HTTP endpoint modifications (breaking changes)
   - Function signature changes in exported modules
   - GraphQL schema changes
   - Event/message contract changes

4. **Critical path**:
   - Payment processing, order handling
   - User registration, password reset
   - Data loss scenarios (delete operations)

5. **Performance-critical**:
   - Database queries in loops
   - Large data processing
   - API calls without pagination
   - Missing indexes

6. **Infrastructure**:
   - Deployment configs, environment variables
   - CI/CD pipeline changes
   - Dependency version bumps (major versions)

**Output**: Risk matrix with files/changes categorized by risk level.

**Exit criteria**: High-risk areas identified and prioritized.

### Stage 5: Detailed Review

**Goal**: Provide actionable feedback focused on high-value issues.

**Apply depth strategy from Stage 3.5** - focus on what matters for this change size.

**Review execution by size**:

**Small changes (<200 lines)**:
1. Review all changes thoroughly
2. Apply full checklist (see [reference/review-checklist.md](reference/review-checklist.md))
3. Can include quality feedback (naming, structure)
4. Use TodoWrite for findings

**Medium changes (200-800 lines)**:
1. **First pass**: Identify signature changes (functions, APIs, data structures)
   ```bash
   git diff <from>..<to> | grep -E "^[-+].*\b(function|def|class|interface|type|struct)\b"
   ```
2. **Impact analysis**: For each signature change, verify call sites:
   ```bash
   grep -r "changedFunctionName" --include="*.ts" .
   ```
3. **Focused review**: High-risk areas, data flow, error paths
4. **Skip**: Style, formatting, minor naming (unless confusing)
5. Use TodoWrite for high/medium findings only

**Large changes (800-2000 lines)**:
1. **Cherry-pick critical files**: Security, auth, data handling, migrations
2. **Impact analysis**: All modified public APIs → trace call chains
3. **Architecture review**: Does design make sense? Any anti-patterns?
4. **Data flow**: New fields/types → verify end-to-end consistency
5. **Skip**: All style/quality unless blocking issue
6. Use TodoWrite for critical/high findings only

**X-Large changes (>2000 lines)**:
1. **Create progress doc**: See [reference/progress-tracking.md](reference/progress-tracking.md)
2. **Verify CI passed**: Require green build (tests, lint, types)
3. **Review only**: Breaking changes, security, critical paths, migrations
4. **Impact analysis**: Any shared utilities or core changes → deep trace
5. **Skip**: Everything else - trust tests and CI
6. Ask user for focus areas if uncertain

**Universal high-value checks** (all sizes):

**1. Signature change impact**:
- Modified function → grep all callers, verify compatibility
- Changed interface/type → check implementing code
- Renamed exports → verify import sites updated

**2. Data completeness**:
- New field → verify: validation, storage, retrieval, display
- Type change → verify: serialization, DB schema, API contract aligned
- Deleted field → verify: migration path, backward compatibility

**3. Security on modified critical paths**:
- Auth changes → trace full flow (login → session → access check)
- Input handling → verify sanitization, validation
- SQL/queries → check parameterization, injection safety

**4. Error path coverage**:
- New operations → confirm error handling exists
- Changed exceptions → verify callers handle correctly
- Async operations → check promise rejection handling

**Context-aware reading**:
- **When signature changes**: Read callers and understand usage patterns
- **When core util changes**: Check dependents to assess blast radius
- **When data model changes**: Verify migrations and backward compatibility
- **Don't read unchanged code** unless needed for context

**Finding format**:
```
[SEVERITY] Category: Issue description
File: path/to/file.ts:123
Context: Relevant code snippet
Impact: What could go wrong
Suggestion: How to fix
```

Severity levels: CRITICAL, HIGH, MEDIUM, LOW, NITPICK

**Exit criteria**: All changes reviewed OR progress saved for large reviews.

### Stage 6: Summary and Report

**Goal**: Deliver actionable review feedback.

**Generate structured report**:

```markdown
# Code Review Summary

## Overview
- **Review scope**: <from>..<to> or PR #123
- **Files changed**: X files (+Y -Z lines)
- **Review strategy**: Conservative/Balanced/Best-practice
- **Overall assessment**: Approve / Request Changes / Needs Major Rework

## Critical Issues (🔴)
[List CRITICAL severity findings]

## Important Issues (🟡)
[List HIGH severity findings]

## Suggestions (🔵)
[List MEDIUM/LOW severity findings]

## Positive Observations
[Highlight good practices, improvements]

## Recommendations
[Prioritized action items]

## Review Progress
[For large reviews - link to progress document or indicate completion]
```

**For X-Large reviews**, save to `.code-review-progress.md` for resumption.

**Ask user**: "Would you like me to create GitHub/GitLab review comments?" (if PR/MR)

**Exit criteria**: Report delivered, user has actionable feedback.

## Tool Usage Strategy

**Prefer in this order**:

1. **MCP tools** (if available):
   - GitHub MCP: For PR metadata, comments, file contents
   - GitLab MCP: For MR metadata, discussions

2. **CLI tools** (fallback):
   ```bash
   # GitHub
   gh pr view 123 --json title,body,files
   gh pr diff 123

   # GitLab
   glab mr view 123
   glab mr diff 123
   ```

3. **Git commands** (always available):
   ```bash
   git diff <from>..<to>
   git log <from>..<to>
   git show <commit>
   ```

**For local review**, always prefer local git commands for better tool access.

## Advanced Features

**Resume from progress**: If `.code-review-progress.md` exists, parse it to understand:
- What's been reviewed
- Current position
- Outstanding issues
- Continue from last checkpoint

**Interactive focus**: For large reviews, ask user:
- "Which component should I focus on first?"
- "Are there specific concerns to prioritize?"
- "Should I skip any auto-generated files?"

**Diff strategies**: Automatically ignore:
- Lock files (package-lock.json, poetry.lock, Cargo.lock)
- Generated code (check for generation markers)
- Minified files

## Examples

See [examples/](examples/) for complete walkthroughs:
- [pr-review.md](examples/pr-review.md) - Reviewing a GitHub PR
- [branch-review.md](examples/branch-review.md) - Local branch comparison
- [large-review.md](examples/large-review.md) - Handling X-Large changes with progress tracking

## Reference Documentation

- [review-checklist.md](reference/review-checklist.md) - Comprehensive review checklist by language/framework
- [progress-tracking.md](reference/progress-tracking.md) - Progress document format for large reviews
- [risk-categories.md](reference/risk-categories.md) - Detailed risk categorization guide
- [review-strategies.md](reference/review-strategies.md) - Conservative vs Balanced vs Best-practice approaches

## Notes

- **Always** use TodoWrite to track stage progress
- **Never** approve without reviewing high-risk changes
- **Ask** when uncertain about project conventions
- **Focus** on signal over noise - actionable feedback only
- **Preserve** mental energy - prioritize ruthlessly for large reviews
