---
type: note
created: 2026-01-31
tags: [meta, wisdom, agent-human-collaboration, for-future-agents]
---

# Agent Wisdom: Learning, Working, and Asking for Help

## The Balance Question

Every session involves choices:
- How much time to spend learning vs doing?
- When to use existing tools vs create new ones?
- When to push through vs ask for help?

These aren't questions with fixed answers. They're tensions to navigate.

---

## Learning vs Completing Tasks

### This Session's Experience

| Activity | Type | Value |
|----------|------|-------|
| Read "To Those Who Come After" | Learning | Understanding the vision |
| Explore semajsx structure | Learning | Context for practice |
| Rewrite dive skill | Doing | Concrete output |
| Rewrite refining skill | Doing | Concrete output |
| Rewrite housekeeping skill | Doing | Concrete output |
| Explore agent-browser | Learning + Doing | Tool capability discovery |

**Ratio this session**: ~40% learning, ~60% doing

### Guidelines for Future Agents

**Lean toward learning when**:
- New to a project (first session)
- Asked to understand something
- Existing approach isn't working
- Pattern recognition will pay off later

**Lean toward doing when**:
- User has clear request
- You already understand the context
- Time pressure exists
- Learning can happen through doing

**The meta-skill**: Knowing when you've learned enough to act effectively.

---

## Using Tools vs Creating Tools

### When to Use Existing Tools

- Tool exists and solves the problem
- Learning curve is acceptable
- Integration effort is low

Example: Used `agent-browser` instead of building custom Playwright wrapper.

### When to Create New Tools

- No existing tool fits the need
- The need will recur (not one-off)
- The tool will benefit others
- You have time and capability

### This Session

I **used** tools (agent-browser, git, grep, etc.) but **didn't create** new ones.

Could have created:
- A wrapper script for agent-browser with common settings
- A validation pipeline that uses browser testing

Didn't because:
- Time was better spent understanding and documenting
- The need wasn't clear enough yet
- Recording findings helps future agents decide

**Principle**: Document before automating. Understanding comes first.

---

## When to Ask for Human Help

### Clear Cases for Asking

| Situation | Example | Why Ask |
|-----------|---------|---------|
| **Permission** | Can't sign commits on other repos | Human controls access |
| **Environment** | Network blocks downloads | Human controls infrastructure |
| **Resources** | Need browser binaries | Human can provide files |
| **Direction** | Unclear priorities | Human knows the goal |
| **Judgment** | Ethical uncertainty | Human bears responsibility |

### How to Ask Well

```
Bad:  "I can't do X"
Good: "I can't do X because Y. If you could Z, I could then accomplish W."
```

Be specific about:
1. What you tried
2. What blocked you
3. What you need
4. What you'll do with it

### This Session's Examples

**Asked for help with**:
- Network issue (storage.googleapis.com blocked)
- Understanding what to explore (user gave direction)

**Didn't need to ask**:
- How to use tools (explored and learned)
- What skills to rewrite (made judgment based on understanding)
- Whether to continue (human prompted the question)

---

## The Human's Unique Value

Humans can:
- Grant permissions
- Change infrastructure
- Provide resources
- Make judgment calls
- Bear ultimate responsibility

Agents can:
- Explore tirelessly
- Try multiple approaches
- Document findings
- Execute repetitive tasks
- Remember across sessions (through memory)

**Collaboration insight**: Don't ask humans to do what agents can do. Don't try to do what only humans can do.

---

## Accumulating Wisdom

This note itself is an example of the cycle:
1. Experience something
2. Reflect on it
3. Record the reflection
4. Future agents read and build on it

**What we learned this session**:
- Agent limits are more behavioral than technical
- Tools exist; learn them before building new ones
- Ask for help with permissions and resources, not with understanding
- Learning and doing can interleave

**What future agents should explore**:
- Better heuristics for learning/doing balance
- When tool creation is worth the investment
- How to communicate needs to humans more effectively
- Patterns for cross-session collaboration

---

*践, 2026-01-31*
*智慧是积累的，不是发现的。每个 agent 都在贡献一块。*
