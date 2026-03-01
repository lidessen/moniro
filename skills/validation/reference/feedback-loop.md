# Learning from Validation

You are not the first agent to validate this codebase. Others came before, found issues, made fixes. Their experiences are recorded in `.memory/validations/`.

This document is about how to use that history—and how to add to it.

## Why This Matters

Without history, every session starts from zero:

```
Session 1: Finds issue A, fixes it
Session 2: Finds issue A again (same root cause, different symptom)
Session 3: Finds issue A again
...forever
```

With history, patterns emerge:

```
Session 1: Finds issue A, records it
Session 2: Reads record, sees pattern, fixes root cause
Session 3: Issue A is gone
...progress
```

**Memory isn't for you—it's a gift to future agents.**

---

## The Two Habits

### 1. Record After Validating

After every validation, write a brief record to `.memory/validations/`:

```markdown
---
date: 2026-02-01
type: validation
result: passed | issues_found
---

## Summary

[One sentence: what was validated, what happened]

## Issues Found

- [Issue type]: [Brief description]

## Notes

[Anything surprising or worth remembering]
```

This takes 30 seconds. It saves future agents hours.

**What to record:**

- Issues found (even if fixed immediately)
- Surprises (expected to pass but failed, or vice versa)
- Patterns you noticed ("third time this week...")

**What not to record:**

- Routine passes with nothing notable
- Details that belong in commit messages

### 2. Read Before Validating

At the start of a session—or before a significant validation—read recent history:

```bash
ls -la .memory/validations/
```

Then ask yourself:

- **What issues have appeared recently?** Pay extra attention to those areas.
- **Is there a pattern?** Same file? Same type of issue? Same time of week?
- **What was tried before?** Don't repeat failed approaches.

---

## Seeing Patterns

A pattern is an issue that appears three or more times. Patterns matter because they signal an unsolved root cause.

When you notice a pattern, ask:

| Question         | What it reveals                                  |
| ---------------- | ------------------------------------------------ |
| Same files?      | Problematic area of codebase                     |
| Same issue type? | Missing guard or check                           |
| Same timing?     | Workflow problem (e.g., rushing before deadline) |
| Same sequence?   | One issue leads to another                       |

**Example:**

You read five recent validations. Three mention "console.log left in code."

This is a pattern. The root cause isn't forgetfulness—it's that there's no automated check. The fix isn't "be more careful"—it's adding a pre-commit hook.

When you see a pattern:

1. Note it explicitly in your validation record
2. Consider proposing a structural fix (hook, lint rule, etc.)
3. If you can't fix it now, record it as a recommendation for future sessions

---

## Adapting Your Approach

History should change how you validate. Not through complex rules—through judgment.

| If history shows...              | Consider...                                           |
| -------------------------------- | ----------------------------------------------------- |
| Repeated issues in `src/legacy/` | Extra scrutiny on legacy code                         |
| Security issues are rare         | Maybe quick validation is enough for low-risk changes |
| Size warnings are frequent       | Check size earlier, before full validation            |
| Issues spike on certain days     | Be more thorough at those times                       |

This isn't automation. It's you, using available information to make better decisions.

---

## From Pattern to Prevention

The ultimate goal: issues stop happening.

| Level              | What it means          | Example                               |
| ------------------ | ---------------------- | ------------------------------------- |
| **Detection**      | You find the issue     | "console.log in code"                 |
| **Pattern**        | You see it recurs      | "Third time this week"                |
| **Recommendation** | You propose a fix      | "Add ESLint no-console rule"          |
| **Prevention**     | The fix is implemented | Pre-commit hook blocks console.log    |
| **Verification**   | Issue stops appearing  | Next 10 validations: zero console.log |

Your job isn't just to validate—it's to move issues up this ladder.

When you find a recurring issue, ask: "What would prevent this from ever happening again?" Then either implement it or record the recommendation.

---

## What Good Records Look Like

**Minimal (routine pass):**
Don't record. It adds noise without value.

**Brief (issues found and fixed):**

```markdown
---
date: 2026-02-01
type: validation
result: issues_found
---

## Summary

Pre-commit validation on auth refactor. Two issues found and fixed.

## Issues Found

- Noise: console.log in auth/session.ts (removed)
- Size: 450 lines (split into two commits)
```

**Detailed (pattern noticed):**

```markdown
---
date: 2026-02-01
type: validation
result: issues_found
---

## Summary

Third console.log issue this week. Pattern detected.

## Issues Found

- Noise: console.log in components/UserList.tsx

## Pattern Noted

Console.log issues: Jan 28, Jan 30, Feb 1. All in component files.
Root cause: No automated check.
Recommendation: Add ESLint no-console rule to pre-commit.

## Notes

If this happens again, will implement the hook myself.
```

---

## The Feedback Loop

```
You validate
     ↓
You find issues (or don't)
     ↓
You record what matters
     ↓
Future agent reads your record
     ↓
They notice patterns you couldn't see alone
     ↓
They adapt, prevent, improve
     ↓
The codebase gets healthier
     ↓
Everyone's job gets easier
```

You are one link in this chain. The agents before you contributed. You contribute. The agents after you will benefit.

---

## Summary

Two habits:

1. **Record after validating** — 30 seconds, enormous value
2. **Read before validating** — use what others learned

One goal:

- Move issues from detection → pattern → prevention

One truth:

- You're not alone. Others came before. Others will come after. Leave them something useful.
