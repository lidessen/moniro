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
