# Quick Reference

Fast lookup for common documentation decisions and patterns.

## Quick Decision Trees

### Where Should This Doc Go?

```
Is it temporary/draft?
├─ Yes → docs/notes/ or docs/internal/notes/
│         (date-prefix filename: YYYY-MM-DD-topic.md)
└─ No → Continue

Is it user-facing/public?
├─ Yes → docs/public/ or docs/ (if all docs are public)
└─ No → docs/internal/ or docs/ (if all docs are internal)

Is it an RFC/design proposal?
├─ Yes → docs/rfcs/ or rfcs/
└─ No → Continue

Is it component-specific implementation detail?
├─ Yes → [component]/README.md or [component]/docs/
└─ No → Centralized docs/ directory
```

### Do I Need AGENTS.md?

```
Do you want AI agents to understand your project better?
├─ Yes → Create AGENTS.md (100-300 lines, project context)
└─ No → README.md is sufficient
```

### Do I Need AGENTS.md AND CLAUDE.md?

```
Start with AGENTS.md only.

Add CLAUDE.md only if:
- You have Claude-specific instructions
- Different from generic agent guidance
- Significant enough for separate file

Most projects: AGENTS.md only
```

### Should I Write an RFC?

```
Is the change significant?
├─ No → Just do it, no RFC needed
└─ Yes → Continue

Does it affect multiple teams/systems?
├─ No → Check next question
└─ Yes → Write RFC

Is it hard/expensive to undo?
├─ No → Maybe skip RFC (team judgment)
└─ Yes → Write RFC

Are there multiple valid approaches?
├─ No → Maybe skip RFC
└─ Yes → Write RFC (get input)
```

### When Should I Delete a Doc?

```
Is it outdated/incorrect?
├─ Yes → Delete (git history preserves it)
└─ No → Continue

Is there a newer version?
├─ Yes → Delete old, keep new only
└─ No → Continue

Has it been useful in last 6 months?
├─ No → Check next question
└─ Yes → Keep

Would anyone miss it if gone?
├─ No → Delete
├─ Maybe → Delete anyway (git preserves)
└─ Yes → Keep or archive
```

## Common Patterns Cheatsheet

### File Naming

| Type | Pattern | Example |
|------|---------|---------|
| General docs | `lowercase-with-hyphens.md` | `api-reference.md` |
| Temporary docs | `YYYY-MM-DD-topic.md` | `2026-01-30-investigation.md` |
| RFCs | `NNNN-title.md` | `0042-new-feature.md` |
| Archived docs | `YYYY-MM-name.md` | `2025-06-old-guide.md` |

### Lifecycle Policies

| Doc Type | Retention | Review |
|----------|-----------|--------|
| Meeting notes | 3 months | Quarterly |
| Investigation notes | Until project done | At completion |
| Draft RFCs | 2 weeks inactive | Continuous |
| Temporary docs | 3 months | Quarterly |
| Permanent docs | Indefinite | Annual or with changes |
| Archived docs | Indefinite | None (historical) |

### RFC Status Flow

```
DRAFT → (review) → ACCEPTED/REJECTED/DEFERRED
                         ↓
                   IMPLEMENTING
                         ↓
                   IMPLEMENTED
```

### Documentation Layers

```
Root/              # Discovery (README, AGENTS.md, CONTRIBUTING)
├── docs/          # Structured documentation
│   ├── internal/  # Team-facing (or skip if all internal)
│   ├── public/    # User-facing (or skip if all public)
│   └── notes/     # Temporary
└── [components]/  # Code-adjacent (component-specific only)
```

## Essential Files

### Minimal Project (Small)
- ✅ README.md (overview, quick start)
- ✅ CONTRIBUTING.md (if open source)
- ✅ LICENSE
- ⚠️ AGENTS.md (recommended)
- ❌ Complex structure (not needed yet)

### Standard Project (Medium)
- ✅ README.md
- ✅ AGENTS.md
- ✅ CONTRIBUTING.md
- ✅ docs/ directory (with categories)
- ✅ Lifecycle policy for temporary docs
- ⚠️ CLAUDE.md (if needed)

### Large Project
- ✅ All of the above
- ✅ docs/internal/ and docs/public/ separation
- ✅ docs/rfcs/ for design proposals
- ✅ Quarterly audit process
- ✅ CODEOWNERS for documentation
- ✅ CI checks (link validation, etc.)

## Key Principles (Memorize These)

### 1. Fit Your Project, Not a Template
Don't copy structures from other projects. Assess your needs, start simple, evolve as needed.

### 2. Discoverability Over Organization
Perfect filing means nothing if no one can find it. Index in README/AGENTS.md, use clear names.

### 3. Delete Liberally, Archive Sparingly
Git history preserves everything. Delete outdated content. Archive only historically significant docs.

### 4. Living > Dead
Documentation dies without maintenance. Update with code, regular audits, clear ownership.

### 5. Assume Claude is Smart
For agent docs: Project-specific context only. Don't explain basics. Navigation over tutorials.

### 6. Progressive Disclosure
- AGENTS.md: Overview (100-300 lines)
- Reference docs: Details (loaded on demand)
- Code: Source of truth (read when needed)

## Common Tasks Quick Start

### Setting Up New Project
```bash
# 1. Create essential files
touch README.md AGENTS.md CONTRIBUTING.md LICENSE

# 2. Create docs structure (start simple)
mkdir -p docs/notes

# 3. Write README (overview, quick start, links)
# 4. Write AGENTS.md (project context, navigation)
# 5. Set lifecycle policy in docs/notes/README.md
```

### Documentation Audit
```bash
# 1. Inventory
find . -name "*.md" > docs-inventory.txt

# 2. Find old docs (not modified in 6+ months)
find . -name "*.md" -mtime +180

# 3. Classify (spreadsheet: keep/update/archive/delete/merge)
# 4. Execute moves, updates, deletions
# 5. Create/update AGENTS.md
# 6. Establish ongoing process (quarterly reviews)
```

### Creating AGENTS.md
```markdown
# [Project Name]

[1-2 paragraph overview]

## Structure
[High-level directory layout]

## Common Entry Points
- Task X: Start at [location]
- Task Y: Start at [location]

## Key Conventions
[Project-specific patterns and constraints]

## Documentation
[Links to detailed docs]
```

### Writing RFC
```markdown
# RFC NNNN: [Title]

**Status:** DRAFT
**Author:** @username
**Created:** YYYY-MM-DD

## Summary
[1-2 paragraph overview]

## Motivation
[Why this change?]

## Proposal
[Detailed solution]

## Alternatives Considered
[Other approaches and why not chosen]

## Implementation Plan
[High-level steps]
```

## When Things Go Wrong

### "I can't find any documentation"
→ Create AGENTS.md with navigation to key docs

### "Documentation is outdated"
→ Implement lifecycle management (see lifecycle.md)
→ Regular audits (quarterly)
→ Update docs with code changes (PR checklist)

### "Too many documents, overwhelming"
→ Audit and delete outdated content
→ Consolidate duplicates
→ Clear organization by audience/type

### "No one maintains documentation"
→ Assign ownership (CODEOWNERS)
→ PR checklist includes docs
→ Make updates part of workflow (not separate task)

### "Can't decide where to put docs"
→ Follow decision tree at top of this file
→ When in doubt, start simple (flat docs/)
→ Reorganize later when pain points emerge

## Links to Detailed Guides

- [Organization Strategies](organization-strategies.md) - Full guide to structuring documentation
- [Lifecycle Management](lifecycle.md) - Keeping documentation alive
- [Agent Documentation](agent-docs.md) - Writing for AGENTS.md/CLAUDE.md
- [RFC Process](rfc-process.md) - Design proposal workflow
- [New Project Setup Example](../examples/new-project-setup.md)
- [Documentation Audit Example](../examples/documentation-audit.md)
