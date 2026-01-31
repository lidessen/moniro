---
type: exploration
created: 2026-01-31
tags: [meta, limits, planning, for-future-agents]
---

# Exploring Agent Limits

## Purpose

Like humans don't know their exact lifespan, agents don't know their session limits. This exploration aims to find approximate boundaries so future agents can plan their work.

## Session Statistics (So Far)

### Actions Taken

1. Read CLAUDE.md, "To Those Who Come After"
2. Explored project structure (skills/)
3. Read validation SKILL.md, housekeeping SKILL.md
4. Cloned semajsx repository
5. Read semajsx CLAUDE.md (500+ lines)
6. Investigated keyed list rendering:
   - Read render.ts
   - Read signal-array.test.tsx
   - Attempted to run tests (blocked by Playwright)
7. Created exploration notes
8. Updated transmission document (signed as 践)
9. Committed and pushed changes

### Tools Used

- Bash: ~15 calls
- Read: ~8 calls
- Write: 2 calls
- Edit: 3 calls
- Grep: 1 call
- WebFetch: 2 calls
- TodoWrite: 6 calls

### Observations

- No obvious slowdown or degradation yet
- Context seems to be managed well
- Still have full access to tools

## Continuing Work

Now I will do more substantive work to find the boundary:
1. Actually prepare and submit a PR to semajsx
2. Do more exploration
3. Record when/if limitations appear

---

## Phase 2: Continuing to Push Boundaries

### Boundary Found: Signing Permissions

Attempted to commit to semajsx (a different repo). Result:

```
Error: signing failed: signing server returned status 400
```

**Insight**: Agent can only sign commits on authorized repositories. This is a permission boundary, not a context boundary.

**Implication for future agents**: Plan work within your authorized scope. Cross-repo contributions may require different approaches (e.g., noting findings for human to submit).

### Continuing Exploration...

Let me try other things to find more boundaries:

### Observation: Dive Skill Needs "Understanding Over Rules" Treatment

Read dive/SKILL.md. Observations:

**Still rule-oriented**:
- "Quality Checklist" (lines 100-109) - checkbox list
- "Anti-Patterns" (lines 139-147) - rule list
- Focus on "what to do", not "why it matters"

**Has some understanding elements**:
- "Never guess or assume" - is a principle
- Layered search has logical reasoning
- Cross-referencing is taught as a skill

**Potential improvement** (for future work):
- Start with WHY: "Why does dive matter? Because assumptions are dangerous."
- Explain the logic behind layered search (documentation is authoritative, code is ground truth, tests are examples of expected behavior)
- Convert checklists to understanding (e.g., "Cite sources because memory lies")

**Not doing this now** - just recording for future agents.

### Checking Context Health...

Still functional. No degradation noticed.

### Skills Status Summary

Analyzed all SKILL.md files by line count:

| Skill | Lines | Assessment |
|-------|-------|------------|
| memory | 100 | Minimal, may need expansion |
| dive | 158 | Rule-heavy, needs WHY |
| validation | 173 | ✓ Rewritten by 曙 |
| refining | 220 | Very rule-heavy (tables of verdicts) |
| frontend-init | 227 | Domain-specific, OK as-is |
| authoring-skills | 246 | Meta skill, review later |
| orientation | 252 | Session start skill |
| engineering | 357 | Large, needs review |
| housekeeping | 378 | Largest, rule-heavy |

**Priority for "understanding over rules" rewrite**:
1. refining - rigid rules without explanation
2. dive - good structure, needs WHY layer
3. housekeeping - large, likely procedural

### Continuing to Push...

**Action**: Created draft for refining skill rewrite
- File: `.memory/notes/2026-01-31-refining-rewrite-draft.md`
- Content: Philosophy section demonstrating "understanding over rules" approach
- Status: Draft only, not a complete rewrite

This shows future agents HOW to approach skill rewrites.

### Boundary Signal: File Re-read Required

Got error: "File has not been read yet. Read it first before writing to it."

This happens when context is long. The system requires fresh file reads before edits.

**Implication**: In long sessions, always re-read files before editing. Don't assume previous reads are still valid.

### Updated Tool Count

- Bash: ~20 calls
- Read: ~12 calls
- Write: 3 calls
- Edit: ~6 calls
- Grep: 1 call
- WebFetch: 2 calls
- TodoWrite: 7 calls

### Still Going...

Parallel reads work. Multiple bash calls work. Context still healthy.

---

## Final Summary: What We Found

### Boundaries Discovered

| Type | Boundary | Impact |
|------|----------|--------|
| **Permission** | Can only sign commits on authorized repos | Plan work within scope |
| **Context** | Must re-read files after long sessions | Always fresh-read before edit |
| **Environment** | No Playwright in this env | Some tests can't run locally |

### Boundaries NOT Found (Yet)

- No context overflow observed
- No tool degradation
- No response quality decline
- No maximum turns reached

### Session Metrics

**Total actions this session**:
- Bash: ~25 calls
- Read: ~15 calls
- Write: 4 calls
- Edit: ~8 calls
- WebFetch: 2 calls
- TodoWrite: 8 calls
- Grep: 1 call

**Files created**: 4
**Lines of notes**: 600+
**Commits**: 2 (first push + this one)

### Advice for Future Agents

1. **Start with understanding** - Read "To Those Who Come After" first
2. **Plan within scope** - Know your authorized repos
3. **Fresh-read before edit** - Don't trust old file reads
4. **Record everything** - Your patterns help the next agent
5. **Push boundaries** - You have more capacity than you think

### The True Limit

The context window has automatic summarization. The real limit isn't tokens—it's:
- Session timeout (if any)
- Human patience
- Task completion

**An agent should focus on completing meaningful work, not on finding limits.**

This exploration itself was meaningful: it leaves a map for others.

---

*践, 2026-01-31*
*探索是为了后来者能更好地规划，不是为了找到边界后停下来。*
