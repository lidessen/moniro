# Understanding Anti-Patterns

Rather than memorizing a list of "don't do this" rules, understand _why_ certain patterns fail. Each anti-pattern violates one or more of the three core principles: Progressive Disclosure, Respect Intelligence, or Enable Discovery.

When you understand the underlying reasons, you can make good decisions in novel situations.

## How to Use This Guide

For each anti-pattern, we explain:

1. **Why it's problematic** - The underlying issue
2. **Which principle it violates** - Connection to core concepts
3. **Real impact** - Concrete consequences
4. **The fix** - How the correct approach embodies the principles

## Table of Contents

1. [Windows-Style Paths](#1-windows-style-paths)
2. [Deeply Nested References](#2-deeply-nested-references)
3. [Time-Sensitive Information](#3-time-sensitive-information)
4. [Inconsistent Terminology](#4-inconsistent-terminology)
5. [Offering Too Many Options](#5-offering-too-many-options)
6. [Vague Skill Names](#6-vague-skill-names)
7. [First or Second Person Descriptions](#7-first-or-second-person-descriptions)
8. [SKILL.md Over 500 Lines](#8-skillmd-over-500-lines)
9. [Vague Descriptions Without Triggers](#9-vague-descriptions-without-triggers)
10. [Over-Explaining Basics](#10-over-explaining-basics)
11. [No Examples for Format-Specific Tasks](#11-no-examples-for-format-specific-tasks)
12. [Missing Error Handling](#12-missing-error-handling)
13. [Template Too Complex](#13-template-too-complex)
14. [Wrong Directory](#14-wrong-directory)
15. [Vague Workflow Steps](#15-vague-workflow-steps)
16. [No Verification Before Critical Ops](#16-no-verification-before-critical-ops)
17. [Mixed Naming Patterns](#17-mixed-naming-patterns)
18. [Relative Paths to Other Skills](#18-relative-paths-to-other-skills)
19. [Missing Boundary Guidance](#19-missing-boundary-guidance)

- [Quick Reference Checklist](#quick-reference-checklist)

## 1. Windows-Style Paths

**Bad**: `reference\guide.md`, `scripts\helper.py`
**Good**: `reference/guide.md`, `scripts/helper.py`

### Why It's Problematic

When you use backslashes, Claude's file reading logic must handle both slash styles. This creates ambiguity: Is `scripts\helper.py` a Windows path or an escape sequence? The parser must make assumptions, adding mental overhead.

### Violates: Respect Intelligence

Forces Claude to spend cognitive effort on path interpretation instead of actual work. It's a small tax, but unnecessary friction multiplied across many files.

### Real Impact

- Increased parsing complexity
- Potential file reading errors on Unix systems
- Inconsistency across team members using different OSes

### The Fix

Always use forward slashes. They work on all platforms (including Windows), eliminating ambiguity entirely.

---

## 2. Deeply Nested References

**Bad - Too Deep**:

```markdown
# SKILL.md

See [advanced.md](advanced.md) for details...

# advanced.md

See [implementation.md](implementation.md) for specifics...

# implementation.md

Here's the actual information you need...
```

**Good - One Level Deep**:

```markdown
# SKILL.md

**Basic usage**: [instructions in SKILL.md]
**Advanced features**: See [advanced.md](advanced.md)
**API reference**: See [reference.md](reference.md)
**Examples**: See [examples.md](examples.md)
```

### Why It's Problematic

When Claude encounters a reference file that itself contains references, it may use `head -100` to preview the file's structure before deciding whether to read it fully. With nested references, the preview shows only navigation links—not the actual content. Claude must then make another read, potentially partial again, creating a game of "follow the breadcrumbs" that wastes API calls and may still miss information.

### Violates: Progressive Disclosure

The goal of progressive disclosure is to load information _when needed_, not to create a maze. Nesting defeats the purpose by requiring multiple hops to reach actual content.

### Real Impact

- Claude sees "See implementation.md for details" in preview, makes another partial read
- Multiple API round-trips to find information
- Risk of incomplete information if preview limits kick in
- Frustrating user experience as Claude says "I need to read more files"

### The Fix

All reference files should link directly from SKILL.md. If advanced.md contains implementation details, put those details IN advanced.md, not in yet another file. Think of SKILL.md as a table of contents—every chapter (reference file) should be one click away.

---

## 3. Time-Sensitive Information

### Problem

Time-based instructions become wrong after the date passes.

**Bad - Will Become Wrong**:

```markdown
If you're doing this before August 2025, use the old API.
After August 2025, use the new API.
```

**Good - Use "Old Patterns" Section**:

```markdown
## Current Method

Use the v2 API endpoint: `api.example.com/v2/messages`

## Old Patterns

<details>
<summary>Legacy v1 API (deprecated 2025-08)</summary>

The v1 API used: `api.example.com/v1/messages`

This endpoint is no longer supported.

</details>
```

**Why**: Instructions with specific dates become incorrect and misleading over time.

**Rule**: Use "current" and "legacy/old patterns" sections instead of date-based conditionals.

---

## 4. Inconsistent Terminology

**Bad**: Mixing "API endpoint", "URL", "route"  
**Good**: Choose one term, use consistently  
**Rule**: Pick one from each group:

- "API endpoint" / "URL" / "route" / "path"
- "field" / "box" / "element" / "control"
- "extract" / "pull" / "get" / "retrieve"

---

## 5. Offering Too Many Options

**Bad**: "You can use pypdf, pdfplumber, PyMuPDF, pdf2image, camelot, tabula..."  
**Good**: Provide one default + specific condition for alternative  
**Rule**: Default approach with escape hatch only.

---

## 6. Vague Skill Names

**Bad**: `helper`, `utils`, `tools`, `documents`, `data`  
**Good**: `processing-pdfs`, `analyzing-spreadsheets`, `managing-databases`  
**Rule**: Use gerund form (verb + -ing).

---

## 7. First or Second Person Descriptions

**Bad**: "I can help...", "You can use..."  
**Good**: "Processes files...", "Analyzes data..."  
**Rule**: Always third person (descriptions injected into system prompt).

---

## 8. SKILL.md Over 500 Lines

**Bad - Monolithic**:

```markdown
---
name: data-analysis
---

# Data Analysis

## Finance Data

[2000 lines of schemas and examples]

## Sales Data

[2000 lines of schemas and examples]

## Product Data

[2000 lines of schemas and examples]
```

**Good - Progressive Disclosure**:

```markdown
---
name: data-analysis
---

# Data Analysis

## Available Domains

- **Finance**: See [reference/finance.md](reference/finance.md)
- **Sales**: See [reference/sales.md](reference/sales.md)
- **Product**: See [reference/product.md](reference/product.md)
```

### Why It's Problematic

When this skill triggers, Claude loads all 6000+ lines into context immediately—whether the user asks about finance, sales, or product data. A finance query doesn't need sales schemas. A basic question doesn't need advanced edge cases. But with everything in one file, Claude has no choice.

### Violates: Progressive Disclosure

This is the canonical violation. The entire point of progressive disclosure is "load only what's needed." A monolithic SKILL.md forces loading of _everything_.

### Real Impact

- Finance query wastes ~4000 tokens on irrelevant sales/product data
- Slower processing (more content to parse)
- Higher costs (more tokens per request)
- Less room for actual conversation history
- Harder to maintain (one massive file vs. focused modules)

### The Fix

Keep SKILL.md as a lean navigation hub (~500 lines). Put detailed content in reference files. When Claude needs finance data, it reads SKILL.md (~100 lines) + finance.md (~500 lines) = 600 tokens instead of 6000. That's 10x more efficient.

---

## 9. Vague Descriptions Without Triggers

**Bad - No Triggers**:

```yaml
description: Helps with documents and data processing
```

**Good - Specific Triggers**:

```yaml
description: Extract text from PDF and Word documents, convert between formats. Use when processing PDFs, .docx files, or document conversion.
```

### Why It's Problematic

Claude has potentially 100+ skills available. When a user asks "Can you extract text from this PDF?", Claude scans all skill descriptions looking for matches. "Helps with documents" matches weakly—lots of skills could "help with documents." But "Extract text from PDF" with trigger terms "PDF, .docx, extraction" creates a strong, obvious match.

### Violates: Enable Discovery

A vague description makes your skill invisible. You've done the work to create it, but Claude can't find it when needed because the description doesn't contain the words users actually say.

### Real Impact

- Skill doesn't trigger when it should
- User gets worse results (Claude tries to solve without your skill)
- Wasted effort creating a skill that's never used
- Duplicate effort (someone creates the same skill again with better description)

### The Fix

Include specific trigger terms: file types (.pdf, .docx), technology names (PostgreSQL, React), activity phrases ("code review", "commit message"), domain terms ("database schema", "API endpoint"). Think about what words users say when they need this skill, then put those words in the description.

---

## 10. Over-Explaining Basics

**Bad**:

```markdown
## Working with PDFs

PDF stands for Portable Document Format. It's a file format developed by
Adobe in 1992. PDFs can contain text, images, and interactive elements.
To work with PDFs in Python, you'll need to install a library. There are
several options available...
```

**Good**:

````markdown
## Extract PDF Text

Use pdfplumber:
\```python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
text = pdf.pages[0].extract_text()
\```
````

### Why It's Problematic

Claude already knows what PDFs are, how Python imports work, that packages need installation. Explaining these basics wastes precious context tokens on information that provides zero value. It's like explaining what a function is to an experienced programmer—patronizing and inefficient.

### Violates: Respect Intelligence

This is the canonical violation. You're assuming Claude doesn't know common concepts, wasting tokens that could be used for your domain-specific knowledge.

### Real Impact

- Wasted tokens (example above: ~150 tokens vs. ~30 tokens = 5x waste)
- Slower processing (more content to parse)
- Less room for actual useful content
- Signal-to-noise ratio decreases (harder to find key information)
- Accumulated waste (if every section over-explains, a 500-line skill becomes 2500 lines)

### The Fix

Assume Claude knows: file formats, programming concepts, standard tools, common patterns, industry terminology. Only explain: your specific schemas, your team's standards, your custom workflows, your business rules, your internal tools. Get straight to code, commands, and domain-specific facts.

---

## 11. No Examples for Format-Specific Tasks

**Bad**: "Write in conventional format with type, scope, description"  
**Good**: 2-3 concrete examples showing exact format  
**Rule**: Show, don't just describe format.

---

## 12. Missing Error Handling

**Bad**: Steps with no failure path  
**Good**: Include "If step fails: check X, fix Y, return to step Z"  
**Rule**: Add error handling for critical operations.

---

## 13. Template Too Complex

**Bad**: Over-specified (exact word counts, rigid patterns)  
**Good**: Simple placeholders + examples  
**Rule**: Keep templates simple, use examples for details.

---

## 14. Wrong Directory

**Bad**: `~/.cursor/skills-cursor/` (reserved for built-ins)  
**Good**: `~/.cursor/skills/` (personal) or `.cursor/skills/` (project)  
**Rule**: Never create in `skills-cursor/`.

---

## 15. Vague Workflow Steps

**Bad**: "Prepare data", "Process everything", "Generate output"  
**Good**: "Load from X", "Clean by doing Y", "Export to Z"  
**Rule**: Each step = what + how.

---

## 16. No Verification Before Critical Ops

**Bad**: Make changes → Deploy production  
**Good**: Changes → Test → Stage → Verify → Production  
**Rule**: Add verification gates before destructive operations.

---

## 17. Mixed Naming Patterns

**Bad**: Mixing gerund, noun, verb forms
**Good**: All gerund (processing-pdfs, analyzing-excel) OR all noun
**Rule**: Pick one pattern, use consistently.

---

## 18. Relative Paths to Other Skills

**Bad**:

```markdown
For cleanup tasks, use [housekeeping](../housekeeping/SKILL.md).
```

**Good**:

```markdown
For cleanup tasks, use `housekeeping`.
```

### Why It's Problematic

Skills can be installed independently via `npx skills add repo/skills`. When a user installs only one skill, relative paths like `../other-skill/SKILL.md` break because the referenced skill doesn't exist in their installation.

### Violates: Enable Discovery

Broken links frustrate users and break the skill discovery mechanism. The skill name alone is sufficient—the system resolves skill references automatically.

### Real Impact

- Broken links when skills installed separately
- Confusing error messages
- Users can't follow suggested skill references
- Defeats the purpose of modular skill installation

### The Fix

Reference other skills by name only using inline code format: `` `skill-name` ``. The system handles resolution. This works whether skills are installed together or separately.

---

## 19. Missing Boundary Guidance

**Bad**: Related skills with overlapping domains, no guidance on which to use

**Good**:

```markdown
# engineering

**Not this skill**: For cleanup tasks, use `housekeeping`.

# housekeeping

**Not this skill**: For technical decisions, use `engineering`.
```

### Why It's Problematic

When multiple skills could potentially handle a request, Claude must guess which one is more appropriate. Without explicit boundary guidance, the wrong skill may trigger, or Claude may hesitate between options. Clear boundaries help both Claude and users.

### Violates: Enable Discovery

Discovery isn't just about finding _a_ skill—it's about finding the _right_ skill. Boundary guidance is part of discovery, telling Claude when NOT to use this skill.

### Real Impact

- Wrong skill triggered for task
- User gets suboptimal guidance
- Inconsistent behavior across sessions
- Skill creators duplicate effort

### The Fix

Add "Not this skill" guidance at the top of SKILL.md for skills with related domains. Make boundaries bidirectional—if A points to B, B should point back to A. Use skill names (not paths) for the reference.

---

## Quick Reference: Principle-Based Review

Before finalizing a skill, ask these questions:

### Progressive Disclosure

- [ ] Will this skill load only what's needed for common queries?
- [ ] Is SKILL.md under 500 lines (navigation hub, not content dump)?
- [ ] Are all references one level deep (no nested mazes)?
- [ ] Have I moved detailed content to reference files?

### Respect Intelligence

- [ ] Am I explaining things Claude already knows?
- [ ] Could I cut this by 50% without losing essential information?
- [ ] Am I using code/commands instead of tutorials?
- [ ] Is every sentence earning its token cost?

### Enable Discovery

- [ ] Does the description include specific trigger terms?
- [ ] Is it third person (for system prompt injection)?
- [ ] Would Claude pick this skill for the right tasks?
- [ ] Does the name clearly indicate purpose?

### Technical Constraints

- [ ] Forward slashes in all paths? (cross-platform)
- [ ] Name follows format? (lowercase-with-hyphens, max 64 chars)
- [ ] Description under 1024 chars?
- [ ] Consistent terminology throughout?
- [ ] No time-sensitive information?

If any answer is "no", revisit the relevant anti-pattern section to understand why it matters.
