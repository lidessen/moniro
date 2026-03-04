# Core Principles: Understanding the Philosophy

This document explains the _why_ behind skill design principles. Understanding the underlying philosophy helps you make good decisions in novel situations, rather than mechanically following rules.

## Table of Contents

- [The Fundamental Challenge](#the-fundamental-challenge)
- [The Three Principles](#the-three-principles)
  - [1. Progressive Disclosure: Load Only What's Needed](#1-progressive-disclosure-load-only-whats-needed)
  - [2. Respect Intelligence: Assume Claude Is Smart](#2-respect-intelligence-assume-claude-is-smart)
  - [3. Enable Discovery: Make Skills Findable](#3-enable-discovery-make-skills-findable)
- [The Meta-Principle: Understanding Over Rules](#the-meta-principle-understanding-over-rules)
- [Making Trade-offs](#making-trade-offs)
  - [Example 1: Inline Examples vs. Reference File](#example-1-inline-examples-vs-reference-file)
  - [Example 2: Detailed Instructions vs. Trust Claude](#example-2-detailed-instructions-vs-trust-claude)
  - [Example 3: Specific Triggers vs. Broad Applicability](#example-3-specific-triggers-vs-broad-applicability)
- [Conclusion: Judgment Over Compliance](#conclusion-judgment-over-compliance)

## The Fundamental Challenge

Agent skills exist to help Claude work better. But there's a tension:

**Adding skills consumes the same resource they're meant to preserve: context space.**

Every skill loaded into context is space that can't be used for:

- User conversation history
- Code being analyzed
- Output being generated
- Other relevant context

This creates a paradox: _The more comprehensive your skills, the less effectively Claude can use them._

Resolving this paradox is the purpose of these principles.

## The Three Principles

### 1. Progressive Disclosure: Load Only What's Needed

**Origin**: This principle comes from recognizing that skills trigger _before_ Claude knows exactly what it needs.

When a user says "analyze this finance data," the skill system triggers the data-analysis skill. At this point, Claude doesn't know:

- Which subdomain (finance vs. sales vs. product)
- Basic vs. advanced operations
- Which specific tables or metrics

If everything is in SKILL.md, Claude loads it all—including irrelevant content.

**The Philosophy**: Information should be layered by likelihood of use and dependency.

**Core tier** (SKILL.md):

- Always needed: Basic workflow, navigation
- Entry points to deeper content

**Reference tier** (separate files):

- Conditional needs: Domain-specific details
- Advanced features
- Comprehensive examples

**The Trade-off**: More files vs. larger context.

Some people resist creating multiple files: "It's easier to maintain one file!" This optimizes for the wrong thing—_author_ convenience over _runtime_ efficiency. A skill might be written once but executed thousands of times. Optimize for execution.

**When to violate**: If your skill is genuinely small (<200 lines) and all content is equally likely to be needed, one file is fine. Don't create artificial splits.

### 2. Respect Intelligence: Assume Claude Is Smart

**Origin**: This principle comes from the observation that Claude is trained on vast amounts of technical content.

Claude already understands:

- File formats (PDF, JSON, CSV, etc.)
- Programming concepts (functions, variables, loops)
- Standard tools (git, npm, docker)
- Common patterns (REST, CRUD, authentication)
- Industry terminology

What Claude _doesn't_ know:

- Your specific table schemas
- Your team's coding standards
- Your custom workflows
- Your business rules
- Your internal tools

**The Philosophy**: Use context space for signal, not noise.

Every token spent explaining common knowledge is a token that could contain domain-specific information. It's an opportunity cost.

**Example**:

- ✗ "Install the library using pip, Python's package manager" (10 tokens, zero value)
- ✓ "Install: `pip install pdfplumber`" (6 tokens, complete information)

Savings: 4 tokens. Multiply by 100 such explanations = 400 tokens saved.

**The Trade-off**: Brevity vs. completeness.

Some worry: "What if Claude doesn't know something I assume it knows?" This rarely happens with common concepts. If you're unsure, err on the side of trust. It's better to occasionally need to clarify something than to waste tokens explaining obvious things 99% of the time.

**When to violate**: If your domain uses terms differently than standard usage (e.g., "field" means something specific in your context), disambiguate. But this should be rare.

### 3. Enable Discovery: Make Skills Findable

**Origin**: This principle comes from the reality that Claude must choose from potentially 100+ skills.

Skill discovery works by matching user requests to skill descriptions. This is essentially a search problem:

User: "Can you extract text from this PDF?"
Claude: _scans all descriptions_ → finds "Extract text from PDF" → triggers that skill

If your description is vague ("Helps with documents"), it matches weakly against many queries. Specific descriptions ("Extract text from PDF and Word documents") create strong, unambiguous matches.

**The Philosophy**: Descriptions are search keywords, not prose.

Write descriptions for machines first, humans second. Include:

- **Concrete nouns**: File types, technology names, data types
- **Specific verbs**: Extract, analyze, generate, deploy
- **Trigger phrases**: What users actually say

**The Trade-off**: Specificity vs. flexibility.

Some worry: "If I'm too specific, my skill won't trigger for edge cases." This is backwards. A skill that triggers too broadly is worse than one that triggers too narrowly:

- **Too broad**: Triggers often, wastes tokens loading irrelevant content
- **Too narrow**: Doesn't trigger when it should, but at least doesn't actively hurt

You can always make descriptions broader later if you discover missed use cases. You can't easily fix a skill that triggers too often and wastes context.

**When to violate**: If your skill genuinely covers many different domains and you can't enumerate them, be more general. But question whether this should really be multiple skills instead.

## The Meta-Principle: Understanding Over Rules

These three principles aren't arbitrary rules. They emerge from the fundamental constraint: **limited context space**.

If context were unlimited, you wouldn't need:

- Progressive disclosure (load everything!)
- Conciseness (explain everything!)
- Careful descriptions (trigger all skills!)

But context _is_ limited, so every decision is a trade-off.

**The constitutional approach**: Rather than providing 100 specific rules ("don't use Windows paths," "keep SKILL.md under 500 lines," "use third person"), we provide principles. When you encounter a novel situation not covered by examples, ask:

1. Does this minimize context usage? (Progressive disclosure)
2. Am I explaining things Claude knows? (Respect intelligence)
3. Will Claude find this when needed? (Enable discovery)

If yes to all three, it's probably a good decision—even if it doesn't match any specific pattern you've seen.

## Making Trade-offs

Real situations involve trade-offs between principles:

### Example 1: Inline Examples vs. Reference File

**Scenario**: You have 10 examples. Should they go in SKILL.md or a reference file?

**Trade-off**:

- **Inline**: Violates progressive disclosure (loads all examples always)
- **Reference**: Adds navigation overhead

**Decision framework**:

- How often are examples needed? (Always = inline, sometimes = reference)
- Are different examples needed for different scenarios? (Yes = reference)
- Can you show 2-3 canonical examples and defer the rest? (Best of both)

**Likely answer**: Show 2-3 core examples inline, link to comprehensive examples in reference file.

### Example 2: Detailed Instructions vs. Trust Claude

**Scenario**: Should you provide step-by-step instructions or high-level guidance?

**Trade-off**:

- **Detailed**: Uses more tokens but ensures correctness
- **High-level**: Saves tokens but risks mistakes

**Decision framework**:

- How fragile is the task? (Fragile = detailed, robust = high-level)
- What's the cost of mistakes? (High = detailed, low = high-level)
- Does Claude have relevant training? (Yes = high-level, no = detailed)

**Example**:

- ✓ Detailed: "Deploy to production (irreversible, must follow exact sequence)"
- ✓ High-level: "Analyze data (multiple valid approaches, context-dependent)"

### Example 3: Specific Triggers vs. Broad Applicability

**Scenario**: Your skill could apply to many scenarios. How specific should the description be?

**Trade-off**:

- **Specific triggers**: Good discovery, might miss edge cases
- **Broad description**: Covers everything, poor discovery

**Decision framework**:

- What are the most common use cases? (Optimize for these)
- Can you list 80% of scenarios? (Yes = enumerate them)
- Is it better to miss 20% of uses or trigger too often? (Miss 20%)

**Likely answer**: Include 5-10 specific trigger terms covering 80% of use cases. Accept that edge cases might not trigger automatically—users can still invoke manually.

## Conclusion: Judgment Over Compliance

The goal isn't to follow rules perfectly. It's to make Claude more effective by using context space wisely.

When faced with a decision:

1. Understand _why_ each option matters (which principles does it support or violate?)
2. Consider the specific context (what are the actual trade-offs here?)
3. Choose the option that best serves the fundamental goal (efficient context usage)
4. Document your reasoning if it's non-obvious (help future maintainers)

This is the constitutional approach: Give Claude (and skill authors) the judgment to make good decisions, not just the rules to follow mechanically.
