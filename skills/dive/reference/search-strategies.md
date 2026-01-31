# Search Strategies Reference

Strategic approaches for finding information in project documentation.

## Documentation Search Order

### Level 1: Project Overview

Start with high-level documents:
- README.md, ARCHITECTURE.md
- docs/README.md, docs/index.md
- CONTRIBUTING.md, DEVELOPMENT.md

**Purpose**: Understand project structure, key concepts, links to detailed docs.

### Level 2: Domain-Specific Docs

Search by topic:
- API docs: docs/api/, API.md, openapi.yaml, swagger.json
- Architecture: docs/architecture/, ADR/, DESIGN.md
- User guides: docs/guides/, docs/tutorials/
- Developer docs: docs/dev/, DEVELOPMENT.md

### Level 3: Component Docs

Documentation near code:
- Component READMEs: src/**/README.md
- Inline documentation: src/**/*.md

## Search by Question Type

### Business Logic Questions

**Example**: "How does feature X work?"

**Search sequence**:
1. User-facing docs (docs/guides/, docs/user/)
2. API documentation (docs/api/, API.md)
3. Component READMEs
4. Code comments

### Technical Implementation Questions

**Example**: "What technology is used for Y?"

**Search sequence**:
1. Architecture docs (ARCHITECTURE.md, docs/architecture/)
2. Configuration files (config/, *.config.*)
3. Dependency files (package.json, requirements.txt)
4. Code imports

### Debugging Questions

**Example**: "What causes error X?"

**Search sequence**:
1. Error documentation (docs/errors/, docs/troubleshooting/)
2. Code search for error messages
3. Test files for error cases
4. Git history for bug fixes

### Configuration Questions

**Example**: "How do I configure X?"

**Search sequence**:
1. Configuration docs (docs/configuration/, CONFIG.md)
2. .env.example files
3. Config file comments
4. Default values in code

## Search Workflow Examples

### Example 1: API Endpoint Documentation

**Goal**: Understand /users/profile endpoint

```
Step 1: Check API docs
  → Search: users/profile in docs/api/, API.md

Step 2: Check OpenAPI/Swagger
  → Search: /users.*profile in openapi.yaml

Step 3: If not in docs, search code
  → Search: route.*profile in src/
```

### Example 2: Environment Variables

**Goal**: Find available environment variables

```
Step 1: Check .env.example
  → List all variables

Step 2: Check config docs
  → Search: environment.*variable in docs/

Step 3: Check config files
  → Search: process.env|getenv in config/

Step 4: Check deployment docs
  → Search: environment in docs/deployment/
```

### Example 3: Architecture Decisions

**Goal**: Why was technology X chosen?

```
Step 1: Check ADRs
  → Look in docs/adr/, docs/decisions/

Step 2: Check ARCHITECTURE.md
  → Search for technology name

Step 3: Check design docs
  → Search in docs/design/

Step 4: Check git history
  → Review commits introducing the technology
```

## Progressive Search Strategy

When initial searches fail:

**1. Start specific** → Exact term
**2. Broaden scope** → Partial match, case-insensitive
**3. Use synonyms** → Related terms (auth/authentication/login)
**4. Search code** → If not documented, check implementation

## Technology-Specific Docs

### JavaScript/TypeScript

- package.json: Dependencies, scripts
- tsconfig.json: TypeScript settings
- JSDoc/TSDoc comments

### Python

- requirements.txt, pyproject.toml: Dependencies
- setup.py: Package config
- Docstrings in code

### Go

- go.mod: Dependencies
- godoc comments
- README in each package

### Java

- pom.xml, build.gradle: Dependencies
- Javadoc comments
- Spring configuration files

## Document Types and Purpose

### Getting Started Docs
**Files**: README.md, QUICKSTART.md, docs/getting-started.md
**Purpose**: Initial setup, basic usage, quick overview

### API Reference
**Files**: API.md, docs/api/, openapi.yaml, swagger.json
**Purpose**: Endpoint specifications, request/response formats

### Architecture Docs
**Files**: ARCHITECTURE.md, docs/architecture/, docs/adr/
**Purpose**: System design, component relationships, decisions

### Development Guides
**Files**: CONTRIBUTING.md, DEVELOPMENT.md, docs/dev/
**Purpose**: Setup for development, coding standards, workflows

### Deployment Docs
**Files**: DEPLOYMENT.md, docs/deployment/, docs/ops/
**Purpose**: Deployment procedures, infrastructure, operations

### Configuration Docs
**Files**: CONFIG.md, docs/configuration.md, .env.example
**Purpose**: Available settings, defaults, environment setup

## Search Optimization

### When Documentation Search Succeeds

Move to code for implementation details:
1. Note the documented feature/API
2. Search code for implementation
3. Cross-reference with tests
4. Verify current behavior

### When Documentation Search Fails

**Options**:
1. Search code directly (see code-search-patterns.md)
2. Check git history for removed/moved docs
3. Look for inline comments
4. Examine test files
5. Review related component docs

### Multiple Documentation Sources

**Priority order**:
1. Most recently updated docs
2. Docs closest to code (component READMEs)
3. User-facing docs over internal notes
4. Official docs over comments

## Common Documentation Patterns

### Monorepo Structure

```
/
├── README.md              # Overall project
├── packages/
│   ├── api/
│   │   ├── README.md      # API package docs
│   │   └── docs/          # Detailed API docs
│   └── web/
│       ├── README.md      # Web package docs
│       └── docs/          # Detailed web docs
└── docs/
    └── architecture/      # Cross-cutting architecture
```

**Strategy**: Check package-specific docs before shared docs.

### Docs-as-Code Structure

```
/
├── docs/
│   ├── api/
│   │   └── *.md           # API documentation
│   ├── guides/
│   │   └── *.md           # User guides
│   ├── architecture/
│   │   └── *.md           # Architecture docs
│   └── development/
│       └── *.md           # Developer docs
```

**Strategy**: Navigate by doc type, then topic.

## Tips for Effective Documentation Search

### Do

- Start with README and overview docs
- Follow links from high-level docs to detailed ones
- Check file timestamps (prefer recent docs)
- Look for table of contents
- Search multiple locations for same topic

### Don't

- Stop after first match
- Ignore recently updated docs
- Skip checking examples/tutorials
- Forget to verify with code
- Assume docs are complete or current

## Handling Documentation Gaps

When documentation is insufficient:

1. **Explicit statement**: "Documentation does not cover X"
2. **Move to code**: "Checking implementation for details"
3. **Note the gap**: "Found in code but not documented"
4. **Cite both**: Use docs for intent, code for implementation

**Example**:
```
Feature X is documented in docs/api/users.md:45 as "Creates a new user",
but implementation details (validation rules, default values) found only
in code at src/services/user.ts:89-120.
```
