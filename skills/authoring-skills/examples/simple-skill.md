# Example: Simple Skill

This example shows a basic skill with just a SKILL.md file, suitable for straightforward tasks.

## Table of Contents

- [Use Case](#use-case)
- [Directory Structure](#directory-structure)
- [Why This Is a Simple Skill](#why-this-is-a-simple-skill)
- [When to Use Single-File Skills](#when-to-use-single-file-skills)
- [What Makes This Skill Effective](#what-makes-this-skill-effective)
- [Metadata Analysis](#metadata-analysis)
- [How Claude Uses This Skill](#how-claude-uses-this-skill)

## Use Case

A skill that helps generate commit messages following conventional commit format.

## Directory Structure

```
git-commit-helper/
└── SKILL.md
```

## SKILL.md

````markdown
---
name: git-commit-helper
description: Generate descriptive commit messages by analyzing git diffs and staged changes. Use when writing commits, reviewing changes, or when the user asks for help with commit messages.
---

# Git Commit Helper

## Quick Start

Generate conventional commit messages from git changes:

1. Review staged changes
2. Analyze what changed and why
3. Format as: `type(scope): description`

## Commit Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Formatting, missing semicolons
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or updating tests
- **chore**: Maintenance (deps, build, etc.)

## Format

\```
type(scope): brief description

Detailed explanation of changes

- Key point 1
- Key point 2
  \```

## Examples

**Example 1: New Feature**
\```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware

- Create /api/login endpoint
- Add JWT token generation
- Implement auth middleware for protected routes
  \```

**Example 2: Bug Fix**
\```
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
to avoid timezone-related display issues
\```

**Example 3: Refactoring**
\```
refactor(database): extract query builders into separate module

Improve code organization and testability

- Move query builders to db/queries.js
- Add unit tests for query builders
- Update imports across codebase
  \```

**Example 4: Chore**
\```
chore: update dependencies and fix security vulnerabilities

- Upgrade lodash to 4.17.21
- Update axios to 1.6.0
- Fix npm audit issues
  \```

## Guidelines

**Description (first line)**:

- Use imperative mood: "add" not "added"
- Don't capitalize first letter
- No period at end
- Max 72 characters

**Body (optional)**:

- Explain what and why, not how
- Wrap at 72 characters
- Use bullet points for multiple changes

**Scope (optional but recommended)**:

- Component or area affected
- Examples: auth, api, database, ui, docs

## Common Patterns

**Multiple files changed**:
\```
refactor(api): reorganize endpoint handlers

- Move user endpoints to users/ directory
- Extract validation to middleware
- Update tests for new structure
  \```

**Breaking changes**:
\```
feat(api): change response format to follow JSON:API spec

BREAKING CHANGE: API responses now follow JSON:API format.
Update client code to use data.attributes instead of direct properties.
\```

**Issue references**:
\```
fix(login): handle expired token error

Closes #123
\```
````

## Why This Is a Simple Skill

1. **Single file**: All content fits in SKILL.md (<500 lines)
2. **No dependencies**: No scripts, no reference files
3. **Self-contained**: Everything needed is in one place
4. **Clear structure**: Format → Examples → Guidelines
5. **Common task**: Frequently used, benefits from consistent format

## When to Use Single-File Skills

Use a single SKILL.md when:

- Content is <500 lines
- No complex workflows requiring scripts
- No multiple domains requiring separate files
- All information is equally relevant
- Task is straightforward

## What Makes This Skill Effective

1. **Concise description**: Clearly states WHAT and WHEN
2. **Quick start**: Essential info up front
3. **Clear format**: Template with placeholders
4. **Concrete examples**: 4 examples covering different types
5. **Guidelines**: Style rules clearly stated
6. **Common patterns**: Handles frequent scenarios

## Metadata Analysis

### Name

```yaml
name: git-commit-helper
```

✓ Lowercase with hyphens
✓ Descriptive (not generic like "helper")
✓ 17 characters (<64 limit)

### Description

```yaml
description: Generate descriptive commit messages by analyzing git diffs and staged changes. Use when writing commits, reviewing changes, or when the user asks for help with commit messages.
```

✓ Third person
✓ Specific capabilities: "generate commit messages", "analyzing git diffs"
✓ Clear triggers: "writing commits", "reviewing changes", "commit messages"
✓ 219 characters (<1024 limit)

## How Claude Uses This Skill

1. **Discovery**: User says "help me write a commit message"
2. **Trigger**: Description matches "commit messages"
3. **Load**: Claude reads SKILL.md
4. **Apply**:
   - Sees format: `type(scope): description`
   - Reviews examples
   - Follows guidelines
   - Generates message matching pattern

## Total Token Cost

This skill's SKILL.md is approximately 500 tokens. When triggered:

- Claude loads ~500 tokens
- Has all information needed
- No additional files to read

**Efficient**: Single read, complete information.
