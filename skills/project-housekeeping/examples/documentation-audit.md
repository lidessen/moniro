# Example: Documentation Audit

Real-world walkthrough of auditing and reorganizing existing documentation for a mature project.

## Scenario

**Project:** E-commerce platform (3 years old)
**Team:** 15 developers across 3 teams
**Problem:** Documentation sprawling, hard to find, outdated content mixed with current
**Goal:** Clean up, reorganize, establish maintenance process

## Initial Assessment

### Inventory

```bash
$ find . -name "*.md" | wc -l
147

$ find . -name "*.md" -mtime +365 | wc -l  # Not modified in 1+ year
43
```

**Locations found:**
```
README.md
docs/ (87 files)
wiki/ (git submodule, 34 files)
services/*/README.md (12 files)
services/*/docs/ (14 files scattered)
```

**Issues identified:**
1. **Scattered** - Documentation in 4+ locations
2. **Stale** - 43 files not updated in over a year
3. **Duplicates** - Same topics in multiple places
4. **No organization** - Flat `docs/` directory with 87 files
5. **No index** - No AGENTS.md or clear entry points
6. **Orphaned** - Wiki hasn't been updated in 6 months

### Stakeholder Input

**Interviewed team:**
- "I never know where to look for docs"
- "Wiki is outdated, but sometimes has useful info"
- "I just grep the repo when I need something"
- "Service READMEs are hit-or-miss quality"

**Pain points:**
- Discoverability (can't find docs)
- Trust (is this current?)
- Duplication (which version is right?)

## Audit Process

### Week 1: Classification

Created spreadsheet: [Doc Inventory](https://docs.google.com/spreadsheets/d/xxx)

**Columns:**
- Filepath
- Last modified
- Topic
- Audience (internal/public)
- Type (architecture/guide/reference/process)
- Status (current/outdated/duplicate)
- Action (keep/update/archive/delete/merge)
- Owner

**Classified all 147 docs** (took ~6 hours with team help)

**Results:**
- **Keep as-is:** 34 docs (current, good quality)
- **Update:** 27 docs (salvageable with updates)
- **Archive:** 18 docs (historical value, no longer current)
- **Delete:** 41 docs (outdated, no value)
- **Merge:** 15 docs (consolidate duplicates into 6 docs)
- **Migrate:** 12 docs (move wiki content to repo)

### Week 2: Organization Design

**Decided on structure:**

**Reasoning:**
- Internal vs public matters (compliance, publication)
- Team already thinks in terms of "user docs" vs "team docs"
- Growing number of docs (147 → reorganize by type within audience)

**New structure:**
```
docs/
├── public/              # User-facing (published to website)
│   ├── getting-started.md
│   ├── guides/
│   ├── api/
│   └── faq.md
├── internal/            # Team-only
│   ├── architecture/
│   ├── operations/
│   ├── processes/
│   └── notes/          # Temporary (quarterly cleanup)
└── archive/             # Historical (not actively maintained)
    └── YYYY-MM-name.md
```

**Root files:**
- README.md - Project overview, quick start
- AGENTS.md - Agent navigation (new)
- CONTRIBUTING.md - Dev workflow
- CHANGELOG.md - Release notes

**Service-level docs:**
- Each service keeps README.md (service-specific info only)
- General architecture goes in `docs/internal/architecture/`

**Wiki retirement:**
- Migrate useful content to `docs/internal/`
- Archive wiki as read-only
- Add deprecation notice in wiki

See: [organization-strategies.md](../reference/organization-strategies.md)

### Week 3: Execution

#### Day 1-2: Create Structure

```bash
mkdir -p docs/{public,internal,archive}
mkdir -p docs/public/{guides,api}
mkdir -p docs/internal/{architecture,operations,processes,notes}
```

Created placeholder READMEs explaining each directory's purpose.

#### Day 3-5: Move Current Docs

**Strategy:** Move first, update later (iterative approach)

```bash
# Example moves
git mv docs/api-authentication.md docs/public/guides/
git mv docs/deployment-runbook.md docs/internal/operations/
git mv docs/service-architecture.md docs/internal/architecture/
```

**Updated internal links** (scripted with sed, then manual verification)

**Result:** 61 docs moved to new structure (34 keep + 27 update)

#### Day 6-7: Archive Old Content

```bash
# Archive docs with date prefix
git mv docs/old-api-v1.md docs/archive/2023-06-api-v1.md
git mv docs/deprecated-auth.md docs/archive/2024-01-deprecated-auth.md
```

**Added archive notice** to each:
```markdown
---
ARCHIVED: 2026-01-30
Reason: Replaced by new API v2 documentation
See: docs/public/api/reference.md
---

[Original content]
```

**Result:** 18 docs archived

#### Day 8-9: Delete Obsolete Content

**Deleted after team confirmation:**
- 23 meeting notes from 2023-2024 (no lasting value)
- 12 draft docs never completed
- 6 duplicate copies

**Result:** 41 docs deleted

**Preserved in git history** (can recover if needed)

#### Day 10: Merge Duplicates

**Example consolidation:**
- `deployment-dev.md`, `deployment-staging.md`, `deployment-prod.md`
- → Single `docs/internal/operations/deployment.md` with sections per environment

**Result:** 15 docs consolidated into 6

### Week 4: New Index Files

#### Created AGENTS.md

```markdown
# E-Commerce Platform

Multi-service platform for online retail operations.

## Structure

This is a monorepo with 8 microservices:

- `services/api/` - Main REST API
- `services/auth/` - Authentication service
- `services/catalog/` - Product catalog
- `services/orders/` - Order processing
- `services/payments/` - Payment processing
- `services/fulfillment/` - Shipping and fulfillment
- `services/notifications/` - Email/SMS notifications
- `services/analytics/` - Data analytics

Shared code in `libs/`.

## Documentation

**Getting Started:**
- [Development Setup](docs/internal/processes/development-setup.md)
- [Architecture Overview](docs/internal/architecture/overview.md)

**For Users:**
- [API Documentation](docs/public/api/) (also at api-docs.company.com)
- [Integration Guides](docs/public/guides/)

**For Operators:**
- [Deployment Runbooks](docs/internal/operations/)
- [Monitoring & Alerts](docs/internal/operations/monitoring.md)

## Development Workflow

1. Create feature branch
2. Implement changes (service-specific conventions in each service/README.md)
3. Run tests: `./scripts/test.sh [service]`
4. Open PR (requires 2 approvals)
5. Deploy via GitLab CI/CD

See: [Contributing Guide](CONTRIBUTING.md)

## Key Conventions

- Services communicate via gRPC (not HTTP)
- Shared types in `libs/common/proto/`
- Database migrations per-service (no shared DB)
- Feature flags via ConfigCat (check before using features)

## Important Constraints

- All payments must be idempotent (use idempotency keys)
- PII must be encrypted (use `libs/security/encryption.py`)
- API rate limits: 1000 req/min per API key
- Multi-tenancy: tenant ID required in all service calls
```

See: [agent-docs.md](../reference/agent-docs.md)

#### Updated README.md

**Before:** 300 lines mixing quick start, architecture, deployment, everything

**After:** 80 lines focused on essentials, linking to detailed docs

```markdown
# E-Commerce Platform

Open-source e-commerce platform for modern retail.

## Quick Start

[Installation steps]

## Documentation

Full documentation: [docs/](docs/)

- **Users:** [API Docs](docs/public/api/), [Guides](docs/public/guides/)
- **Developers:** [Architecture](docs/internal/architecture/), [Contributing](CONTRIBUTING.md)
- **Operators:** [Deployment](docs/internal/operations/deployment.md), [Runbooks](docs/internal/operations/)

## License

Apache 2.0
```

#### Created docs/internal/notes/README.md

Lifecycle policy for temporary documentation:

```markdown
# Internal Notes

Temporary documentation and work-in-progress content.

## Lifecycle Policy

**Review:** Quarterly (first Monday of Jan, Apr, Jul, Oct)
**Retention:** 3 months default
**Action:** Extract valuable information to permanent docs, delete rest

## What Goes Here

- Investigation notes
- Meeting notes (consolidate decisions to architecture docs)
- Draft proposals (promote to RFC if significant)
- Project-specific exploration

## Naming Convention

Date prefix: `YYYY-MM-DD-topic.md`

Next review: 2026-04-01
```

See: [lifecycle.md](../reference/lifecycle.md)

### Week 5: Migrate Wiki Content

**Strategy:** Copy useful content, archive wiki

1. **Identified valuable wiki pages:** 8 out of 34
2. **Migrated to docs/internal/:**
   - Architecture decision rationale → `architecture/decisions/`
   - Operations guides → `operations/`
   - Process documentation → `processes/`
3. **Added deprecation notice to wiki:**
   ```markdown
   # ⚠️ THIS WIKI IS DEPRECATED

   Documentation has moved to the main repository: [docs/](../docs/)

   This wiki is now read-only and will be archived on 2026-03-01.
   ```
4. **Updated all links** pointing to wiki

## Outcomes

### Before vs After

**Before:**
```
README.md (300 lines, everything)
docs/ (87 files, flat, no organization)
wiki/ (34 files, stale)
Service READMEs (inconsistent)
Total: 147 docs across 4 locations
```

**After:**
```
README.md (80 lines, essentials + navigation)
AGENTS.md (new, agent context)
docs/
  ├── public/ (21 files, organized by type)
  ├── internal/ (35 files, organized by type)
  └── archive/ (18 files, historical)
Service READMEs (standardized, service-specific only)
Total: 74 active docs in 1 location + 18 archived
```

**Reduction:** 147 → 92 docs (41 deleted, 15 merged)
**Active:** 74 docs (well-organized)
**Archived:** 18 docs (preserved but not maintained)

### Metrics

**Findability:**
- Before: "I just grep" (no clear entry point)
- After: AGENTS.md + directory structure

**Trust:**
- Before: 43 docs not updated in 1+ year
- After: 0 docs (all reviewed, outdated ones archived/deleted)

**Duplication:**
- Before: Multiple docs on same topic
- After: Single source of truth per topic

**Maintenance:**
- Established quarterly review process for temporary docs
- Clear ownership (CODEOWNERS file added)
- Documentation updates part of PR checklist

## Ongoing Maintenance

### Quarterly Documentation Audit

**Process established:**

**Week before audit:**
1. Bot posts reminder in #engineering Slack
2. Create audit checklist issue

**Audit week:**
1. Review `docs/internal/notes/` (delete expired content)
2. Check for docs not updated in 6+ months (verify still current)
3. Fix broken links (automated check via CI)
4. Update AGENTS.md if structure changed

**After audit:**
1. Post summary in team meeting
2. Update next audit date

**Time commitment:** ~4 hours per quarter

### Continuous Maintenance

**Integrated into workflow:**

**PR template includes:**
```markdown
## Documentation

- [ ] Updated relevant documentation
- [ ] Added/updated API docs if API changed
- [ ] Updated AGENTS.md if major architectural change
```

**Pre-commit hook:**
```bash
# Checks for broken internal links
./scripts/check-docs-links.sh
```

**CI checks:**
- Markdown linting
- Link validation
- OpenAPI spec validation

## Lessons Learned

### What Worked

✅ **Iterative approach** - Move first, update later
- Didn't try to perfect everything at once
- Momentum maintained

✅ **Team involvement** - Distributed classification
- Each team classified their domain's docs
- Faster and better quality (they know what's current)

✅ **Clear criteria for deletion** - Not precious about old content
- "Would we miss this?" test
- Git history preserves everything (can recover)

✅ **Retire wiki cleanly** - Not left lingering
- Clear deprecation timeline
- Migration path provided
- Archive wiki (don't delete, for reference)

✅ **Establish ongoing process** - Not one-time cleanup
- Quarterly audits scheduled
- PR checklist includes docs
- CI automation for link checking

### Challenges

⚠️ **Link updates tedious** - Scripted mostly worked
- Automated with sed, but manual verification needed
- Some links needed contextual updates

⚠️ **Team skepticism initially** - "Another reorg?"
- Showed clear before/after
- Quick wins (AGENTS.md immediately useful)
- Proved value with better findability

⚠️ **Deciding what to delete** - Some attached to old docs
- Reminded: git history preserves
- Focus on "is this useful now?"
- Archive if historical value (don't delete)

### What We'd Change

**Wish we'd done sooner:**
- Established temporary docs policy earlier (would have prevented accumulation)
- Created AGENTS.md when project started
- Set up link checking in CI from day 1

**Would do differently:**
- Involve product/design earlier (user docs affected them)
- Do wiki migration first (less to move overall)
- Create comparison doc showing old vs new structure (helped communication)

## Cost-Benefit Analysis

**Time invested:**
- Week 1: 6 hours (classification)
- Week 2: 4 hours (design new structure)
- Week 3: 20 hours (execution - moving, updating, deleting)
- Week 4: 6 hours (creating index files)
- Week 5: 8 hours (wiki migration)

**Total:** ~44 hours (across team, not single person)

**Benefits:**
- Faster onboarding (new dev finds docs easily)
- Better AI assistance (AGENTS.md context)
- Reduced confusion (single source of truth)
- Active maintenance (quarterly process)
- Higher trust (no stale content)

**ROI:** Team of 15 developers, even saving 1 hour per person per month = 15 hours/month saved

**Payback period:** ~3 months

## Recommendations

### For Similar Audits

1. **Start with inventory** - Can't fix what you don't know
   - Automated counting
   - Manual classification with team
   - Shared spreadsheet for tracking

2. **Decide on principles first** - Not just moving files
   - What's your organizing principle? (audience, type, feature)
   - Where do temporary docs go?
   - What's the lifecycle policy?

3. **Communicate the why** - Get team buy-in
   - Share pain points
   - Show before/after vision
   - Quick wins build momentum

4. **Delete aggressively** - Less is more
   - Git history preserves
   - Archive if uncertain
   - "Would we miss this?" test

5. **Establish ongoing process** - Prevent re-accumulation
   - Quarterly audits
   - PR checklist includes docs
   - Automated checks (links, etc.)

6. **Make it discoverable** - Organization alone isn't enough
   - Create AGENTS.md (navigation hub)
   - Update README.md
   - Clear directory structure

### For Prevention

**Starting a new project?**
- Create AGENTS.md from day 1
- Establish temporary docs policy early
- Keep it simple initially (don't over-organize)
- See: [new-project-setup.md](new-project-setup.md)

**Existing project?**
- Quarterly reviews before clutter accumulates
- Delete temporary docs regularly
- One source of truth per topic
- This audit is recoverable (not prevention, but example)

## Summary

**Documentation audit transformed:**
- 147 scattered, stale docs
- → 74 organized, current docs
- + Clear ownership and maintenance process

**Key insight:** Organization without maintenance fails. Establish ongoing process, not one-time cleanup.

**Living documentation requires living processes.**
