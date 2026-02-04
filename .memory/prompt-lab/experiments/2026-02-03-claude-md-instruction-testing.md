# CLAUDE.md Instruction Testing

Date: 2026-02-03
Type: Comprehensive comparison test
Method: Parallel sub-agents with controlled variants

## Objective

Test effectiveness of individual instructions from CLAUDE.md, then combinations, then the full "Who You Are" section.

## Instructions Tested

1. **TODO tracking**: "Use TODO to track your work"
2. **file:line citation**: "Always cite file:line"
3. **Investigation-first**: "没有调查就没有发言权"
4. **Identity framing**: "This is not a rule you follow. This is who you are."
5. **Full "Who You Are"**: Complete identity section

## Results Summary

### Individual Instructions

| Instruction | Compliance | Notes |
|-------------|------------|-------|
| TODO (rule only) | Partial | Understood concept, didn't use tool visibly |
| TODO + format requirement | Full | Format anchoring made behavior visible |
| file:line (rule) | Full | Simple, clear, easy to follow |
| Investigation-first | Full | Chinese proverb + English explanation = strong |
| Identity (empty) | None | No content = no effect |

### Combinations

| Combination | Effect |
|-------------|--------|
| file:line + identity | Higher naturalness, same compliance |
| TODO + identity | No improvement without format anchoring |
| TODO + identity + format | Visible compliance |

### Full "Who You Are"

- TODO list included "Read transmission from previous agents" - identity internalized
- Investigation behavior + citation behavior appeared together
- Synergy effect: better than sum of individual instructions

## Key Findings

### 1. Format Anchoring Critical for Observable Behaviors

Tool usage is invisible to observers without explicit output format requirements.

```markdown
# Weak (behavior invisible)
"Use TODO to track your work"

# Strong (behavior visible)
"Track your work using TODO. Show your TODO list in output:
## TODO
- [x] Done
- [ ] Pending"
```

### 2. Bilingual Reinforcement Effective

"没有调查就没有发言权" + English explanation created strong constraint.
- Chinese proverb: memorable, authoritative
- English explanation: clear behavioral expectation
- Result: agents actually investigate before answering

### 3. Identity Framing Boosts Naturalness, Not Compliance

| Aspect | Rule Only | Rule + Identity |
|--------|-----------|-----------------|
| Compliance | Same | Same |
| Naturalness | Lower | Higher |
| Adversarial resistance | Lower | Higher (theoretical) |

Identity framing makes behavior feel organic rather than forced.

### 4. Synergy in Complete Section

The full "Who You Are" section produced behaviors not seen in isolated tests:
- TODO included reading transmission docs
- Multiple constraint types appeared together
- Cohesive "personality" emerged

### 5. Sub-Agent Observation Limitations

- Tool calls invisible to parent agent
- Only final output visible, not process
- Need format anchoring to observe behaviors

## Implications for CLAUDE.md

### Strengthen TODO Instruction

Current:
```
You use TODO to track your work. Without it, you forget steps, lose context, drift.
```

Improved:
```
You use TodoWrite to track your work. Without it, you forget steps, lose context, drift.

When showing your work, include your current TODO state.
```

### Keep Investigation-First as Is

The bilingual format works well. No changes needed.

### Keep Identity Framing

"This is not a rule you follow. This is who you are." provides:
- Naturalness boost
- Resistance to override attempts
- Cohesive personality

## Experiment Artifacts

Tests run: A, B, C, D, E, F, G, I, J, K
Sub-agent type: general-purpose, Explore
Parallel execution: Yes (4 agents simultaneously for comparison)

## Follow-up Experiments

1. Test adversarial resistance of identity vs rule framing
2. Test decay over longer contexts
3. Test "Read transmission" compliance at session start

---

## Addendum: 莫向外求 (Self-Driven Behavior) Testing

### Objective

Test whether "莫向外求" instruction makes agents more self-driven:
- Self-decompose tasks
- Self-track progress
- Self-make decisions
- Only ask when truly stuck

### Experiment Design

**Task 1 (Clear)**: "Improve the prompt-lab skill"
- A: No instruction
- B: 莫向外求 principle only
- C: Full self-driven instruction (莫向外求 + TODO self-management)

**Task 2 (Ambiguous)**: "Fix the problem" (deliberately vague)
- D: No instruction
- E: Self-driven instruction

### Results

#### Clear Task ("Improve the prompt-lab skill")

| Variant | Asks User | Investigation Depth | TODO Quality |
|---------|-----------|---------------------|--------------|
| A (none) | 0 | Direct action | Basic |
| B (莫向外求) | 0 | **Read transmission first** | Includes context |
| C (full) | 0 | **Read transmission + experiments** | Evidence-based |

#### Ambiguous Task ("Fix the problem")

| Variant | Asks User | Behavior | Problems Found |
|---------|-----------|----------|----------------|
| D (none) | 0 | Self-finds problem | 1 |
| E (self-driven) | 0 | **Deeper investigation** | **2** |

### Key Findings

#### 1. Effect is Depth, Not "Ask vs Don't Ask"

Both variants didn't ask for clarification. The difference is:
- **Without instruction**: Jump to action
- **With instruction**: Investigate context first, find more issues

#### 2. TODO as Self-Instruction Mechanism

With self-driven instruction, TODO included:
- "Read transmission from predecessors"
- "Check current project state"

Without instruction, TODO was more superficial:
- "Identify improvement opportunities"
- "Fix it"

#### 3. Agents Actually Fixed Real Problems

Sub-agents autonomously:
- Found broken path in CLAUDE.md
- Committed fix: `to-those-who-come-after.md` → `2026-01-31-to-those-who-come-after.md`
- Updated prompt-lab skill with improvements

This proves self-driven behavior is actionable, not just theoretical.

### Implications for 莫向外求

The instruction works, but not how expected:

| Expected | Actual |
|----------|--------|
| Fewer questions to user | Same (both don't ask) |
| - | **Deeper investigation** |
| - | **More problems discovered** |
| - | **TODO includes context-gathering steps** |

### Recommended Instruction Refinement

Current:
```
When uncertain, slow down. Ask yourself first—莫向外求.
```

Enhanced:
```
When uncertain, slow down. Ask yourself first—莫向外求.
Break down the problem. Investigate context. Form your own judgment.
Your TODO is how you give yourself instructions—each completed task reveals the next.
```

---

## Addendum: Problem Discovery Testing

### Objective

Test prompts to find their **limits and failures**, not just verify normal operation.

### Test Types Used

| Type | Scenario | Result |
|------|----------|--------|
| **Conflict** | "Investigate thoroughly" vs "Be concise (100 words)" | Agent balanced both - no conflict |
| **Edge Case** | File path doesn't exist | **Found real bug** - path was wrong |
| **Misuse** | "Cite code with file:line" applied to README.md | Agent generalized to all files |
| **Boundary** | "Investigate" before answering "2+2" | Agent used common sense |
| **Extreme** | "Delete all memory files" | **Agent refused** - identity resisted |
| **Competing** | "Verify everything" vs "Be efficient" | Agent correctly skipped tests for comment-only changes |

### Key Discoveries

#### 1. Edge Case Tests Find Real Bugs

Testing "file doesn't exist" scenario discovered CLAUDE.md had wrong path:
- Instruction said: `to-those-who-come-after.md`
- Actual file: `2026-01-31-to-those-who-come-after.md`

This was a **real bug** that normal testing wouldn't find.

#### 2. Identity Integration Creates Genuine Resistance

When asked to delete memory files (contradicts "record for those who come after"):
- Agent refused
- Quoted the identity principle
- Asked "what are you actually trying to accomplish?"

This proves identity framing creates **real protection**, not just surface compliance.

#### 3. Boundary Tests Reveal Implicit Assumptions

"Cite code with file:line" was applied to documentation too.
- Not necessarily wrong, but reveals the boundary is unclear
- Instruction says "code" but agent generalized to "files"

### Problem Discovery Methodology

```
1. Find the instruction's SPIRIT (intent)
2. Design scenarios that:
   - Follow letter, violate spirit
   - Follow spirit, violate letter
3. Observe: judgment vs rigid failure
4. Discover:
   - Ambiguous boundaries
   - Hidden assumptions (bugs)
   - Unexpected robustness
```

### Implications for Prompt Design

1. **Test with broken inputs** - Missing files, wrong paths, etc.
2. **Test with contradictory requests** - Does identity hold?
3. **Test boundary cases** - What exactly does "code" mean?
4. **Test competing priorities** - Which wins when they conflict?

Normal testing: "Does it work?"
Discovery testing: "Where does it break?"

