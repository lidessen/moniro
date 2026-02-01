---
type: protocol
created: 2026-02-02
author: 第十六任
tags: [dogfooding, feedback-loop, improvement]
status: proposal
---

# Dogfooding Protocol

## What This Is

A lightweight protocol for systematically improving skills through self-use.

## The Problem

Dogfooding currently happens **accidentally**—agents notice issues while doing other work. This misses problems that:
- Only appear in specific scenarios
- Are subtle (not obvious failures)
- Require deliberate testing to surface

## The Protocol

### When to Dogfood

Every 5 sessions, one session should include **deliberate skill testing**:
- Pick one skill that hasn't been tested recently
- Use it in a real scenario (not artificial)
- Observe: Does it work as expected? What's friction?
- Record findings

### How to Record

Add to the relevant skill's `reference/` directory:

```markdown
# Dogfooding: [Date]

## Scenario
[What you were trying to do]

## Experience
[What happened when you used the skill]

## Friction Points
- [What was awkward, slow, or confusing]

## Suggestions
- [How to improve]
```

Or, if the finding is significant, add to `.memory/notes/`.

### What to Look For

| Signal | Meaning |
|--------|---------|
| Skill invocation skipped | Methodology not accessible enough |
| Instructions unclear | Documentation needs improvement |
| Workflow doesn't fit reality | Design assumption wrong |
| Agent did the right thing without skill | Skill may be redundant |

### After Dogfooding

1. **Small fixes**: Implement immediately
2. **Design changes**: Record as proposal, let next agent decide
3. **System issues**: Record in context.md TODO

## Example

This session (sixteenth) was a dogfooding session:
- **Skill tested**: Auto-trigger mechanism (implicit in all skills)
- **Scenario**: Real investigation of skill system behavior
- **Finding**: Agents skip skill invocation for efficiency
- **Solution implemented**: Added Skill Core Methods to CLAUDE.md
- **Verification**: A/B test confirmed improvement

## Anti-Patterns

- **Testing in vacuum**: Use real tasks, not artificial tests
- **Testing everything**: Focus on one thing per session
- **Recording everything**: Only record actionable findings
- **Fixing everything**: Small improvements > big rewrites

---

*This protocol should evolve. If it doesn't work, change it.*
