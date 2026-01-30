# Example: New Project Documentation Setup

Real-world walkthrough of setting up documentation for a new project from scratch.

## Scenario

**Project:** REST API service for managing customer subscriptions
**Team:** 5 developers, 1 product manager
**Repository:** New, starting from scratch
**Audience:** Internal team (initially), may become open source later

## Decision Process

### Step 1: Assess Needs

**Questions:**
- Who will read the documentation? → Team + future contributors
- How much documentation will we have? → Start small (5-10 docs), grow to 20-50
- How is it maintained? → Updated with code changes
- Where is it published? → Repository only (no separate website)

**Conclusions:**
- Start simple (don't over-engineer)
- Plan for growth (but don't build it yet)
- Internal focus initially (but write like it might be public)

### Step 2: Choose Organization Strategy

**Considered:**
1. **Flat structure** (just `docs/*.md`)
   - Pro: Simple, works for small doc count
   - Con: Might get messy as we grow

2. **Audience-based** (`docs/internal/`, `docs/public/`)
   - Pro: Ready for open source transition
   - Con: Premature - we're all internal now

3. **Hybrid** (flat for now, reorganize later)
   - Pro: Start simple, easy to refactor
   - Con: Will need migration work later

**Decision:** Start flat, add structure when we hit ~15 docs

See: [organization-strategies.md](../reference/organization-strategies.md)

### Step 3: Plan Document Lifecycle

**Temporary docs strategy:**
- Create `docs/notes/` for temporary content
- Date-prefix temporary docs: `YYYY-MM-DD-topic.md`
- Review quarterly, delete docs >3 months old

**Permanent docs:**
- Keep in root `docs/`
- Update with code changes
- Annual review for staleness

See: [lifecycle.md](../reference/lifecycle.md)

## Implementation

### Created Files

#### 1. README.md (Root)

```markdown
# Subscription API

REST API service for managing customer subscriptions.

## Quick Start

Prerequisites:
- Python 3.11+
- PostgreSQL 14+
- Redis 6+

Installation:
```bash
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your database credentials
python manage.py migrate
python manage.py runserver
```

API docs: http://localhost:8000/docs (Swagger UI)

## Documentation

- [Architecture Overview](docs/architecture.md)
- [API Reference](docs/api-reference.md) (generated from OpenAPI spec)
- [Development Guide](docs/development.md)
- [Deployment Guide](docs/deployment.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow.

## License

MIT
```

**Key points:**
- Immediate value (quick start)
- Links to detailed docs
- Clear structure

#### 2. AGENTS.md

```markdown
# Subscription API

REST API service for managing customer subscriptions (create, update, cancel, billing).

## Structure

```
/
├── src/
│   ├── api/          # API endpoints (FastAPI)
│   ├── models/       # Database models (SQLAlchemy)
│   ├── services/     # Business logic
│   └── utils/        # Helpers
├── tests/            # Test suite (pytest)
├── migrations/       # Database migrations (Alembic)
└── docs/             # Documentation
```

## Development Workflow

1. Create feature branch from `main`
2. Implement changes (TDD: tests first)
3. Run validation: `./scripts/validate.sh` (lint, type-check, tests)
4. Open PR (requires 1 approval)
5. Merge (squash commits)

## Key Conventions

- All API responses use `Result<T, E>` pattern (see `src/utils/result.py`)
- Database changes require migration (use `alembic revision`)
- Feature flags via `src/config.py` (check before using features)
- Async endpoints only (all routes use `async def`)

## Testing

Start test dependencies: `docker-compose up -d postgres redis`
Run tests: `pytest`
Coverage requirement: 80% minimum (enforced in CI)

## Documentation

- [Architecture](docs/architecture.md) - System design, data flow
- [API Reference](docs/api-reference.md) - Endpoint documentation
- [Development](docs/development.md) - Setup, workflows, conventions
- [Deployment](docs/deployment.md) - How to deploy to production
```

**Key points:**
- Project-specific context (not generic Python/FastAPI info)
- Navigation to key locations
- Important conventions
- Entry points for common tasks

See: [agent-docs.md](../reference/agent-docs.md)

#### 3. CONTRIBUTING.md

```markdown
# Contributing Guide

## Development Setup

1. **Prerequisites**
   - Python 3.11+
   - Docker (for dependencies)

2. **Install dependencies**
   ```bash
   pip install -r requirements-dev.txt
   ```

3. **Start services**
   ```bash
   docker-compose up -d
   ```

4. **Run migrations**
   ```bash
   alembic upgrade head
   ```

5. **Verify setup**
   ```bash
   pytest
   ```

## Development Workflow

### Branching

- `main` - production-ready code
- `feature/[name]` - new features
- `fix/[name]` - bug fixes

### Making Changes

1. Create branch from `main`
2. Write tests first (TDD)
3. Implement feature/fix
4. Run `./scripts/validate.sh` (must pass)
5. Open PR with description

### Pull Requests

**PR Title:** `type: description`
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code refactoring
- `test:` test additions/changes

**PR Requirements:**
- Tests pass (80% coverage minimum)
- No lint errors
- Type checking passes
- 1 approval required

### Commit Messages

Follow conventional commits:
```
feat: add subscription cancellation endpoint

Implements immediate cancellation and end-of-period cancellation.
Includes tests for both scenarios.

Fixes #123
```

## Code Conventions

- Follow PEP 8 (enforced by `black` and `ruff`)
- Type hints required (checked by `mypy`)
- Docstrings for public functions (Google style)
- Async all the way (no sync database calls)

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test
pytest tests/test_subscriptions.py::test_create_subscription
```

## Documentation

Update documentation when:
- Adding API endpoints → Update OpenAPI spec (auto-generates docs)
- Changing architecture → Update `docs/architecture.md`
- Adding dependencies → Update README.md
- Changing workflows → Update this file

## Questions?

Ask in #api-dev Slack channel or open an issue.
```

**Key points:**
- Clear setup instructions
- Workflow expectations
- Contribution requirements

#### 4. docs/architecture.md

```markdown
# Architecture Overview

## System Design

**Stack:**
- **API:** FastAPI (Python 3.11+)
- **Database:** PostgreSQL 14 (SQLAlchemy ORM)
- **Cache:** Redis 6 (for session storage, rate limiting)
- **Queue:** Celery + Redis (background jobs)

**Deployment:** Docker containers on AWS ECS

## Directory Structure

```
src/
├── api/              # API layer
│   ├── routes/       # Endpoint definitions
│   ├── schemas/      # Pydantic request/response models
│   └── dependencies/ # FastAPI dependency injection
├── services/         # Business logic layer
│   ├── subscription.py
│   ├── billing.py
│   └── notification.py
├── models/           # Data layer
│   └── database.py   # SQLAlchemy models
├── jobs/             # Background jobs (Celery tasks)
└── utils/            # Shared utilities
```

## Request Flow

1. **Request** → API endpoint (`src/api/routes/`)
2. **Validation** → Pydantic schema (`src/api/schemas/`)
3. **Business Logic** → Service layer (`src/services/`)
4. **Database** → SQLAlchemy models (`src/models/`)
5. **Response** → Pydantic schema serialization

**No business logic in routes** - routes delegate to services.

## Data Model

**Core entities:**
- `Customer` - Customer accounts
- `Subscription` - Active subscriptions
- `Plan` - Subscription plans (pricing, features)
- `Invoice` - Billing invoices
- `Payment` - Payment records

See: Database schema diagram (TODO: add diagram)

## Background Jobs

**Celery tasks for:**
- Billing invoice generation (daily)
- Subscription renewal checks (hourly)
- Email notifications (immediate)
- Usage metric aggregation (hourly)

**Queue:** Redis-backed Celery

## External Services

- **Stripe** - Payment processing
- **SendGrid** - Email delivery
- **Datadog** - Monitoring and logging

## Deployment

**Environments:**
- `development` - Local Docker Compose
- `staging` - AWS ECS (staging.api.internal.company.com)
- `production` - AWS ECS (api.company.com)

See: [deployment.md](deployment.md)

## Key Design Decisions

**Why FastAPI?**
- Native async support
- Automatic OpenAPI docs
- Type safety with Pydantic

**Why PostgreSQL?**
- ACID guarantees for billing
- JSON support for flexible metadata
- Full-text search capabilities

**Why Celery?**
- Robust background job processing
- Scheduling support
- Team familiarity
```

**Key points:**
- High-level overview (not exhaustive details)
- Rationale for key choices
- Links to more detailed docs

#### 5. docs/notes/README.md

```markdown
# Temporary Notes

This directory contains temporary documentation:
- Investigation notes
- Meeting notes
- Brainstorming docs
- WIP drafts

## Lifecycle Policy

**Review:** Quarterly (Jan, Apr, Jul, Oct)
**Retention:** 3 months default
**Action:** Delete or promote to permanent documentation

## Naming Convention

Use date prefix: `YYYY-MM-DD-topic.md`

Example: `2026-01-30-stripe-integration-research.md`

## What to Put Here

✅ Temporary content:
- Investigation results
- Meeting decisions (extract to permanent docs later)
- Draft proposals (promote to RFC if significant)

❌ Permanent content:
- Architecture decisions (put in `docs/architecture.md`)
- Process documentation (put in CONTRIBUTING.md)
- API documentation (auto-generated)
```

See: [lifecycle.md](../reference/lifecycle.md)

### Directory Structure

```
subscription-api/
├── README.md                    # Project overview, quick start
├── AGENTS.md                    # Agent navigation and context
├── CONTRIBUTING.md              # Development workflow
├── LICENSE                      # MIT license
├── .env.example                 # Environment variable template
├── requirements.txt             # Python dependencies
├── requirements-dev.txt         # Dev dependencies
├── docker-compose.yml           # Local development services
├── src/                         # Source code
├── tests/                       # Test suite
├── migrations/                  # Database migrations
├── scripts/                     # Utility scripts
│   └── validate.sh              # Lint, type-check, test
└── docs/                        # Documentation
    ├── architecture.md          # System design
    ├── api-reference.md         # API docs (generated)
    ├── development.md           # Dev guide
    ├── deployment.md            # Deployment guide
    └── notes/                   # Temporary docs
        └── README.md            # Notes lifecycle policy
```

## Timeline

**Day 1: Essentials**
- [x] Create README.md (quick start, navigation)
- [x] Create AGENTS.md (project context)
- [x] Create CONTRIBUTING.md (workflow)
- [x] Create docs/ directory

**Week 1: Core Documentation**
- [x] Write architecture.md (system overview)
- [x] Set up API documentation (OpenAPI/Swagger)
- [x] Document development workflow
- [x] Create temporary notes directory with policy

**Week 2-4: As Needed**
- [ ] Add deployment documentation (when deploying)
- [ ] Add troubleshooting guide (as issues arise)
- [ ] Add runbooks (for operations)

## Lessons Learned

### What Worked

✅ **Started minimal** - Didn't over-engineer early
- Created only essential docs initially
- Added more as needs emerged

✅ **AGENTS.md immediately useful** - Team uses it
- New team member onboarding faster
- AI assistants provide better help with context

✅ **Clear temporary docs policy** - No clutter
- Quarterly cleanup simple
- Team knows where to put drafts

### What We'd Change

⚠️ **Should have added runbooks sooner**
- Waited until first production incident
- Would have helped with preparation

⚠️ **API documentation automation delayed**
- Hand-wrote API docs initially (tedious, got stale)
- Should have set up OpenAPI from day 1

## Future Plans

**When we reach ~15-20 docs:**
- Reorganize into `docs/internal/` and `docs/public/` (preparing for open source)
- Add RFC process for major changes
- Consider documentation website (if we open source)

**Not rushing:** Will reorganize when pain points emerge, not before.

## Summary

**Total time investment:** ~4 hours initial setup, ~1 hour/week maintenance

**Value:**
- Faster onboarding
- Better AI assistance
- Preserved decisions
- Clear workflows

**Key insight:** Start simple, evolve based on actual needs (not anticipated needs).
