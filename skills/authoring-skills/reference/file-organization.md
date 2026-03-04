# File Organization Strategies

Effective file organization is key to progressive disclosure. This guide shows how to structure skill directories for optimal context usage.

## Table of Contents

- [Core Principle](#core-principle)
- [Organization by Domain](#organization-by-domain)
- [Organization by Feature](#organization-by-feature)
- [Organization by Complexity](#organization-by-complexity)
- [Organization by Use Case](#organization-by-use-case)
- [Hybrid Organization](#hybrid-organization)
- [Organizing Scripts](#organizing-scripts)
- [File Naming Conventions](#file-naming-conventions)
- [Directory Depth Guidelines](#directory-depth-guidelines)
- [Table of Contents in Long Files](#table-of-contents-in-long-files)
- [Organization Checklist](#organization-checklist)
- [Testing Your Organization](#testing-your-organization)

## Core Principle

**Layer by domain, feature, or complexity**. Organize so Claude only reads what's relevant to the current task.

## Organization by Domain

Best for skills with multiple distinct knowledge domains.

### Structure

```
skill-name/
├── SKILL.md
└── reference/
    ├── domain-a.md
    ├── domain-b.md
    └── domain-c.md
```

### Example: BigQuery Analysis

```
bigquery-analysis/
├── SKILL.md
└── reference/
    ├── finance.md    # Revenue, billing schemas
    ├── sales.md      # Pipeline, opportunities
    ├── product.md    # API usage, features
    └── marketing.md  # Campaigns, attribution
```

**SKILL.md navigation**:

```markdown
## Available Datasets

**Finance**: Revenue, ARR, billing → [reference/finance.md](reference/finance.md)
**Sales**: Opportunities, pipeline, accounts → [reference/sales.md](reference/sales.md)
**Product**: API usage, features, adoption → [reference/product.md](reference/product.md)
**Marketing**: Campaigns, attribution, email → [reference/marketing.md](reference/marketing.md)
```

**When to use**: Skill provides access to multiple distinct domains (databases, APIs, documentation areas).

## Organization by Feature

Best for skills with multiple distinct capabilities.

### Structure

```
skill-name/
├── SKILL.md
├── feature-a.md
├── feature-b.md
└── feature-c.md
```

### Example: PDF Processing

```
pdf-processing/
├── SKILL.md
├── forms.md        # Form filling
├── extraction.md   # Text extraction
├── merging.md      # PDF merging
└── api-reference.md
```

**SKILL.md navigation**:

```markdown
## Quick Start

Basic text extraction:
[Quick example here]

## Advanced Features

**Form filling**: See [forms.md](forms.md) for complete guide
**Advanced extraction**: See [extraction.md](extraction.md) for tables, images
**Merging PDFs**: See [merging.md](merging.md) for combining documents
**API reference**: See [api-reference.md](api-reference.md) for all methods
```

**When to use**: Skill has distinct features users may not all need.

## Organization by Complexity

Best for skills where beginners and experts need different levels of detail.

### Structure

```
skill-name/
├── SKILL.md         # Essentials
├── examples.md      # Common scenarios
└── advanced/
    ├── edge-cases.md
    ├── performance.md
    └── internals.md
```

### Example: React Testing

```
react-testing/
├── SKILL.md              # Core testing patterns
├── examples.md           # Common test scenarios
└── advanced/
    ├── mocking.md        # Advanced mocking strategies
    ├── async-testing.md  # Complex async patterns
    └── performance.md    # Performance testing
```

**SKILL.md navigation**:

```markdown
## Basic Testing

[Essential patterns here]

## Common Scenarios

See [examples.md](examples.md) for typical test cases.

## Advanced Topics

Only needed for complex scenarios:

- **Mocking strategies**: [advanced/mocking.md](advanced/mocking.md)
- **Async testing**: [advanced/async-testing.md](advanced/async-testing.md)
- **Performance**: [advanced/performance.md](advanced/performance.md)
```

**When to use**: Skill has basic usage (most users) and advanced usage (power users).

## Organization by Use Case

Best for skills with distinct workflows for different scenarios.

### Structure

```
skill-name/
├── SKILL.md
└── workflows/
    ├── scenario-a.md
    ├── scenario-b.md
    └── scenario-c.md
```

### Example: Database Migration

```
database-migration/
├── SKILL.md
└── workflows/
    ├── new-table.md        # Creating new tables
    ├── modify-column.md    # Modifying columns
    ├── data-migration.md   # Migrating data
    └── rollback.md         # Rolling back changes
```

**SKILL.md navigation**:

```markdown
## Migration Workflows

Select the workflow for your scenario:

**Creating new table**: [workflows/new-table.md](workflows/new-table.md)
**Modifying column**: [workflows/modify-column.md](workflows/modify-column.md)
**Migrating data**: [workflows/data-migration.md](workflows/data-migration.md)
**Rolling back**: [workflows/rollback.md](workflows/rollback.md)
```

**When to use**: Different scenarios require different workflows.

## Hybrid Organization

Combine strategies for complex skills.

### Example: API Integration Skill

```
api-integration/
├── SKILL.md
├── quickstart.md
├── authentication/
│   ├── oauth.md
│   ├── api-keys.md
│   └── jwt.md
├── endpoints/
│   ├── users.md
│   ├── products.md
│   └── orders.md
├── examples/
│   ├── common-queries.md
│   ├── batch-operations.md
│   └── error-handling.md
└── reference/
    ├── rate-limits.md
    ├── pagination.md
    └── webhooks.md
```

**SKILL.md navigation**:

```markdown
## Quick Start

See [quickstart.md](quickstart.md) for immediate usage.

## Authentication

- **OAuth**: [authentication/oauth.md](authentication/oauth.md)
- **API Keys**: [authentication/api-keys.md](authentication/api-keys.md)
- **JWT**: [authentication/jwt.md](authentication/jwt.md)

## API Endpoints

- **Users**: [endpoints/users.md](endpoints/users.md)
- **Products**: [endpoints/products.md](endpoints/products.md)
- **Orders**: [endpoints/orders.md](endpoints/orders.md)

## Examples

See [examples/](examples/) for common patterns.

## Reference

- **Rate limits**: [reference/rate-limits.md](reference/rate-limits.md)
- **Pagination**: [reference/pagination.md](reference/pagination.md)
- **Webhooks**: [reference/webhooks.md](reference/webhooks.md)
```

## Organizing Scripts

For skills with executable scripts, use a dedicated directory:

```
skill-name/
├── SKILL.md
├── reference/
│   └── api-docs.md
└── scripts/
    ├── validate.py
    ├── process.py
    └── cleanup.sh
```

**Group by purpose**:

```
scripts/
├── validation/
│   ├── validate_config.py
│   └── validate_data.py
├── processing/
│   ├── transform.py
│   └── aggregate.py
└── utils/
    ├── logging.py
    └── helpers.py
```

## File Naming Conventions

### Use Descriptive Names

**Good**:

- `authentication-methods.md`
- `database-schemas.md`
- `error-handling-patterns.md`
- `validate_form_fields.py`

**Bad**:

- `doc1.md`
- `file2.md`
- `script.py`
- `utils.py`

### Use Consistent Separators

Pick one style and stick to it:

**Markdown files**: Use hyphens

```
api-reference.md
error-handling.md
common-patterns.md
```

**Scripts**: Use underscores (Python convention)

```python
validate_data.py
process_records.py
generate_report.py
```

### Include Context in Name

File names should indicate content:

**Good**:

```
reference/finance-schemas.md       # Clear: finance schemas
workflows/database-migration.md    # Clear: DB migration workflow
scripts/validate_config.py         # Clear: config validation
```

**Bad**:

```
reference/data.md                  # Vague: what data?
workflows/process.md               # Vague: process what?
scripts/helper.py                  # Vague: helps with what?
```

## Directory Depth Guidelines

### Keep It Shallow

**Recommended**: 1-2 levels deep

```
skill-name/
├── SKILL.md
└── reference/
    ├── domain-a.md
    └── domain-b.md
```

**Maximum**: 3 levels deep

```
skill-name/
├── SKILL.md
└── workflows/
    └── advanced/
        └── special-case.md
```

**Avoid**: 4+ levels

```
# Too deep ✗
skill-name/
└── docs/
    └── reference/
        └── api/
            └── endpoints/
                └── users.md
```

## Table of Contents in Long Files

For reference files >100 lines, add TOC at top:

```markdown
# API Reference

## Contents

- [Authentication](#authentication)
- [Core Endpoints](#core-endpoints)
- [Error Handling](#error-handling)
- [Rate Limits](#rate-limits)
- [Examples](#examples)

## Authentication

...

## Core Endpoints

...
```

## Organization Checklist

When organizing your skill, verify:

- [ ] Similar content grouped together
- [ ] Directory structure matches access patterns
- [ ] File names are descriptive
- [ ] Maximum 3 levels of nesting
- [ ] Long files (>100 lines) have table of contents
- [ ] All reference files linked directly from SKILL.md
- [ ] Scripts in dedicated `scripts/` directory
- [ ] Consistent naming convention

## Testing Your Organization

1. **Simulate queries**: For typical user queries, which files need to be read?
2. **Check token efficiency**: Are relevant files loaded? Are irrelevant files avoided?
3. **Verify navigation**: Can you find content from SKILL.md in one step?
4. **Test with Claude**: Does Claude navigate effectively?

Good organization means most queries load <500 total lines.
