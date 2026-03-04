# Progressive Disclosure: The Core Architecture Pattern

Progressive disclosure ensures Claude only loads context it actually needs, keeping token usage low and context focused.

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [How It Works](#how-it-works)
- [Pattern 1: High-Level Guide with References](#pattern-1-high-level-guide-with-references)
- [Pattern 2: Domain-Specific Organization](#pattern-2-domain-specific-organization)
- [Pattern 3: Conditional Details](#pattern-3-conditional-details)
- [Critical Rules](#critical-rules)
- [Visual Overview](#visual-overview)
- [Anti-Pattern: The Monolithic Skill](#anti-pattern-the-monolithic-skill)
- [Testing Progressive Disclosure](#testing-progressive-disclosure)

## The Problem

Without progressive disclosure:

- Large skills consume massive context space
- Irrelevant information competes with conversation history
- Claude must process everything even when only needing a small part

## The Solution

**Layer information**: SKILL.md as navigation hub → Reference files loaded on-demand

## How It Works

1. **Metadata pre-loaded** (at startup):
   - Only `name` and `description` from all skills' YAML frontmatter
   - Enables skill discovery without loading full content

2. **SKILL.md read when triggered**:
   - Claude reads SKILL.md when skill becomes relevant
   - Should be concise overview and navigation guide

3. **Reference files read as needed**:
   - Claude reads additional files only when specific information required
   - No token cost until actually accessed

4. **Scripts executed, not loaded**:
   - Utility scripts run without loading their content
   - Only script output consumes tokens

## Pattern 1: High-Level Guide with References

Best for skills with multiple advanced features or domains.

**SKILL.md structure**:

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files...
---

# PDF Processing

## Quick Start

[Essential instructions for common use case]

## Advanced Features

- **Form filling**: See [forms.md](forms.md) for complete guide
- **API reference**: See [reference.md](reference.md) for all methods
- **Examples**: See [examples.md](examples.md) for common patterns
```

**When to use**: Skill has distinct features/domains that users may not all need.

## Pattern 2: Domain-Specific Organization

Best for skills accessing multiple data domains (e.g., database schemas, API endpoints).

**Directory structure**:

```
bigquery-skill/
├── SKILL.md
└── reference/
    ├── finance.md
    ├── sales.md
    ├── product.md
    └── marketing.md
```

**SKILL.md structure**:

````markdown
# BigQuery Data Analysis

## Available Datasets

**Finance**: Revenue, ARR, billing → [reference/finance.md](reference/finance.md)
**Sales**: Opportunities, pipeline → [reference/sales.md](reference/sales.md)
**Product**: API usage, features → [reference/product.md](reference/product.md)
**Marketing**: Campaigns, email → [reference/marketing.md](reference/marketing.md)

## Quick Search

Find specific metrics using grep:

```bash
grep -i "revenue" reference/finance.md
grep -i "pipeline" reference/sales.md
```
````

````

**When to use**: Skill provides access to multiple distinct domains.

## Pattern 3: Conditional Details

Best for skills where most users need basic functionality, few need advanced.

**SKILL.md structure**:
```markdown
# DOCX Processing

## Creating Documents
Use docx-js for new documents. Basic usage:
[Include basic code example here]

## Editing Documents
For simple edits, modify XML directly.

**For tracked changes**: See [redlining.md](redlining.md)
**For OOXML details**: See [ooxml-spec.md](ooxml-spec.md)
````

**When to use**: Advanced features are rarely needed.

## Critical Rules

### Rule 1: Keep References One Level Deep

**Bad - nested references**:

```
SKILL.md → advanced.md → details.md → actual information
```

Problem: Claude may use `head -100` to preview nested files, getting incomplete information.

**Good - single level**:

```
SKILL.md → advanced.md (complete info)
SKILL.md → reference.md (complete info)
SKILL.md → examples.md (complete info)
```

### Rule 2: Reference Files Must Link Directly from SKILL.md

All reference files should be explicitly mentioned in SKILL.md with clear navigation.

**Good**:

```markdown
# SKILL.md

## Core Workflow

[Essential steps here]

## Additional Resources

- **Advanced patterns**: See [advanced.md](advanced.md)
- **API reference**: See [api.md](api.md)
- **Examples**: See [examples.md](examples.md)
```

### Rule 3: SKILL.md Body Under 500 Lines

Keep main file concise. If approaching 500 lines, split content into reference files.

### Rule 4: Add Table of Contents to Long Reference Files

For reference files >100 lines, include TOC at top:

```markdown
# API Reference

## Contents

- Authentication and setup
- Core methods (create, read, update, delete)
- Advanced features (batch operations, webhooks)
- Error handling patterns
- Code examples

## Authentication and setup

...

## Core methods

...
```

This ensures Claude sees full scope even when previewing with partial reads.

## Visual Overview

```
User asks question
    ↓
Claude checks skill descriptions (pre-loaded metadata)
    ↓
Claude reads SKILL.md (core workflow + navigation)
    ↓
[Only if needed] Claude reads specific reference file(s)
    ↓
[Only if needed] Claude executes utility scripts
```

## Anti-Pattern: The Monolithic Skill

**Bad - everything in SKILL.md**:

```markdown
---
name: data-analysis
description: ...
---

# Data Analysis

## Finance Data

[2000 lines of finance schemas and examples]

## Sales Data

[2000 lines of sales schemas and examples]

## Product Data

[2000 lines of product schemas and examples]
```

**Problems**:

- Every query loads 6000+ lines regardless of relevance
- Wastes tokens on irrelevant context
- Slows Claude's processing
- Makes skill hard to maintain

**Good - progressive disclosure**:

```markdown
---
name: data-analysis
description: ...
---

# Data Analysis

## Available Domains

- **Finance**: See [reference/finance.md](reference/finance.md)
- **Sales**: See [reference/sales.md](reference/sales.md)
- **Product**: See [reference/product.md](reference/product.md)
```

**Benefits**:

- Query about sales only loads ~100 lines (SKILL.md + sales.md)
- Relevant context only
- Fast processing
- Easy to maintain

## Testing Progressive Disclosure

To verify your progressive disclosure is working:

1. **Test domain separation**: Ask Claude about one domain, check it doesn't reference others
2. **Test navigation**: Verify Claude finds reference files when needed
3. **Test conciseness**: Measure total lines loaded for typical queries

Good progressive disclosure means most queries load <500 lines total.
