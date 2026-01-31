---
name: dive
description: Dives deep into project questions using layered investigation (docs → code → analysis) to provide evidence-based answers with file:line citations. Use when asking "how does X work", "what is Y", "where is Z", or investigating features, APIs, configuration, codebase structure, or technical decisions.
---

# Dive

Dives deep into your project to investigate any question, from business logic to technical implementation. Uses layered search strategy to find evidence-based answers backed by documentation and code.

## Core Principle

**Never guess or assume**. Every answer must be backed by concrete evidence from:
- Documentation (README, design docs, comments)
- Code (implementation, tests, configuration)
- Project artifacts (commits, issues, PRs)

## Workflow

When answering project questions, follow this layered search strategy:

### 1. Layer 1: Documentation Search

Search documentation first:
- Project overview (README, ARCHITECTURE)
- API specs (API.md, openapi.yaml)
- Design decisions (ADR/, docs/design/)

See [reference/search-strategies.md](reference/search-strategies.md) for detailed patterns.

### 2. Layer 2: Code Search

If documentation insufficient, search code:
- Type definitions (interfaces, schemas, models)
- Entry points (routes, handlers, main)
- Implementation (core logic)
- Tests (expected behavior)
- Configuration (settings, env vars)

See [reference/code-search-patterns.md](reference/code-search-patterns.md) for techniques.

### 3. Layer 3: Deep Analysis

For complex questions, use Task tool with Explore agent for:
- End-to-end feature tracing
- Cross-component dependencies
- Codebase structure analysis

### 4. Collect Evidence

Cite all sources with file:line format. Multiple sources strengthen answers (docs + code + tests).

See [reference/evidence-collection.md](reference/evidence-collection.md) for formats and templates.

### 5. Formulate Answer

Structure: Direct answer → Evidence (with file:line citations) → Summary.

Quality rules:
- Start with direct answer
- Cite specific file:line for all claims
- Acknowledge uncertainty explicitly
- Never guess without stating it

### 6. Handle Uncertainty

If evidence insufficient, state what was searched, what was found, and what's missing. Offer next search steps. Never fabricate answers.

## Question Categories

### Business Logic Questions
"How does feature X work?"
"What happens when user does Y?"

**Approach**: Documentation → API definitions → Implementation → Tests

### Technical Implementation Questions
"How is X implemented?"
"What library/pattern is used for Y?"

**Approach**: Code search → Configuration → Dependencies

### Architecture Questions
"Why is X designed this way?"
"How do components interact?"

**Approach**: Architecture docs → Design docs → Code structure

### Debugging Questions
"Where could bug X be coming from?"
"What causes error Y?"

**Approach**: Error messages → Stack traces → Related code → Tests

### Historical Questions
"Why was X changed?"
"When was Y introduced?"

**Approach**: Git log → Commit messages → PR descriptions → Issues

## Quality Checklist

Before providing answer:
- [ ] Question fully understood
- [ ] Searched all relevant layers (docs → code → analysis)
- [ ] Evidence collected from multiple sources
- [ ] All sources cited with file:line references
- [ ] Uncertainty acknowledged if exists
- [ ] Answer directly addresses question
- [ ] Response structured for clarity

See [reference/examples.md](reference/examples.md) for detailed workflow examples.

## Advanced Techniques

### Cross-referencing
When findings conflict, investigate deeper:
- Check git history for changes
- Review PR discussions for rationale
- Look for deprecation notices

### Pattern Recognition
Identify project-specific patterns:
- Naming conventions
- Code organization
- Architecture patterns
- Common utilities

Use discovered patterns to guide future searches.

### Context Building
Maintain mental model of:
- Project structure and boundaries
- Key components and responsibilities
- Common data flows
- Critical business rules

Build this through repeated exploration, not assumptions.

## Anti-Patterns

- ✗ Answering without searching first
- ✗ Assuming based on "typical" practices
- ✗ Citing memory instead of current codebase
- ✗ Skipping documentation layer
- ✗ Providing outdated information
- ✗ Generalizing from single example
- ✗ Ignoring test cases as evidence source

## Additional Resources

**Search Strategies**:
- [reference/search-strategies.md](reference/search-strategies.md) - General search strategies for documentation and an introduction to code search

**Code Search Patterns**:
- [reference/code-search-patterns.md](reference/code-search-patterns.md) - Techniques for navigating codebases

**Evidence Collection**:
- [reference/evidence-collection.md](reference/evidence-collection.md) - Templates and best practices for gathering proof
