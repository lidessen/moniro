# YAML Frontmatter Requirements

Every `SKILL.md` file requires YAML frontmatter with two fields: `name` and `description`.

## Table of Contents

- [Structure](#structure)
- [Name Field](#name-field)
- [Description Field](#description-field)
- [Complete Examples](#complete-examples)
- [Validation](#validation)
- [Testing Your Frontmatter](#testing-your-frontmatter)
- [Common Errors](#common-errors)
- [Template](#template)

## Structure

```yaml
---
name: skill-name
description: Brief description of what this skill does and when to use it
---
```

The frontmatter must:

- Start with `---` on first line
- End with `---` on its own line
- Come before any markdown content
- Include exactly two required fields

## Name Field

### Requirements

| Requirement           | Details                                            |
| --------------------- | -------------------------------------------------- |
| **Format**            | Lowercase letters, numbers, and hyphens only       |
| **Max length**        | 64 characters                                      |
| **No XML tags**       | Cannot contain `<`, `>`, or XML-like structures    |
| **No reserved words** | Cannot contain "anthropic" or "claude"             |
| **Must be unique**    | No two skills can have same name in same directory |

### Valid Names

```yaml
name: processing-pdfs
name: analyze-bigquery-data
name: code-review-helper
name: git-commit-messages
name: testing-react-components
name: managing-docker-containers
```

### Invalid Names

```yaml
name: Processing PDFs              # No uppercase, no spaces
name: process_pdfs                 # No underscores
name: pdf-processing-and-analysis-tool-for-documents  # Too long (>64 chars)
name: <pdf-processor>              # No XML tags
name: claude-helper                # No "claude"
name: anthropic-tool               # No "anthropic"
```

### Naming Conventions

We recommend **gerund form** (verb + -ing) for consistency:

| Good (Gerund)        | Also Acceptable       | Avoid        |
| -------------------- | --------------------- | ------------ |
| `processing-pdfs`    | `pdf-processing`      | `pdf-helper` |
| `analyzing-data`     | `data-analysis`       | `data-tool`  |
| `managing-databases` | `database-management` | `db-utils`   |
| `testing-code`       | `code-testing`        | `test-stuff` |

## Description Field

### Requirements

| Requirement           | Details                                         |
| --------------------- | ----------------------------------------------- |
| **Must be non-empty** | At least one character                          |
| **Max length**        | 1024 characters                                 |
| **No XML tags**       | Cannot contain `<`, `>`, or XML-like structures |
| **Point of view**     | Must be third person                            |
| **Content**           | Must describe WHAT and WHEN                     |

### The Formula

```
[WHAT: Specific capabilities] + [WHEN: Trigger scenarios/keywords]
```

### Valid Descriptions

```yaml
# Good - WHAT + WHEN
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.

# Good - Multiple capabilities
description: Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.

# Good - Domain-specific
description: Query and analyze company data in BigQuery across finance, sales, and product domains. Use when analyzing company data, querying BigQuery, or asking about revenue, sales, or product metrics.
```

### Invalid Descriptions

```yaml
# Bad - Empty
description:

# Bad - First person
description: I help you process Excel files

# Bad - Second person
description: You can use this to process Excel files

# Bad - Too vague, no triggers
description: Helps with documents

# Bad - XML tags
description: Process <pdf> files and <docx> documents
```

### Point of View

**Always use third person**. The description is injected into the system prompt.

| ✓ Third Person    | ✗ First Person  | ✗ Second Person         |
| ----------------- | --------------- | ----------------------- |
| Processes files   | I process files | You process files       |
| Analyzes data     | I can analyze   | You can analyze         |
| Generates reports | I help generate | This helps you generate |

### Include Trigger Terms

Good descriptions include specific terms that trigger skill discovery:

**File types**: PDF, .xlsx, .json, .csv, .docx
**Technologies**: PostgreSQL, React, Docker, BigQuery
**Activities**: "code review", "commit message", "analyze data"
**Domain terms**: "database schema", "API endpoint", "form fields"

**Example with triggers**:

```yaml
description: Extract text from PDF and Word documents, convert between formats. Use when processing PDFs, .docx files, or document conversion.
```

Triggers: PDF, Word, .docx, document, conversion

## Complete Examples

### Example 1: PDF Processing

```yaml
---
name: processing-pdfs
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---
```

### Example 2: Code Review

```yaml
---
name: code-review
description: Review code for quality, security, and maintainability following team standards. Use when reviewing pull requests, examining code changes, or when the user asks for a code review.
---
```

### Example 3: BigQuery Analysis

```yaml
---
name: bigquery-analysis
description: Query and analyze company data in BigQuery across finance, sales, and product domains. Use when analyzing company data, querying BigQuery, or asking about revenue, sales, or product metrics.
---
```

### Example 4: Git Commits

```yaml
---
name: git-commit-helper
description: Generate descriptive commit messages by analyzing git diffs and staged changes. Use when writing commits or reviewing changes.
---
```

## Validation

When skill is loaded, the system validates:

1. **Name validation**:
   - Length ≤ 64 characters
   - Only lowercase, numbers, hyphens
   - No XML tags
   - No reserved words

2. **Description validation**:
   - Non-empty
   - Length ≤ 1024 characters
   - No XML tags

**If validation fails**: Skill won't load and error will be reported.

## Testing Your Frontmatter

Before using your skill, verify:

1. **Name is valid**:
   - [ ] Lowercase, numbers, hyphens only
   - [ ] ≤ 64 characters
   - [ ] No "anthropic" or "claude"
   - [ ] No XML tags

2. **Description is valid**:
   - [ ] ≤ 1024 characters
   - [ ] Third person
   - [ ] Includes WHAT and WHEN
   - [ ] Has specific trigger terms
   - [ ] No XML tags

3. **Format is correct**:
   - [ ] Starts with `---`
   - [ ] Ends with `---`
   - [ ] Both fields present
   - [ ] Comes before markdown content

## Common Errors

### Error: Name Too Long

```yaml
name: processing-pdf-documents-and-extracting-text-content-utility # 67 chars
```

**Fix**: Shorten to ≤64 characters

```yaml
name: processing-pdfs # 15 chars
```

### Error: Invalid Characters

```yaml
name: Process_PDFs # Uppercase and underscore
```

**Fix**: Use lowercase and hyphens

```yaml
name: process-pdfs
```

### Error: First Person Description

```yaml
description: I can help you analyze Excel files
```

**Fix**: Use third person

```yaml
description: Analyzes Excel files and generates reports
```

### Error: Missing Trigger Terms

```yaml
description: Helps with data
```

**Fix**: Add specific triggers

```yaml
description: Analyzes Excel spreadsheets, creates pivot tables, generates charts. Use when working with .xlsx files, spreadsheets, or tabular data.
```

### Error: Missing ---

```markdown
name: skill-name
description: ...

# Skill Content
```

**Fix**: Add YAML delimiters

```yaml
---
name: skill-name
description: ...
---
# Skill Content
```

## Template

Use this template when creating new skills:

```yaml
---
name: your-skill-name
description: [What it does: specific capabilities]. [More capabilities]. Use when [scenario 1], [scenario 2], or when the user mentions [keyword 1], [keyword 2], [keyword 3].
---

# Your Skill Name

[Skill content here]
```
