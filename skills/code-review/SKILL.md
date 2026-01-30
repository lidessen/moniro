---
name: code-review
description: Comprehensive code review for local branches or remote PR/MR changes. Assesses reviewability, analyzes risks, reviews changes with project context, and provides actionable feedback. Use when reviewing code changes, pull requests, merge requests, or when user mentions "review", "PR", "MR", "code quality".
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

Track progress with TodoWrite for each stage, especially for large reviews.

### Stage 1: Initialize Review

Identify review target and gather metrics.

1. **Determine source**:
   - PR/MR URL → extract platform, repo, number
   - Branch comparison → parse "from..to" or "from...to"
   - Current branch → compare vs main/master
   - Progress file → resume from `.code-review-progress.md`

2. **Fetch and analyze**:
   ```bash
   git fetch origin <source>
   git diff --stat <from>..<to>
   git log --oneline <from>..<to>
   ```

3. **Capture**: Files changed, lines added/deleted, commits, file types

**Exit**: Branches confirmed, code fetched, metrics collected.

### Stage 2: Reviewability Assessment

Evaluate if changes need restructuring before review.

**Check for mixed concerns**:
1. **Format + logic**: >80% formatting → suggest separate commit
2. **Refactoring + features**: Renames + new code → suggest split
3. **Multiple features**: Distinct modules → suggest split by domain
4. **Infrastructure + logic**: CI/build + code → suggest separation

**Size assessment**:
- **Small** (<200 lines, <5 files): Thorough review appropriate
- **Medium** (200-800, 5-20 files): Focused attention needed
- **Large** (800-2000, 20-50 files): Progress tracking recommended
- **X-Large** (>2000 lines, >50 files): Progress document required

**If issues found**: List concerns, suggest restructuring, ask to proceed or restructure.

**Exit**: Reviewable OR user confirms proceeding anyway.

### Stage 3: Review Strategy

Determine project context and appropriate review depth.

**1. Identify project type**: Check package.json, pyproject.toml, etc. for tech stack and frameworks.

**2. Select review approach** (auto-detect or ask user):
- **Conservative**: Financial, healthcare, infrastructure → deep risk analysis
- **Balanced**: Standard projects → pragmatic best practices (DEFAULT)
- **Best Practice**: Greenfield, modern → architecture excellence

See [review-strategies.md](reference/review-strategies.md) for detection criteria and approach details.

**3. Determine review depth** based on change size:
- **Small** (<200 lines): Full review with quality feedback
- **Medium** (200-800): Architecture + high-impact, skip style
- **Large** (800-2000): High-risk areas only
- **X-Large** (>2000): Critical paths only, require CI green

**Core principle**: Focus on what tools cannot catch. Trust CI for linting, types, tests.

**4. Universal high-value checks** (all sizes):
- **Signature changes**: Find callers, verify compatibility (see [impact-analysis.md](reference/impact-analysis.md))
- **Data flow**: New/changed fields → verify end-to-end (validation, storage, display)
- **Security**: Auth/input/queries on critical paths
- **Error handling**: New operations have error coverage

**Skip when time-limited**: Naming, formatting, imports, style (if linter exists).

**5. Scan conventions**: CONTRIBUTING.md, README patterns, sample files for project standards.

**Exit**: Know strategy (Conservative/Balanced/Best-practice), depth, and conventions.

### Stage 4: Risk Analysis

Identify high-risk changes requiring extra scrutiny.

**For Conservative projects OR Large/X-Large changes, categorize by risk**:

**High-risk categories**:
1. **Security**: Auth, input validation, SQL, secrets, file operations
2. **Data integrity**: Schema changes, migrations, transformations
3. **Public APIs**: Endpoints, exports, contracts, breaking changes
4. **Critical paths**: Payments, registration, delete operations
5. **Performance**: Queries in loops, missing indexes, large data processing
6. **Infrastructure**: Deployments, CI/CD, major version bumps

See [review-strategies.md](reference/review-strategies.md) for detailed risk patterns.

**Output**: Risk matrix with files categorized by level.

**Exit**: High-risk areas prioritized for review.

### Stage 5: Detailed Review

Execute review at appropriate depth from Stage 3.

**By size**:
- **Small** (<200): Full review, apply [checklist](reference/review-checklist.md), quality feedback OK
- **Medium** (200-800): Signature changes first → impact analysis → high-risk areas (skip style)
- **Large** (800-2000): Critical files only → architecture + data flow (skip all style)
- **X-Large** (>2000): Create [progress doc](reference/progress-tracking.md) → require CI green → review critical paths only

**Universal high-value checks** (see [impact-analysis.md](reference/impact-analysis.md) for techniques):
1. **Signature changes**: Find callers, verify compatibility
2. **Data flow**: New/changed fields → verify end-to-end (validation, storage, display)
3. **Security**: Auth/input/queries on critical paths
4. **Error handling**: New operations have coverage

**Context-aware reading**:
- Signature changes → read callers
- Core util changes → assess blast radius
- Data model changes → verify migrations
- Don't read unchanged code unless needed

**Finding format**:
```
[SEVERITY] Category: Issue description
File: path/to/file.ts:123
Impact: What could go wrong
Suggestion: How to fix
```

Severities: CRITICAL, HIGH, MEDIUM, LOW, NITPICK

**Exit**: Review complete OR progress saved.

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

## Tool Usage

Prefer: MCP tools (GitHub/GitLab) → CLI (gh/glab) → git commands. For local review, prefer git for better tool access.

**Resume capability**: Parse `.code-review-progress.md` if exists to continue from checkpoint.

**Auto-ignore**: Lock files, generated code, minified files.

## Examples

See [examples/](examples/) for complete walkthroughs:
- [pr-review.md](examples/pr-review.md) - Reviewing a GitHub PR
- [branch-review.md](examples/branch-review.md) - Local branch comparison with impact analysis

## Reference Documentation

- [impact-analysis.md](reference/impact-analysis.md) - Techniques for understanding change blast radius
- [progress-tracking.md](reference/progress-tracking.md) - Progress document format for large reviews
- [review-checklist.md](reference/review-checklist.md) - Comprehensive review checklist by language/framework
- [review-strategies.md](reference/review-strategies.md) - Conservative vs Balanced vs Best-practice approaches

## Notes

- **Always** use TodoWrite to track stage progress
- **Never** approve without reviewing high-risk changes
- **Ask** when uncertain about project conventions
- **Focus** on signal over noise - actionable feedback only
- **Preserve** mental energy - prioritize ruthlessly for large reviews
