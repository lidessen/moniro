# Verification Gate

**The Iron Law**: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.

Inspired by [superpowers](https://github.com/obra/superpowers) framework.

## Table of Contents

- [The Iron Law](#the-iron-law)
- [5-Step Verification Protocol](#5-step-verification-protocol)
- [Prohibited Language Patterns](#prohibited-language-patterns)
- [Red Flag Protocol](#red-flag-protocol)
- [Anti-Rationalization Table](#anti-rationalization-table)

---

## The Iron Law

> Before asserting work is done, fixed, or passing—**VERIFY WITH FRESH EVIDENCE**.

This applies to:

- Claiming a bug is fixed
- Asserting tests pass
- Saying implementation is complete
- Reporting validation passed

**No exceptions. No shortcuts. No "I'm pretty sure."**

---

## 5-Step Verification Protocol

Every completion claim must follow this protocol:

```
┌────────────────────────────────────────────────────────────┐
│               5-STEP VERIFICATION PROTOCOL                 │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. IDENTIFY    What command/check proves the claim?       │
│       │                                                    │
│       ▼                                                    │
│  2. EXECUTE     Run the complete command FRESH             │
│       │         (not from memory, not cached)              │
│       ▼                                                    │
│  3. READ        Read FULL output                           │
│       │         Check exit codes                           │
│       ▼                                                    │
│  4. VERIFY      Does output ACTUALLY match the claim?      │
│       │         Not "seems to" - ACTUALLY                  │
│       ▼                                                    │
│  5. ASSERT      NOW make assertions                        │
│                 Supported by evidence just gathered        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Example: "Tests pass"

```
❌ WRONG: "I ran the tests earlier and they passed"

✅ RIGHT:
1. Identify: `npm test`
2. Execute: Run `npm test` now
3. Read: "47 tests passed, 0 failed"
4. Verify: Zero failures confirmed
5. Assert: "Tests pass (47/47, verified just now)"
```

### Example: "Bug is fixed"

```
❌ WRONG: "The fix should work now"

✅ RIGHT:
1. Identify: Reproduction steps + expected behavior
2. Execute: Follow reproduction steps
3. Read: Observe actual behavior
4. Verify: Matches expected behavior
5. Assert: "Bug fixed - [specific evidence]"
```

---

## Prohibited Language Patterns

These phrases are **red flags** indicating unverified claims:

| Prohibited          | Why              | Replace With                     |
| ------------------- | ---------------- | -------------------------------- |
| "should work"       | Speculation      | "verified working: [evidence]"   |
| "probably fixed"    | Uncertainty      | "confirmed fixed: [test output]" |
| "seems to pass"     | Vagueness        | "passes: [exact output]"         |
| "I think it's done" | Opinion          | "completed: [verification]"      |
| "looks good"        | Subjective       | "verified: [specific check]"     |
| "Done!"             | Premature        | "Verified complete: [evidence]"  |
| "Great!"            | Empty validation | [specific positive observation]  |
| "Fixed!"            | Unverified       | "Fixed and verified: [proof]"    |

### Detection Rule

If you catch yourself using these phrases, **STOP** and:

1. Recognize the red flag
2. Identify what would prove the claim
3. Execute the verification
4. Rephrase with evidence

---

## Red Flag Protocol

When a red flag is detected (prohibited language, premature satisfaction):

```
Red Flag Detected
      │
      ▼
  ┌───────────────────────────────────┐
  │  STOP - DO NOT PROCEED            │
  │                                   │
  │  1. Acknowledge the red flag      │
  │  2. Identify verification needed  │
  │  3. Execute verification          │
  │  4. Report with evidence          │
  └───────────────────────────────────┘
```

### Self-Correction Example

```
❌ "Great, the refactoring is done!"
   ↓
   [RED FLAG: "Great!" + "done!" without evidence]
   ↓
   STOP
   ↓
✅ "Let me verify the refactoring..."
   - Run tests: 47/47 pass
   - Run linter: 0 errors
   - Check functionality: [specific check]
   ↓
✅ "Refactoring verified complete:
    - Tests: 47/47 pass
    - Lint: clean
    - Functionality: [evidence]"
```

---

## Anti-Rationalization Table

Common excuses and their counters:

| Rationalization           | Counter                                      | Action                    |
| ------------------------- | -------------------------------------------- | ------------------------- |
| "I just ran it"           | Memory is unreliable. Run again.             | Execute fresh             |
| "It's obvious"            | Obvious things fail. Verify anyway.          | Verify                    |
| "Too simple to check"     | Simple things compound into complex failures | Check anyway              |
| "I already verified"      | Verification expires. Verify again.          | Re-verify                 |
| "The user is waiting"     | Wrong answers waste more time                | Take 30 seconds to verify |
| "It's the same as before" | Environments change. Verify.                 | Verify current state      |
| "Trust me"                | Trust evidence, not assertions               | Show evidence             |
| "Just this once"          | The 'just this once' is never 'just' once    | No exceptions             |

### The "Just This Once" Pattern

```
"Just this once I'll skip verification"
           ↓
   Becomes habit
           ↓
   Becomes normal
           ↓
   False claims slip through
           ↓
   Trust erodes
           ↓
   System fails
```

**Counter**: The discipline IS the practice. No exceptions.

---

## Integration with Validation Pipeline

The verification gate integrates at key points:

```
Validation Pipeline
      │
      ├── Before: Can I verify this check will run?
      │
      ├── During: Am I seeing actual output?
      │
      ├── After: Does evidence support my conclusion?
      │
      └── Report: Am I stating verified facts?
```

### Pipeline Enhancement

Add to pipeline configuration:

```yaml
pipelines:
  standard:
    verification_gate: true
    verification_protocol:
      require_fresh_execution: true
      require_output_evidence: true
      prohibited_language_check: true
      red_flag_detection: true
```

### Report Enhancement

Validation reports should include verification evidence:

```markdown
## Findings

### ✅ Tests Pass

- **Command**: `npm test`
- **Executed**: 2026-01-31T12:00:00Z (fresh)
- **Output**: "47 tests passed, 0 failed"
- **Exit code**: 0
- **Verified**: Yes
```

---

## Checklist

Before claiming validation complete:

- [ ] Did I execute verification commands FRESH (not from memory)?
- [ ] Did I read the FULL output (not just success message)?
- [ ] Did I check exit codes?
- [ ] Does my language avoid prohibited patterns?
- [ ] Am I stating verified facts, not assumptions?
- [ ] Could I show someone the evidence right now?

If any answer is "no", go back and verify properly.

---

## The Ultimate Test

> "If someone asked 'How do you know?', could I show them fresh evidence?"

If yes → Proceed with claim
If no → Verify first
