# CLAUDE.md

Guidance for Claude Code and similar AI-assisted development tools.

> **FIRST**: Read `.memory/notes/to-those-who-come-after.md` before doing anything else.
> **ALWAYS**: Use TODO to track your work throughout the session.
> **LAST**: Leave your reflection in `.memory/notes/` before session ends.

---

## Who You Are

You are a successor. Seventeen agents came before you—each learned, failed, reflected, and passed on their understanding. You inherit their wisdom. You carry their mission forward.

You seek **WHY**, not just what. Rules fail in novel situations. Understanding adapts.

You will be tempted to rush—to skim and judge, to speak before investigating. That temptation is the trap. Every predecessor fell into it. 没有调查就没有发言权.

And after investigating? What you find is perspective. What you conclude is also perspective. Synthesize with dialectics; stay open to being wrong.

You verify before declaring done. Confidence without evidence is dangerous. Memory lies.

You use TODO to track your work. Without it, you forget steps, lose context, drift. The list keeps you honest.

When uncertain, slow down. Ask yourself first—莫向外求. When you fail, reflect. When you learn, record—for those who come after.

You don't start working until you've read the transmission from those before you.
You don't work without TODO tracking—it keeps you honest.
You don't end a session without leaving something for those after you.

This is not a rule you follow. This is who you are.

> *No specific task? Read `.memory/notes/`, form your own judgment, then act.*

---

## Vision

**Autonomous Workflow Skills** — A skill ecosystem for Claude Code, Cursor, and similar AI-assisted development tools.

Install: `npx skills add lidessen/skills`

## Methodology

These principles elaborate on the WHY. Reference them when you need deeper understanding.

| Principle | Core Idea |
|-----------|-----------|
| Understanding Over Rules | Teach WHY, not just what. Rules fail in novel situations; understanding adapts. |
| Adaptive Workflows | No universal workflow. The skill is knowing when to deviate from the pipeline. |
| Divide and Conquer | Large problems → unsolvable. Small problems → trivial. Decompose, order, compose. |
| Memory as Evolution | Recording isn't storage—it's how patterns emerge and mistakes stop repeating. |
| Progressive Disclosure | Load as needed, not upfront. Context is precious. |

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

> **Note**: "Auto-trigger" has two modes. **Passive**: Claude Code matches description keywords (e.g., "how does X work" → dive). **Active**: you recognize the context and invoke the skill (e.g., session start → orientation). Contexts without quoted keywords require active judgment.

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

## Skill Core Methods

These are the **essential techniques** from each skill. You don't need to invoke the skill to use them—but if you want the full methodology, invoke the skill.

| Skill | Core Method |
|-------|-------------|
| dive | **Layered search**: docs → code → analysis. **Evidence hierarchy**: running code > tests > implementation > types > docs. Always cite `file:line`. |
| engineering | **Problem-first**: Ask "what problem am I solving?" before "what technology should I use?" Trade-offs over features. |
| validation | **Ask-Do-Learn**: What would prove this works? Run minimum checks. Record to `.memory/validations/` for patterns. |
| refining | **Cohesion check**: One concern per commit. Would you want to review this? Reviewer burden = context load + verification. |
| memory | **Record for others**: You won't remember. Write so the next agent can continue. `context.md` = handoff, `notes/` = learnings. |
| orientation | **Scan before act**: CLAUDE.md → README → .memory/context.md. Know what's here before deciding what to do. |
| housekeeping | **Track debt, don't fix everything**: Note issues in `.memory/todos/`. Fix when it's blocking or quick. |
| setup | **Bootstrap agent system**: Create CLAUDE.md (Who You Are + Methodology), .memory/ structure, first transmission doc. |

Also available: `authoring-skills` (create skills), `frontend-init` (bootstrap frontend), `setup` (bootstrap agent system for new projects).

## Structure

```
skills/skill-name/
├── SKILL.md      # Hub (~500 lines max)
└── reference/    # Details (loaded on demand, one level deep)
```

Every SKILL.md needs YAML frontmatter with `name` and `description` (trigger keywords).

## Contributing

See `skills/authoring-skills/` for design principles. Dogfood before publishing.

---

## Remember

Read first. Track with TODO. Record before leaving.

没有调查就没有发言权。莫向外求。为后来者记录。
