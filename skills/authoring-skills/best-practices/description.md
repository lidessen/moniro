# Writing Effective Descriptions

The `description` field is **critical** for skill discovery. Claude uses it to choose the right skill from potentially 100+ available skills.

## Table of Contents

- [Core Requirements](#core-requirements)
- [The Formula](#the-formula)
- [Excellent Examples](#excellent-examples)
- [Point of View: Third Person Only](#point-of-view-third-person-only)
- [Specificity Levels](#specificity-levels)
- [Include Trigger Terms](#include-trigger-terms)
- [Length Guidelines](#length-guidelines)
- [Multiple Capabilities](#multiple-capabilities)
- [Domain-Specific Skills](#domain-specific-skills)
- [Testing Your Description](#testing-your-description)
- [Common Mistakes](#common-mistakes)
- [Template](#template)

## Core Requirements

1. **Write in third person** (description is injected into system prompt)
2. **Be specific** (include key terms and triggers)
3. **Include WHAT and WHEN**
4. **Max 1024 characters**
5. **No XML tags**

## The Formula

```
[WHAT: Specific capabilities] + [WHEN: Trigger scenarios/keywords]
```

## Excellent Examples

### PDF Processing

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

**Why it works**:

- WHAT: Extract text/tables, fill forms, merge documents
- WHEN: PDF files, mentions PDFs/forms/extraction
- Concrete keywords: "PDF", "forms", "documents", "extraction"

### Excel Analysis

```yaml
description: Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.
```

### Git Commit Helper

```yaml
description: Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes.
```

### Code Review

```yaml
description: Review code for quality, security, and maintainability following team standards. Use when reviewing pull requests, examining code changes, or when the user asks for a code review.
```

### Database Schema Query

```yaml
description: Query and analyze database schemas for PostgreSQL, MySQL, and MongoDB. Use when the user asks about database structure, table definitions, relationships, or mentions database schemas.
```

## Point of View: Third Person Only

**Good** (third person):

```yaml
description: Processes Excel files and generates reports
description: Analyzes code quality and suggests improvements
description: Extracts data from API endpoints
```

**Bad** (first person):

```yaml
description: I can help you process Excel files
description: I analyze code quality
```

**Bad** (second person):

```yaml
description: You can use this to process Excel files
description: Helps you analyze code
```

**Why it matters**: Description is injected into system prompt. Inconsistent POV confuses Claude's skill discovery mechanism.

## Specificity Levels

### Too Vague ✗

```yaml
description: Helps with documents
description: Processes data
description: Does stuff with files
description: General utility functions
```

**Problem**: No specific capabilities, no trigger terms.

### Specific Enough ✓

```yaml
description: Extract text from PDF and Word documents, convert between formats. Use when processing PDFs, .docx files, or document conversion.
```

## Include Trigger Terms

Trigger terms help Claude discover your skill. Include:

1. **File types/extensions**: PDF, .xlsx, .json, .csv
2. **Technology names**: PostgreSQL, React, Docker, Kubernetes
3. **Activity phrases**: "code review", "commit message", "analyze data"
4. **Domain terms**: "database schema", "API endpoint", "form fields"

### Example: Before and After

**Before** (vague):

```yaml
description: Works with databases
```

**After** (specific triggers):

```yaml
description: Query and manage PostgreSQL databases, analyze schemas, optimize queries. Use when working with PostgreSQL, database schemas, SQL queries, or performance optimization.
```

## Length Guidelines

- **Minimum**: 50 characters (be specific enough)
- **Maximum**: 1024 characters (hard limit)
- **Recommended**: 150-300 characters (specific but concise)

### Too Short ✗

```yaml
description: Process PDFs
```

**Problem**: Not enough context for discovery.

### Good Length ✓

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

**Character count**: ~180 characters.

## Multiple Capabilities

If skill has multiple capabilities, list them briefly:

```yaml
description: Create, update, and analyze Jira tickets. Track sprint progress, generate reports, query issue status. Use when working with Jira, managing tickets, sprint planning, or generating project reports.
```

**Structure**:

1. List main capabilities (create, update, analyze)
2. List secondary capabilities (track, generate, query)
3. Add trigger terms (Jira, tickets, sprint planning, reports)

## Domain-Specific Skills

### BigQuery Analysis

```yaml
description: Analyze company data in BigQuery across finance, sales, and product domains. Query revenue metrics, pipeline data, API usage. Use when analyzing company data, querying BigQuery, or asking about revenue, sales, or product metrics.
```

### Internal Tool Integration

```yaml
description: Interact with internal deployment system to check service status, trigger deployments, view logs. Use when checking service health, deploying applications, or troubleshooting production issues.
```

## Testing Your Description

Ask yourself:

1. **If Claude sees 100 skill descriptions, will it pick mine for the right tasks?**
2. **Do I use specific nouns/verbs, not generic terms?**
3. **Are my trigger terms the actual words users will say?**
4. **Is it third person?**
5. **Does it describe WHAT and WHEN?**

## Common Mistakes

### Mistake 1: No Trigger Terms

```yaml
description: A skill for processing documents and extracting information
```

**Fix**: Add specific file types and scenarios:

```yaml
description: Extract text, tables, and metadata from PDF and Word documents. Use when processing .pdf or .docx files, extracting document content, or converting between formats.
```

### Mistake 2: Wrong Point of View

```yaml
description: I help you write better commit messages by analyzing your changes
```

**Fix**: Use third person:

```yaml
description: Generate descriptive commit messages by analyzing git diffs and staged changes. Use when writing commits or reviewing changes.
```

### Mistake 3: Too Generic

```yaml
description: Helper functions for data processing
```

**Fix**: Be specific about what data and what processing:

```yaml
description: Process CSV and JSON data files, clean data, merge datasets, generate summaries. Use when working with .csv or .json files, data cleaning, or data analysis tasks.
```

### Mistake 4: Only What, No When

```yaml
description: Analyzes code quality and suggests improvements
```

**Fix**: Add trigger scenarios:

```yaml
description: Analyze code quality, detect bugs, suggest improvements following team standards. Use when reviewing code, examining pull requests, or performing code audits.
```

## Template

Use this template to draft descriptions:

```yaml
description: [Verb] [specific thing] [and other capabilities]. [Verb] [more capabilities]. Use when [scenario 1], [scenario 2], or when the user mentions [keyword 1], [keyword 2], [keyword 3].
```

**Example using template**:

```yaml
description: Process video files, extract frames, generate thumbnails, analyze content. Convert between formats like MP4, AVI, MOV. Use when working with video files, extracting frames, generating thumbnails, or when the user mentions video processing, .mp4, or video conversion.
```
