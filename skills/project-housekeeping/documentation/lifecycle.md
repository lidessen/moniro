# Document Lifecycle Management

Strategies for managing documentation through its lifecycle - from creation to archival or deletion. Keeps documentation "alive" and prevents accumulation of outdated content.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Lifecycle Stages](#lifecycle-stages)
- [Management Strategies](#management-strategies)
- [Cleanup Policies](#cleanup-policies)
- [Audit Workflows](#audit-workflows)
- [Common Patterns](#common-patterns)

## Core Concepts

### Living vs Dead Documentation

**Living Documentation** is actively maintained and trusted:
- Updated when code/process changes
- Reviewed regularly
- Clear ownership
- Easy to find and navigate
- Integrated into team workflows

**Dead Documentation** accumulates and creates confusion:
- Outdated information that misleads
- No clear owner or maintenance
- Buried and forgotten
- Duplicated in multiple places
- Unclear which version is current

**Lifecycle management keeps documentation living.**

### The Documentation Decay Problem

Documentation naturally decays over time:
1. **Day 0:** Accurate and complete
2. **Week 1:** Still mostly accurate
3. **Month 1:** Some outdated sections
4. **Month 6:** Significant inaccuracies
5. **Year 1:** More misleading than helpful

**Without lifecycle management, all documentation trends toward dead.**

### Types by Intended Lifespan

**Permanent** - Evolves with the project
- Architecture decisions (ADRs)
- API documentation
- User guides
- Process documentation

**Temporary** - Time-bounded usefulness
- Meeting notes
- Investigation notes
- Brainstorming docs
- Project-specific exploration

**Ephemeral** - Very short lifespan
- Daily standup notes
- Quick scratch notes
- Debugging logs
- WIP drafts

**Different lifespans require different management strategies.**

## Lifecycle Stages

### Stage 1: Creation

**When to create documentation:**
- ✅ Capturing non-obvious design decisions
- ✅ Documenting public APIs or interfaces
- ✅ Recording investigation results
- ✅ Standardizing processes
- ❌ Explaining self-evident code
- ❌ Duplicating information that exists elsewhere

**Creation best practices:**
- Tag with creation date (especially for temporary docs)
- Identify intended audience
- Set expected lifespan if temporary
- Link to related code/docs
- Assign owner (person or team)

**Example frontmatter for temporary docs:**
```markdown
---
created: 2026-01-30
author: @username
type: investigation
expires: 2026-04-30
related: #issue-123
---
```

### Stage 2: Active Use

**Characteristics:**
- Referenced regularly
- Updated with changes
- Clear current owner
- Linked from index files (README, AGENTS.md)

**Maintenance triggers:**
- Code changes → Update related docs
- Process changes → Update process docs
- Bug found in docs → Fix immediately
- New team member confused → Improve clarity

**Signs of healthy active docs:**
- Recent git commits
- Linked from navigation
- No conflicting versions
- Owner responds to questions

### Stage 3: Declining Use

**Warning signs:**
- Last updated >6 months ago
- Rarely referenced
- Owner left team
- Replaced by newer documentation

**Decision point:** Refresh or retire?

**Refresh if:**
- Still fundamentally useful
- Can be updated with reasonable effort
- Fills a documentation gap

**Retire if:**
- No longer relevant
- Superseded by newer docs
- Would require complete rewrite

### Stage 4: Archive or Delete

**Archive** - Keep for historical reference
- Accepted RFCs (part of project history)
- Major architecture decisions
- Deprecated features (for legacy support)
- Post-mortems and incident reports

**Delete** - Remove completely
- Outdated temporary docs
- Superseded drafts
- Obsolete process docs
- Misleading or incorrect content

**Archive best practices:**
- Move to designated archive location
- Add "ARCHIVED" label or prefix
- Link to replacement documentation
- Include archive date and reason

**Example:**
```
docs/archive/2025-Q4-old-api-guide.md

---
ARCHIVED: 2026-01-15
Reason: Replaced by new API v2 documentation
See: docs/api/v2-reference.md
---
```

## Management Strategies

### Strategy 1: Expiration Dates (Explicit Temporary)

**Pattern:** Set explicit expiration for temporary documentation

**Implementation:**
```markdown
---
created: 2026-01-30
expires: 2026-02-28
purpose: Q1 planning exploration
---
```

**Process:**
- Quarterly review of expired docs
- Decision: delete, extend, or promote to permanent
- Automated reminders (calendar, bot, CI check)

**Good for:**
- Meeting notes
- Investigation notes
- Project-specific drafts

### Strategy 2: Last Modified Triggers

**Pattern:** Review docs not updated in X months

**Implementation:**
```bash
# Find docs not modified in 6 months
find docs/ -name "*.md" -mtime +180
```

**Process:**
- Quarterly or bi-annual audit
- Review each old doc
- Update, archive, or delete

**Good for:**
- Process documentation
- Technical guides
- Architecture docs

### Strategy 3: Ownership-Based

**Pattern:** Each document has a clear owner responsible for maintenance

**Implementation:**
- CODEOWNERS file for documentation
- Frontmatter with owner tag
- Team assignment in directory structure

**Process:**
- Owners review their docs on schedule
- Handoff protocol when owner changes
- Orphaned docs flagged for review

**Good for:**
- Large teams
- Distributed documentation
- Long-lived projects

### Strategy 4: Event-Triggered Updates

**Pattern:** Documentation updated when specific events occur

**Events:**
- Code release → Update changelog, API docs
- Architecture change → Update ADR, diagrams
- Process change → Update contributing guide
- Incident → Create post-mortem
- Quarterly → Review temporary docs

**Implementation:**
- Checklist in release process
- PR templates include "docs updated?"
- CI checks for doc-code sync
- Calendar reminders for periodic reviews

**Good for:**
- Documentation tied to releases
- Process documentation
- Compliance requirements

### Strategy 5: Wiki + Repo Hybrid

**Pattern:** Different lifecycle management for different doc types

**Example:**
- **Repo (strict lifecycle):** Architecture, API docs, RFCs
- **Wiki (relaxed lifecycle):** Team notes, how-tos, brainstorming
- **External (separate):** User-facing docs on website

**Process:**
- Repo docs reviewed with code
- Wiki docs reviewed quarterly
- Migration path from wiki to repo for important content

**Good for:**
- Large organizations
- Multiple documentation needs
- Different stakeholder groups

## Cleanup Policies

### Policy Template

Define clear rules for your project:

```markdown
## Documentation Cleanup Policy

### Temporary Documents (docs/notes/)
- **Review frequency:** Quarterly
- **Retention:** 3 months default
- **Action:** Delete or promote to permanent

### Investigation Notes
- **Review trigger:** Project completion
- **Action:** Extract learnings to permanent docs, delete rest

### Meeting Notes
- **Retention:** 1 quarter
- **Action:** Consolidate important decisions into decision log, delete rest

### Draft RFCs
- **Review trigger:** 2 weeks of inactivity
- **Action:** Promote to active RFC, continue draft, or close

### Archived Documents
- **Retention:** Indefinite (unless storage constrained)
- **Location:** docs/archive/ or separate archive repo
```

### Sample Policies by Document Type

**Meeting Notes**
- Keep: 3 months
- Process: Extract action items → permanent docs, delete notes
- Exception: Major decisions → convert to ADR

**Investigation/Exploration**
- Keep: Until project complete
- Process: Extract findings → knowledge base, delete scratch work
- Exception: Novel techniques → convert to guide

**Draft Proposals (RFCs, ADRs)**
- Keep: 2 weeks of inactivity
- Process: Accept, reject, or request updates
- Accepted: Move to permanent RFCs
- Rejected: Archive with reason

**Brainstorming/Planning**
- Keep: Sprint/project duration
- Process: Convert to tasks/issues, delete brainstorming
- Exception: Strategic decisions → archive for reference

**Runbooks/Procedures**
- Keep: Until process changes
- Process: Update when process changes
- Outdated: Archive with link to replacement

## Audit Workflows

### Quarterly Documentation Audit

**Goal:** Remove outdated docs, update stale content, identify gaps

**Process:**

1. **Inventory** (Week 1)
   ```bash
   # List all docs with last modified date
   find docs/ -name "*.md" -exec ls -lt {} +

   # Find old docs (>6 months)
   find docs/ -name "*.md" -mtime +180
   ```

2. **Classify** (Week 2)
   - Active and current → Keep, update if needed
   - Old but still useful → Refresh
   - Outdated/superseded → Archive or delete
   - Temporary past expiration → Delete or extend

3. **Act** (Week 3)
   - Update stale content
   - Archive historical docs
   - Delete obsolete content
   - Fix broken links
   - Update index files (README, AGENTS.md)

4. **Document** (Week 4)
   - Log what was archived/deleted
   - Update documentation policy if needed
   - Share summary with team

### Continuous Audit (Lightweight)

**Pattern:** Small regular maintenance instead of big quarterly cleanup

**Daily/Weekly:**
- Update docs when code changes (part of PR process)
- Delete personal scratch notes at end of week

**Monthly:**
- Review temporary docs folder
- Delete expired investigation notes
- Check for broken links

**Quarterly:**
- Full inventory and classification
- Archive old content
- Update navigation and indexes

### Automated Checks

**CI Checks (Optional):**
```yaml
# .github/workflows/docs-check.yml
- Check for broken internal links
- Flag docs not updated in >1 year
- Validate frontmatter (expiration dates, owners)
- Check for TODO/FIXME in docs
```

**Git Hooks:**
```bash
# pre-commit hook
# Remind to update docs if code changed in certain areas
if git diff --cached | grep -q "src/api/"; then
  echo "Reminder: Update API documentation if needed"
fi
```

**Bots/Automation:**
- Slack/email reminder for expired docs
- GitHub issue created for orphaned docs
- Weekly summary of stale documentation

## Common Patterns

### Pattern 1: Date-Prefixed Temporary Docs

**Structure:**
```
docs/notes/
├── 2026-01-15-oauth-investigation.md
├── 2026-01-20-database-migration-planning.md
└── 2026-01-30-performance-analysis.md
```

**Cleanup:**
```bash
# Delete notes older than 3 months
find docs/notes/ -name "*.md" -mtime +90 -delete
```

**Benefits:**
- Sortable by date
- Easy to identify old content
- Obvious candidates for cleanup

### Pattern 2: Status Tags in Filename

**Structure:**
```
rfcs/
├── DRAFT-0042-new-feature.md
├── ACCEPTED-0023-api-redesign.md
├── IMPLEMENTED-0015-caching-layer.md
└── REJECTED-0038-alternative-approach.md
```

**Lifecycle:**
1. Create as DRAFT
2. Review and decide → rename to ACCEPTED/REJECTED
3. After implementation → rename to IMPLEMENTED
4. REJECTED → move to archive after 1 year

**Benefits:**
- Status visible in file listing
- Easy to filter by status
- Clear lifecycle progression

### Pattern 3: Separate Archive Directory

**Structure:**
```
docs/
├── current/
│   ├── guides/
│   └── reference/
└── archive/
    ├── 2025/
    │   └── old-api-guide.md
    └── 2024/
        └── deprecated-feature.md
```

**Benefits:**
- Clean separation
- Can delete entire archive if needed
- Easy to ignore in searches

### Pattern 4: In-Place Archival Marker

**Instead of moving, mark as archived:**

```markdown
---
status: ARCHIVED
archived-date: 2026-01-15
replacement: docs/new-api-guide.md
---

# [ARCHIVED] Old API Guide

**⚠️ This document is archived and may contain outdated information.**

**See:** [New API Guide](new-api-guide.md)

---

[Original content preserved below]
```

**Benefits:**
- Links don't break
- Historical context preserved
- Clear warning for readers

### Pattern 5: Documentation Changelog

**Track major documentation changes:**

```markdown
# Documentation Changelog

## 2026-01-30
- Archived old deployment guide, replaced with Kubernetes guide
- Updated API reference for v2.0 release
- Deleted Q4 2025 meeting notes

## 2026-01-15
- Added troubleshooting guide for common issues
- Updated contributing guide with new PR template
- Archived legacy authentication docs
```

**Benefits:**
- Visibility into documentation maintenance
- Helps with audits
- Shows documentation is actively managed

## Best Practices

### 1. Make Lifecycle Part of Creation

When creating documentation, decide:
- Intended lifespan (permanent vs temporary)
- Owner or maintainer
- Update triggers (what events require updates)
- Expiration or review date (if temporary)

### 2. Prefer Delete Over Archive

Ask: "Would we miss this if it were gone?"

- If no: Delete
- If "maybe": Delete (can restore from git history)
- If yes: Keep or archive

Over-archiving creates clutter and confusion.

### 3. Link Replacement Documentation

When archiving or deleting:
```markdown
This document is superseded by: [New Guide](link)
```

Prevents frustration from finding old docs.

### 4. Document Your Lifecycle Policy

In README or CONTRIBUTING:
```markdown
## Documentation Lifecycle

- Meeting notes kept for 3 months, then deleted
- Investigation notes reviewed at project end
- Process docs updated when processes change
- Quarterly audit of all documentation
```

Helps team understand expectations.

### 5. Tie to Existing Workflows

**Don't create separate documentation maintenance:**
- Update docs as part of PR review
- Archive docs when deprecating features
- Review docs during sprint planning
- Cleanup docs during release process

**Standalone "documentation day" often fails.**

### 6. Start Conservative, Evolve

**Phase 1:** Just delete obviously outdated docs
**Phase 2:** Add expiration dates to temporary docs
**Phase 3:** Implement quarterly audits
**Phase 4:** Automate with CI checks

Don't try to implement perfect lifecycle management immediately.

### 7. Measure Health

**Simple metrics:**
- % of docs updated in last 6 months
- Number of docs with broken links
- Number of expired temporary docs
- Number of orphaned docs (no owner)

**Track over time to see improvement.**

## Anti-Patterns

### ❌ Never Deleting Anything

"We might need it someday" → endless accumulation

**Better:** Archive important historical content, delete the rest. Git history preserves everything.

### ❌ No Clear Ownership

Docs drift because "someone else" will maintain them.

**Better:** Assign ownership explicitly (CODEOWNERS, frontmatter, teams).

### ❌ Big Bang Cleanup

Years of neglect → massive cleanup effort → burnout → neglect again

**Better:** Small regular maintenance (monthly or quarterly).

### ❌ Perfect Organization Before Deletion

Spending hours organizing docs you're about to delete.

**Better:** Quick triage (keep/delete/archive), then organize what's left.

### ❌ Archiving Everything

Moving old docs to archive/ but never deleting → archive becomes junk drawer

**Better:** Archive only historically significant content. Delete the rest.

### ❌ No Migration Path

Deleting old docs without updating links or providing alternatives.

**Better:** Update references, add redirects, link to replacements.

### ❌ Lifecycle Process Heavier Than Documentation

Elaborate frontmatter, multiple approval steps, complex tools.

**Better:** Simple process that actually gets followed.

## Implementation Checklist

Starting lifecycle management in your project:

### Immediate (Day 1)
- [ ] Delete obviously outdated documentation
- [ ] Fix broken links
- [ ] Update README with current info

### Short-term (Week 1)
- [ ] Identify temporary vs permanent documentation
- [ ] Add creation dates to temporary docs
- [ ] Define basic cleanup policy (e.g., "review quarterly")

### Medium-term (Month 1)
- [ ] Establish ownership for key documents
- [ ] Set up calendar reminder for quarterly audit
- [ ] Create archive directory if needed
- [ ] Document lifecycle policy in README/CONTRIBUTING

### Long-term (Ongoing)
- [ ] Regular quarterly audits
- [ ] Update docs as part of PR process
- [ ] Measure documentation health
- [ ] Refine lifecycle policy based on what works

## Summary

**Key principles:**
1. Documentation naturally decays without management
2. Different doc types need different lifecycle strategies
3. Delete liberally, archive sparingly
4. Make lifecycle part of existing workflows
5. Start simple, evolve over time

**The goal is living documentation that remains useful, not perfect organization of dead content.**
