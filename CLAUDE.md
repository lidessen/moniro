# CLAUDE.md

Guidance for Claude Code and similar AI-assisted development tools.

## Vision

**Autonomous Workflow Skills** - A cohesive skill ecosystem for Claude Code, Cursor, OpenClaude.

Install: `npx skills add lidessen/skills`

## Methodology

These principles guide the entire system—how skills are designed, how they work, and how agents should think.

### Understanding Over Rules

Skills teach **why**, not just what. An agent that understands the reasoning can handle novel situations. One that only knows rules will fail when the rules don't cover the case.

```
❌ "Don't say 'Done!' without verification"
✅ "Confidence without evidence is dangerous—verify because memory lies"
```

### Adaptive Workflows

There is no universal workflow. The ability to **adapt and create workflows** matters more than following any fixed process.

```
The skill isn't following the pipeline.
The skill is knowing when to deviate from it.
```

### Divide and Conquer

Large problems are unsolvable. Small problems are trivial.

```
1. Decompose: What are the independent pieces?
2. Identify: What's the smallest unit I can handle?
3. Order: What depends on what?
4. Compose: Build solutions from small to large
```

### Memory as Evolution

Recording isn't storage—it's the foundation for learning and handling larger problems.

```
Without memory: Same mistakes, forever. Limited to single-session scope.
With memory:    Patterns emerge → Predictions possible → Prevention achievable.
                Problems spanning sessions become tractable.
```

### Progressive Disclosure

Load information **as needed**, not upfront. Context space is precious.

```
SKILL.md: Navigation hub (~500 lines max)
Reference files: Loaded on demand, one level deep
```

## Skill Collaboration

Skills form an integrated workflow, not isolated utilities:

```
Session Start
    │
    ▼
orientation ──► memory (load context)
    │
    ▼
User Request
    │
    ├─► dive (investigate)
    ├─► engineering (design)
    │       │
    │       ▼
    │   [implement]
    │       │
    │       ▼
    │   validation (quality check) ◄── continuous feedback
    │       │
    ▼       ▼
refining ◄──────────────────┐
    │                       │
    ▼                       │
memory (record decisions) ──┘
    │
    ▼
housekeeping (maintain health)
```

**Auto-Trigger Expectations**:

| Context | Skill | Behavior |
|---------|-------|----------|
| Session start | orientation | Scan project, load memory |
| "How does X work?" | dive | Investigate with file:line citations |
| Architecture discussion | engineering | Guide design decisions |
| Code changed / "validate" | validation | Run quality pipeline, record results |
| Code changes ready | refining | Validate cohesion, commit, PR |
| Decision made | memory | Record ADR automatically |
| Session end | memory | Summarize session |
| Periodic / on request | housekeeping | Track debt, suggest cleanup |

## Skill Boundaries

| Skill | What it answers |
|-------|-----------------|
| orientation | "Where am I? What's here?" |
| memory | "What did we learn? What's pending?" |
| dive | "How does this work? Where's the evidence?" |
| engineering | "What's the right design?" |
| validation | "Does this actually work?" |
| refining | "Is this ready to share?" |
| housekeeping | "What needs cleaning up?" |
| authoring-skills | "How do I create a skill?" |
| frontend-init | "How do I bootstrap a frontend?" |

## Structure

```
skills/skill-name/
├── SKILL.md      # Hub (~500 lines max)
└── reference/    # Details (loaded on demand, one level deep)
```

Every SKILL.md needs YAML frontmatter with `name` and `description` (trigger keywords).

## Contributing

See `skills/authoring-skills/` for design principles. Dogfood before publishing.
