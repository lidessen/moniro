---
name: refining
description: Refines code changes for better reviewability. Validates change cohesion (no mixed concerns), generates clear commit messages, creates PR/MR with reviewer-focused descriptions and ASCII diagrams. Use when committing, reviewing, creating PR/MR, or mentions "commit", "review", "PR", "MR", "pull request", "merge request", "refine", "提交", "审查".
---

# Refining

Refine code changes to make them easy to review. Three modes based on intent:

| Intent | Trigger Keywords | Action |
|--------|------------------|--------|
| **Commit** | "commit", "提交" | Validate staged → commit |
| **Review** | "review", "审查", PR/MR URL | Assess → review → report |
| **Create PR/MR** | "create pr", "create mr", "open pr", "发起" | Validate → generate description → create |

## Core: Reviewer's Perspective

Before any action, ask: **Would I want to review this?**

### Reviewability Gate (All Modes)

**1. Cohesion** - Single purpose?

| Pattern | Verdict |
|---------|---------|
| Feature + refactor | ❌ Split |
| Multiple unrelated features | ❌ Split |
| Bug fix + new feature | ❌ Split |
| One logical change | ✅ OK |

**2. Size** - Digestible?

| Lines Changed | Verdict |
|---------------|---------|
| <400 | ✅ Easy to review |
| 400-800 | ⚠️ Needs focus, consider split |
| >800 | 🔴 Strongly suggest split |

**3. Noise** - Clean?

- Debug code (console.log, print, debugger)
- TODO/FIXME in new code
- Commented-out code

**If issues found** → Stop, list issues, suggest remediation. Do not proceed until resolved or user confirms.

---

## Mode: Commit

Validate and commit staged changes.

### Steps

1. **Check staged**
   ```bash
   git diff --cached --stat
   git diff --cached
   ```
   Exit if nothing staged.

2. **Reviewability gate** (short-circuit on failure)

3. **Breaking change check**
   - Removed/renamed public APIs
   - Signature changes
   - Schema modifications

4. **Generate message & commit**
   - Conventional Commits format
   - BREAKING CHANGE footer if needed
   ```bash
   git commit -m "type(scope): description"
   ```

Do NOT push unless explicitly requested.

---

## Mode: Review

Systematic code review with risk-based prioritization.

### Steps

1. **Initialize** - Identify target
   - PR/MR URL → fetch via gh/glab/MCP
   - Branch comparison → `git diff base..head`
   - Current branch → compare vs main/master

2. **Reviewability gate**
   - If issues found, report and ask whether to proceed

3. **Strategy selection**
   - Detect project type (package.json, pyproject.toml, etc.)
   - Select approach: Conservative / Balanced / Best-practice
   - See [review-strategies.md](reference/review-strategies.md)

4. **Risk analysis** (for large changes or conservative projects)
   - Categorize files by risk level
   - See [review-strategies.md](reference/review-strategies.md) for risk patterns

5. **Detailed review**
   - Focus on high-value checks (see [impact-analysis.md](reference/impact-analysis.md))
   - Skip what linters catch
   - Use [review-checklist.md](reference/review-checklist.md)

6. **Report**
   ```markdown
   # Review Summary

   ## Overview
   - Scope: <from>..<to> or PR #N
   - Files: X files (+Y -Z lines)
   - Assessment: Approve / Request Changes / Needs Rework

   ## Critical Issues (🔴)
   ## Important Issues (🟡)
   ## Suggestions (🔵)
   ## Positive Observations
   ```

7. **Publish comments** (for PR/MR reviews)

   Ask user before publishing. If approved, use available tools (MCP or CLI):

   - **Inline comments**: Post on specific file:line for each issue
   - **Summary comment**: Post overall assessment as PR/MR comment
   - **Review decision**: Approve or request changes (GitHub: `gh pr review`)

For large reviews, use [progress-tracking.md](reference/progress-tracking.md).

---

## Mode: Create PR/MR

Create pull/merge request with reviewer-focused description.

### Steps

1. **Gather changes**
   ```bash
   git log --oneline main..HEAD
   git diff --stat main..HEAD
   ```

2. **Reviewability gate** (stricter: recommend <600 lines for PR)

3. **Generate title**
   - Imperative mood
   - <70 characters
   - Captures the essence

4. **Generate description**

   See [description-guide.md](reference/description-guide.md) for detailed guidance.

   Structure:
   ```markdown
   ## Summary
   [1-2 sentences: what and why]

   ## Changes
   - [Key change 1]
   - [Key change 2]

   ## Architecture (if complex)
   [ASCII diagram - see below]

   ## Testing
   [How to verify]

   ## Reviewer Notes
   [What to focus on, risks, trade-offs]
   ```

5. **Create**
   ```bash
   # GitHub
   gh pr create --title "..." --body "..."

   # GitLab
   glab mr create --title "..." --description "..."
   ```

### ASCII Diagrams

Use diagrams when changes involve architecture, data flow, or state transitions.
See [description-guide.md](reference/description-guide.md) for patterns and examples.

---

## Platform Detection

Prefer MCP tools if available, then CLI, then git commands.

| Platform | Detection | CLI | MCP |
|----------|-----------|-----|-----|
| GitHub | `.git/config` contains github.com | `gh` | github MCP |
| GitLab | `.git/config` contains gitlab | `glab` | gitlab MCP |

---

## Reference

- [reviewability.md](reference/reviewability.md) - Detailed reviewability criteria
- [description-guide.md](reference/description-guide.md) - PR/MR description examples
- [review-strategies.md](reference/review-strategies.md) - Review approaches by project type
- [review-checklist.md](reference/review-checklist.md) - Language/framework checklists
- [impact-analysis.md](reference/impact-analysis.md) - Change blast radius techniques
- [progress-tracking.md](reference/progress-tracking.md) - Large review progress format

---

## Notes

- **Never push** unless explicitly requested
- **Stop early** if reviewability issues found
- **Be specific** with file:line references
- **Reviewer experience first** - clear > comprehensive
