# Agent Documentation Guidelines

Guide for writing documentation for AI agents (Claude, etc.) - focused on AGENTS.md, CLAUDE.md, and agent-friendly documentation practices.

## Table of Contents

- [Core Principle: Assume Claude is Smart](#core-principle-assume-claude-is-smart)
- [AGENTS.md vs CLAUDE.md](#agentsmd-vs-claudemd)
- [What to Include](#what-to-include)
- [What to Exclude](#what-to-exclude)
- [Structure and Format](#structure-and-format)
- [Progressive Disclosure](#progressive-disclosure)
- [Common Patterns](#common-patterns)
- [Examples](#examples)

## Core Principle: Assume Claude is Smart

**Claude (and similar AI agents) already knows:**
- Programming language syntax and idioms
- Common frameworks and libraries
- Software engineering best practices
- How to read code
- How to use standard tools (git, npm, pytest, etc.)

**Claude needs to know:**
- **Your project's specific context** - architecture, conventions, constraints
- **Where to find things** - navigation to key files and documentation
- **Project-specific workflows** - non-standard processes unique to this codebase
- **Important constraints** - requirements, limitations, gotchas
- **Entry points** - where to start for common tasks

**Write for intelligence, not ignorance.**

### Good vs Bad Examples

**❌ Bad (Explaining Basics)**
```markdown
# AGENTS.md

## Git Workflow

Git is a version control system. To commit changes:
1. Stage files with `git add`
2. Commit with `git commit -m "message"`
3. Push with `git push`

Make sure to write good commit messages.
```

Claude already knows how to use git.

**✅ Good (Project-Specific Context)**
```markdown
# AGENTS.md

## Git Workflow

This project uses conventional commits. Commit messages must match:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation

Pre-commit hooks validate Go formatting and run tests.
Protected branches: main, staging (require PR approval).
```

This tells Claude what's specific to *this* project.

## AGENTS.md vs CLAUDE.md

### AGENTS.md (Recommended Default)

**Purpose:** General agent navigation and context

**Use when:**
- You want documentation useful for any AI agent
- You're starting fresh (default choice)
- You need project overview and navigation

**Typical content:**
- Project overview (1-2 paragraphs)
- Architecture/structure summary
- Key workflows and entry points
- Important constraints
- Links to detailed documentation

**Benefits:**
- Generic, tool-agnostic
- Becoming a community standard
- Single source of truth for agents

### CLAUDE.md (Conditional)

**Purpose:** Claude-specific context and instructions

**Use when:**
- You have Claude-specific instructions that don't apply to other agents
- You want to preserve AGENTS.md for generic content
- You're using Claude Code features specifically (hooks, skills, etc.)

**Typical content:**
- Claude-specific workflows
- Project-specific prompts or instructions
- Context that leverages Claude's specific capabilities
- Differences from generic AGENTS.md guidance

**Benefits:**
- Targeted to Claude's strengths
- Can include Claude Code-specific instructions
- Complements AGENTS.md (both can coexist)

### Decision Guide

```
Do you have Claude-specific instructions?
├─ No → Use AGENTS.md only
└─ Yes → Are they significant enough to warrant separate file?
    ├─ No → Include in AGENTS.md
    └─ Yes → Use both AGENTS.md (generic) and CLAUDE.md (Claude-specific)
```

**Most projects: Start with AGENTS.md only.**

### If Using Both

**AGENTS.md:** Generic navigation and context
**CLAUDE.md:** Claude-specific augmentation

**CLAUDE.md can reference AGENTS.md:**
```markdown
# CLAUDE.md

See AGENTS.md for general project navigation and architecture.

## Claude-Specific Workflows

When refactoring, use the `refactor` skill from skills/refactor/
...
```

## What to Include

### Essential: Project Context

**What makes this project unique?**

Examples:
- "Monorepo with 12 services, each in `services/[name]/`"
- "Frontend uses custom React framework (not Next.js)"
- "Database schema managed by migrations in `db/migrations/`"
- "API follows JSON:API spec strictly"

**What would surprise someone familiar with the domain?**

Examples:
- "Despite being Python, we don't use virtualenv (Docker-based dev)"
- "Auth is handled by external service, not in this codebase"
- "Tests require running Docker Compose first"

### Important: Navigation and Entry Points

**How to find things:**

```markdown
## Codebase Structure

- `src/api/` - REST API endpoints
- `src/services/` - Business logic
- `src/db/` - Database models and migrations
- `tests/` - Test suites (pytest)
- `docs/` - Additional documentation
```

**Where to start for common tasks:**

```markdown
## Common Entry Points

**Adding a new API endpoint:** Start in `src/api/routes.py`
**Adding database model:** Create migration in `src/db/migrations/`
**Business logic:** Add service in `src/services/`
**Writing tests:** Follow patterns in `tests/integration/`
```

### Valuable: Workflows and Processes

**Project-specific processes:**

```markdown
## Development Workflow

1. Create feature branch from `main`
2. Make changes (tests required)
3. Run `./scripts/validate.sh` (checks lint, tests, types)
4. Open PR (requires 2 approvals)
5. Merge (squash commits)

**Important:** Always run validation before pushing.
```

**Non-obvious conventions:**

```markdown
## Code Conventions

- All API responses use `Result<T, E>` pattern (no exceptions for control flow)
- Database transactions required for multi-step operations
- Feature flags via `config.features['flag-name']` (check before using)
```

### Helpful: Constraints and Gotchas

**Technical constraints:**

```markdown
## Constraints

- Python 3.11+ required (uses match statement)
- Database is PostgreSQL 14+ (uses jsonb features)
- Redis required for caching (not optional)
- API rate limited to 1000 req/min per API key
```

**Common pitfalls:**

```markdown
## Gotchas

- Don't import from `internal/` package outside monorepo
- Database migrations must be reversible (implement down migration)
- Async functions must use `asyncio.create_task()` not direct await for concurrency
```

## What to Exclude

### Don't Explain Basics

**❌ Don't:**
- Explain what REST APIs are
- Describe how async/await works
- Define what a database migration is
- Tutorial standard tools (pytest, git, Docker)

**✅ Do:**
- Explain *this project's* API conventions
- Note *this project's* async patterns
- Link to *this project's* migration tooling
- Document *this project's* tool configuration

### Don't Duplicate Code

**❌ Don't:**
```markdown
## API Structure

The User model has these fields:
- id: integer, primary key
- email: string, unique
- created_at: timestamp
...
```

Code is the source of truth. Claude can read it.

**✅ Do:**
```markdown
## API Structure

User model defined in `src/models/user.py`.

**Important:** Email is unique constraint. Use `find_by_email()` not manual query.
```

Navigation + project-specific insight.

### Don't Write What's Easily Discoverable

**❌ Don't:**
```markdown
## Testing

Test files are in the tests/ directory.
Use pytest to run tests.
```

Claude can find test files and knows pytest.

**✅ Do:**
```markdown
## Testing

Tests require Docker Compose running (`docker-compose up -d`).

Run tests: `./scripts/test.sh` (not pytest directly - handles setup).

**Coverage requirement:** 80% minimum (enforced in CI).
```

Non-obvious requirements and project-specific scripts.

## Structure and Format

### Recommended AGENTS.md Structure

```markdown
# [Project Name]

[1-2 paragraph overview of what this project does]

## Project Structure

[High-level directory layout]

## Key Workflows

[Common tasks and how to do them]

## Constraints and Requirements

[Important limitations or requirements]

## Additional Documentation

[Links to other docs]
```

Keep it concise. Target 100-300 lines. Not a complete manual.

### Use Progressive Disclosure

**AGENTS.md = Navigation Hub**

Instead of full content:
```markdown
## Architecture

See detailed architecture docs:
- [System Overview](docs/architecture/overview.md)
- [Data Flow](docs/architecture/data-flow.md)
- [Service Interactions](docs/architecture/services.md)
```

**Provide just enough context to navigate, link to details.**

### Format for Scannability

Use:
- **Bold** for emphasis
- Lists (bullet points) for multiple items
- Code blocks for commands/code
- Section headers for navigation
- Links to deeper documentation

Avoid:
- Long paragraphs
- Dense prose
- Excessive nesting
- Burying key information

**Claude scans documentation quickly. Make key info stand out.**

## Progressive Disclosure

Same principle as the skills system:

### Level 1: AGENTS.md (Overview)

**What:** Project overview, structure, key entry points (100-300 lines)

**When loaded:** Agent reads this first for context

**Content:**
- What the project does
- How it's organized
- Where to start for common tasks
- Links to detailed docs

### Level 2: Section Documentation (Details)

**What:** Detailed guides, architecture docs, API references (500-2000 lines each)

**When loaded:** Agent reads when needed for specific task

**Content:**
- Detailed technical information
- Comprehensive workflows
- Reference material

**Linked from AGENTS.md:**
```markdown
## Architecture

High-level: Microservices architecture with event-driven communication.

Details: [Architecture Documentation](docs/architecture/README.md)
```

### Level 3: Code (Source of Truth)

**What:** Actual implementation

**When loaded:** Agent reads when working on specific files or need precise details

**Content:**
- Source code
- Tests
- Configuration

**Referenced from docs:**
```markdown
## Authentication

Uses JWT tokens. Implementation in `src/auth/jwt.py`.
```

**Don't duplicate code in docs. Link to it.**

## Common Patterns

### Pattern 1: Minimal AGENTS.md

**For small projects (<10k lines):**

```markdown
# My CLI Tool

A command-line tool for processing JSON files.

## Structure

- `src/main.py` - Entry point
- `src/processor.py` - Core processing logic
- `tests/` - Test suite (pytest)

## Development

Install deps: `pip install -e .`
Run tests: `pytest`
Build: `python -m build`

## Constraints

Requires Python 3.10+ (uses structural pattern matching).
```

Minimal, just project-specific essentials.

### Pattern 2: Navigation-Heavy AGENTS.md

**For large projects (>100k lines):**

```markdown
# Large Platform

Multi-service platform for data processing.

## Codebase Structure

This is a monorepo:
- `services/` - Individual microservices (12 services)
- `libs/` - Shared libraries
- `infrastructure/` - Terraform, K8s configs
- `docs/` - Documentation

## Documentation Index

**Getting Started:**
- [Development Setup](docs/development/setup.md)
- [Architecture Overview](docs/architecture/overview.md)

**Working with Services:**
- [Service Development Guide](docs/services/development.md)
- [Inter-Service Communication](docs/architecture/communication.md)

**Operations:**
- [Deployment Process](docs/operations/deployment.md)
- [Runbooks](docs/operations/runbooks/)

## Quick Start Points

**Add new service:** Follow template in `services/_template/`
**Modify existing service:** Each service has README.md with specifics
**Deploy:** See [deployment docs](docs/operations/deployment.md)

## Constraints

- All services must expose `/health` endpoint
- Inter-service calls use gRPC (not HTTP)
- Database migrations managed centrally (not per-service)
```

Focus on navigation to detailed docs.

### Pattern 3: Workflow-Focused AGENTS.md

**For projects with specific processes:**

```markdown
# Research Platform

Data analysis platform for research teams.

## Common Workflows

### Adding a New Analysis Module

1. Create module in `analyses/[name]/`
2. Implement `BaseAnalysis` interface
3. Add tests in `tests/analyses/`
4. Register in `analyses/registry.py`
5. Document in `docs/analyses/[name].md`

See: [Analysis Development Guide](docs/development/analyses.md)

### Creating a Data Pipeline

1. Define pipeline spec (YAML) in `pipelines/specs/`
2. Implement operators in `pipelines/operators/`
3. Test with `pipeline test [spec]`
4. Deploy with `pipeline deploy [spec]`

See: [Pipeline Documentation](docs/pipelines/README.md)

### Running Research Queries

Use the `query` CLI: `query run [analysis] [dataset]`

Datasets in `datasets/` directory.
Available analyses: `query list-analyses`

## Important Constraints

- Datasets must be approved (privacy review) before use
- All analysis outputs logged for reproducibility
- Query costs estimated before execution (confirm if >$10)
```

Focuses on how work actually gets done.

### Pattern 4: Constraint-Heavy AGENTS.md

**For projects with many requirements:**

```markdown
# Financial System

## Critical Constraints

**Compliance:**
- All financial calculations use `Decimal` (never `float`)
- Money amounts stored as integer cents (not fractional dollars)
- All transactions must be auditable (logged immutably)

**Data Handling:**
- PII must be encrypted at rest (use `encrypt_pii()`)
- Logs must not contain PII (use redaction filters)
- Data retention: 7 years (automated via retention policies)

**Testing:**
- All monetary calculations require property-based tests
- Integration tests run against test bank sandbox
- Never use production API keys in tests

## Architecture

[Rest of documentation...]
```

Front-loads critical information.

## Examples

### Example 1: Simple Open Source Library

```markdown
# JSON Validator

A fast JSON schema validator for Python.

## Structure

- `json_validator/` - Main package
  - `validator.py` - Core validation logic
  - `schema.py` - Schema parsing
  - `errors.py` - Error types
- `tests/` - Test suite
- `benchmarks/` - Performance benchmarks

## Development

Install dev deps: `pip install -e ".[dev]"`
Run tests: `pytest`
Run benchmarks: `python -m benchmarks.run`

## Important

- Uses Rust extension for performance (requires Rust toolchain for dev)
- Schema caching enabled by default (disable with `cache=False`)
- Thread-safe for read, not for schema updates

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development guide.
```

### Example 2: Internal Microservice

```markdown
# User Service (AGENTS.md)

Manages user accounts, authentication, and profiles.

## Service Architecture

- REST API (port 8000)
- PostgreSQL database (users, sessions tables)
- Redis cache (session storage)
- Publishes events to Kafka (user-events topic)

## Code Structure

- `src/api/` - HTTP endpoints
- `src/services/` - Business logic
- `src/db/` - Database models and queries
- `src/events/` - Kafka event publishers

## Development

Start locally: `docker-compose up` (runs service + dependencies)
Run tests: `./scripts/test.sh`
API docs: http://localhost:8000/docs (Swagger UI)

## Integration Points

**Authentication:** Issues JWT tokens (validated by other services)
**User Updates:** Publishes `user.updated` event (other services listen)
**Profile Photos:** Stored in S3 (URLs returned by API)

## Constraints

- Passwords hashed with bcrypt (cost=12)
- JWTs expire after 24h (refresh required)
- Rate limit: 100 req/min per IP (authenticated: 1000 req/min)
- Email changes require verification (sends confirmation email)

## Deployment

See [Deployment Runbook](docs/deployment.md)

Production: https://users.internal.company.com
Staging: https://users-staging.internal.company.com
```

### Example 3: Monorepo Project

```markdown
# Platform Monorepo (AGENTS.md)

Monorepo for all platform services and libraries.

## Repository Structure

```
/
├── services/          # Individual microservices (see services/README.md)
│   ├── api-gateway/
│   ├── auth/
│   ├── users/
│   └── [...]
├── libs/              # Shared libraries
│   ├── common/        # Common utilities
│   ├── db/            # Database helpers
│   └── events/        # Event system
├── infrastructure/    # IaC and deployment
└── docs/              # Documentation
```

## Working in This Repo

**Each service is independent:** Has own README.md with service-specific details.

**Shared code in libs/:** Import as `from libs.common import ...`

**Build system:** Bazel (run `bazel build //services/[name]`)

**Testing:** Each service has own tests. Run all: `bazel test //...`

## Common Tasks

**Start service locally:** `cd services/[name] && ./dev.sh`
**Add dependency:** Update `WORKSPACE` and service's `BUILD` file
**Deploy service:** See [Deployment Guide](docs/deployment.md)
**Create new service:** `./scripts/new-service.sh [name]`

## Architecture

Services communicate via:
- **Synchronous:** gRPC (see [gRPC Guide](docs/grpc.md))
- **Asynchronous:** Kafka events (see [Events Guide](docs/events.md))

**No HTTP between services** (API Gateway handles external HTTP).

## Important Conventions

- Shared types in `libs/common/types/`
- Proto definitions in `proto/` (compiled per-service)
- All services expose `:8080/health` for k8s probes
- Logging format: JSON (structured logging lib in `libs/common/log`)

More details: [Developer Guide](docs/development.md)
```

## Best Practices Summary

1. **Assume intelligence** - Don't explain basics, focus on project-specifics
2. **Navigate, don't duplicate** - Link to details instead of copying
3. **Front-load constraints** - Important limitations at the top
4. **Be concise** - 100-300 lines for AGENTS.md
5. **Use progressive disclosure** - Overview → links to details → code
6. **Update with code** - Keep AGENTS.md current as project evolves
7. **Test with agent** - Ask Claude to do tasks, see what's missing

**Good agent documentation makes agents more effective with less context.**
