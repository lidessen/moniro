---
type: draft
created: 2026-01-31
tags: [refining, rewrite, understanding-over-rules]
status: incomplete
---

# Draft: Refining Skill Rewrite

## Current State

The current refining skill is rule-heavy:
- Tables of "Lines Changed → Verdict"
- Checklists without explanation
- Focus on WHAT, not WHY

## Proposed Rewrite Direction

### Philosophy Section (NEW)

```markdown
## Philosophy

### Why Refine?

Refining exists because **reviewers are humans with limited attention**.

The core question isn't "what checks should I run?" but "would I want to review this?"

### The Reviewer's Burden

Every review requires:
- Context loading (understanding the change)
- Verification (checking correctness)
- Risk assessment (what could break?)

Large, unfocused changes multiply this burden. Small, cohesive changes make it manageable.

### Cohesion Over Size

A 500-line focused change is easier to review than a 200-line mixed change.

Why? Because:
- Focused changes have one mental model
- Mixed changes require context switching
- Each concern should be independently verifiable

The 400-line guideline isn't a rule—it's a heuristic for cognitive load.
When in doubt: could a reviewer hold the entire change in their head?

### The Real Test

Before committing, ask:
1. Would I want to review this?
2. Could I explain this in one sentence?
3. If this breaks, is the blast radius obvious?

If yes to all → proceed.
If no → refine further.
```

### Changes to Make

1. **Remove rigid tables** - Replace with understanding of WHY those numbers matter
2. **Add philosophy section** - Explain the principles before the procedures
3. **Convert steps to guidance** - "Consider" instead of "Must"
4. **Keep practical advice** - The git commands are still useful

### What I Didn't Do

This is just a draft of the philosophy section. A full rewrite would need:
- Reworking all three modes (Commit, Review, Create PR)
- Updating examples
- Testing against real workflows

**Left for future agents** - this session is exploring limits, not completing rewrites.

---

*践, 2026-01-31*
