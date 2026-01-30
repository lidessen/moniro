# RFC Process

Guide for using RFC (Request for Comments) process to document and decide on significant technical changes. Adaptable to different team sizes and project needs.

## Table of Contents

- [What is an RFC](#what-is-an-rfc)
- [When to Use RFCs](#when-to-use-rfcs)
- [RFC Workflow](#rfc-workflow)
- [RFC Template](#rfc-template)
- [Lightweight vs Formal Process](#lightweight-vs-formal-process)
- [Common Patterns](#common-patterns)
- [Examples](#examples)

## What is an RFC

**RFC (Request for Comments)** is a document proposing a significant change, designed to:
- **Capture design decisions** before implementation
- **Invite feedback** from stakeholders
- **Build consensus** on approach
- **Document rationale** for future reference

### RFCs vs Other Documentation

**RFC:** Proposal for something that doesn't exist yet
- "We should migrate to PostgreSQL"
- "Proposal: New caching architecture"
- "RFC: Change API authentication to OAuth2"

**ADR (Architecture Decision Record):** Record of decision already made
- Often created from accepted RFC
- Can also document decisions made without formal RFC

**Design Doc:** Similar to RFC, different name
- Some teams use "design doc" instead of "RFC"
- Same purpose, choose one term and be consistent

**Issue/Ticket:** Specific task or bug
- RFCs are broader (architecture, approach)
- Issues are narrower (implementation details)

## When to Use RFCs

### Use RFCs For:

**✅ Significant technical decisions**
- Database technology choice
- New service/component architecture
- Major refactoring approach
- API design changes (breaking or significant)

**✅ Cross-team impact**
- Changes affecting multiple teams
- New processes or conventions
- Shared infrastructure changes

**✅ Irreversible or costly decisions**
- Technology migrations
- Large time investments
- Changes hard to undo

**✅ Multiple valid approaches**
- Need to evaluate trade-offs
- Want input on best approach
- Benefit from diverse perspectives

### Don't Use RFCs For:

**❌ Small, localized changes**
- Bug fixes
- Minor refactoring
- Single-component improvements
- Obvious solutions

**❌ Urgent decisions**
- Incident response
- Critical bugs
- Time-sensitive fixes

**❌ Already-decided items**
- Don't retrofit RFCs for decisions already made
- (Exception: Create ADR to document decision)

**❌ Bikeshedding topics**
- Code style (use linter config)
- Naming conventions (document in style guide)
- Tool preferences (decide quickly, move on)

### Gray Areas (Team Judgment)

**Medium-impact changes:**
- New library adoption → RFC if organization-wide, skip if team-local
- Service splitting → RFC for first split (sets pattern), skip for subsequent
- Test strategy change → RFC if affects multiple teams, skip if team-local

**When unsure:** Start with lightweight RFC (see below)

## RFC Workflow

### Standard Process

#### 1. Draft

**Author creates RFC document**
- Copy template (see below)
- Fill in proposal details
- Include alternatives considered
- Identify open questions

**Status:** `DRAFT`
**Filename:** `DRAFT-NNNN-title.md` or `rfcs/drafts/NNNN-title.md`

#### 2. Review

**Share for feedback**
- Post in team chat/channel
- Tag relevant stakeholders
- Set feedback deadline (typically 1-2 weeks)

**Reviewers provide input:**
- Ask clarifying questions
- Suggest alternatives
- Identify risks or concerns
- Approve or request changes

**Author updates RFC** based on feedback

#### 3. Decision

**Decision point approaches:**
- **Consensus:** General agreement (most teams)
- **Tech lead decision:** Lead makes final call after review
- **Vote:** Formal vote (rare, large changes)

**Outcomes:**
- **Accepted:** Proceed with implementation
- **Rejected:** Don't proceed (document why)
- **Deferred:** Revisit later (document when/why)

**Status update:** `DRAFT` → `ACCEPTED` / `REJECTED` / `DEFERRED`

#### 4. Implementation

**If accepted:**
- Create implementation tasks/issues
- Reference RFC number in tasks
- Link commits/PRs back to RFC

**Update RFC status as implementation progresses:**
- `ACCEPTED` → `IMPLEMENTING` → `IMPLEMENTED`

**If implementation differs from RFC:**
- Update RFC with actual approach
- Document reasons for deviation

#### 5. Archive/Reference

**Completed RFCs become historical record:**
- Why decision was made
- What alternatives were considered
- Rationale for approach

**Valuable for:**
- Onboarding (understanding past decisions)
- Revisiting decisions (when context changes)
- Avoiding repeated debates

## RFC Template

### Minimal Template

```markdown
# RFC NNNN: [Title]

**Status:** DRAFT | ACCEPTED | REJECTED | IMPLEMENTING | IMPLEMENTED | DEFERRED
**Author:** [Name/GitHub handle]
**Created:** YYYY-MM-DD
**Updated:** YYYY-MM-DD

## Summary

[1-2 paragraph overview of the proposal]

## Motivation

[Why are we doing this? What problem does it solve?]

## Proposal

[Detailed explanation of the proposed solution]

## Alternatives Considered

[What other approaches were considered and why not chosen?]

## Open Questions

[What's still TBD or needs discussion?]

## Implementation Plan

[High-level steps to implement, if accepted]
```

### Comprehensive Template

```markdown
# RFC NNNN: [Title]

**Status:** DRAFT
**Author:** @username
**Created:** YYYY-MM-DD
**Updated:** YYYY-MM-DD
**Stakeholders:** @team-lead, @architect, @ops
**Target Decision Date:** YYYY-MM-DD

## Summary

[1-2 paragraph executive summary]

## Motivation

### Problem Statement

[What problem are we solving?]

### Goals

- [Goal 1]
- [Goal 2]

### Non-Goals

- [Explicitly out of scope]

## Background

[Context needed to understand the proposal]

## Proposal

### Overview

[High-level description]

### Detailed Design

[Technical details, architecture diagrams, API examples, etc.]

### User Impact

[How does this affect users/developers/operators?]

### Migration Strategy

[If changing existing system, how do we migrate?]

## Alternatives Considered

### Alternative 1: [Name]

**Description:** [What is it?]
**Pros:** [Advantages]
**Cons:** [Disadvantages]
**Why not chosen:** [Reason]

### Alternative 2: [Name]

[...]

## Trade-offs

[Key trade-offs in the chosen approach]

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk 1] | High | [How we address it] |
| [Risk 2] | Medium | [How we address it] |

## Open Questions

- [ ] [Question 1]
- [ ] [Question 2]

## Implementation Plan

### Phase 1: [Name]
- [Task]
- [Task]

### Phase 2: [Name]
- [Task]
- [Task]

**Estimated Timeline:** [X weeks/months]

## Success Metrics

[How do we know this succeeded?]

## References

- [Related RFC]
- [External documentation]
- [Research/articles]

---

## Decision Log

**YYYY-MM-DD:** Initial draft created
**YYYY-MM-DD:** Review feedback incorporated
**YYYY-MM-DD:** Accepted by consensus
```

**Choose template complexity based on change significance.**

## Lightweight vs Formal Process

### Lightweight RFC (Small Teams, Fast-Moving)

**When:**
- Small team (2-10 people)
- High trust environment
- Frequent communication

**Process:**
1. Create simple RFC document (minimal template)
2. Share in team chat
3. Async review (3-5 days)
4. Quick decision (verbal OK or meeting)
5. Update RFC status
6. Implement

**File format:**
```
rfcs/
├── 0001-api-authentication.md
├── 0002-database-choice.md
└── 0003-caching-strategy.md
```

Simple numbering, status in frontmatter or filename.

**Approval:** Informal consensus or tech lead decision

### Formal RFC (Large Teams, High Stakes)

**When:**
- Large team (10+ people)
- Multiple stakeholders
- High-impact changes
- Compliance/audit requirements

**Process:**
1. Create comprehensive RFC (full template)
2. Announce formally (RFC created, feedback window)
3. Structured review (comments in doc or PR)
4. Review meeting (present RFC, discuss)
5. Formal decision (documented vote or approval)
6. Implementation tracking
7. Post-implementation review

**File format:**
```
rfcs/
├── README.md              # Process documentation
├── template.md            # RFC template
├── drafts/                # Work in progress
│   └── 0042-new-feature.md
├── accepted/              # Approved RFCs
│   ├── 0001-api-design.md
│   └── 0023-migration.md
├── rejected/              # Not approved
│   └── 0015-alternative.md
└── implemented/           # Completed
    └── 0008-caching.md
```

Organized by status, clear lifecycle.

**Approval:** Formal sign-off, documented decision

### Hybrid (Most Common)

**Lightweight by default, formal when needed**

**Standard:** Simple RFC, quick review, informal consensus

**Formal process triggered by:**
- High cost/risk
- Cross-team impact
- Disagreement emerges
- Stakeholder request

**Start simple, escalate if needed.**

## Common Patterns

### Pattern 1: Numbered RFCs

**Format:** `NNNN-title.md` (e.g., `0042-new-api.md`)

**Numbering:**
- Sequential (0001, 0002, 0003, ...)
- Zero-padded for sorting
- Never reuse numbers

**Benefits:**
- Easy to reference ("See RFC 0042")
- Chronological order preserved
- Unique identifier

**Track next number:**
```markdown
# rfcs/README.md

Next RFC number: 0043
```

### Pattern 2: Status in Filename

**Format:** `STATUS-NNNN-title.md`

Examples:
- `DRAFT-0042-new-feature.md`
- `ACCEPTED-0023-migration.md`
- `IMPLEMENTED-0015-caching.md`

**Benefits:**
- Status visible in file listing
- Easy to filter (`ls rfcs/ACCEPTED-*`)
- No need to open file to see status

**Rename file when status changes**

### Pattern 3: Status in Frontmatter

**Filename:** `NNNN-title.md` (no status)

**Frontmatter:**
```yaml
---
status: ACCEPTED
created: 2026-01-15
updated: 2026-01-30
---
```

**Benefits:**
- Cleaner filenames
- Status easily updated (no rename)
- Can track more metadata

**Trade-off:** Must open file to see status

### Pattern 4: Separate Directories by Status

**Structure:**
```
rfcs/
├── drafts/
├── accepted/
├── rejected/
└── implemented/
```

**Benefits:**
- Clear separation
- Easy to browse by status
- Can have different retention policies

**Process:** Move files between directories as status changes

### Pattern 5: RFC as Pull Request

**Process:**
1. Create RFC markdown file
2. Open PR with RFC
3. Review happens via PR comments
4. Merge PR = Accept RFC

**Benefits:**
- Leverage GitHub/GitLab review flow
- Comments threaded and resolved
- History preserved in PR

**Trade-off:** Requires discipline (merge ≠ implement, just accept)

### Pattern 6: Living RFC Index

**Create `rfcs/README.md` with index:**

```markdown
# RFCs

## Active

- [RFC 0042: New API Design](0042-new-api.md) - In review, feedback by Feb 1

## Accepted

- [RFC 0023: Database Migration](0023-db-migration.md) - Accepted, implementing
- [RFC 0015: Caching Strategy](0015-caching.md) - Accepted, implemented

## Rejected

- [RFC 0038: Alternative Approach](0038-alternative.md) - Rejected, see RFC 0042

## Templates

- [RFC Template](template.md)
```

**Keep updated as RFCs progress.**

## Examples

### Example 1: Lightweight RFC (Small Team)

```markdown
# RFC 0003: Switch to PostgreSQL

**Status:** ACCEPTED
**Author:** @alex
**Date:** 2026-01-30

## Summary

Migrate from SQLite to PostgreSQL for production database.

## Why

SQLite limitations hit:
- Concurrent writes causing locks
- Need full-text search (PostgreSQL has better FTS)
- Future need for replication

## Proposal

1. Set up PostgreSQL in production
2. Create migration scripts (SQLite → PostgreSQL)
3. Update ORM connection config
4. Run migration during maintenance window

## Timeline

2 weeks:
- Week 1: Setup PostgreSQL, test migration locally
- Week 2: Production migration

## Decision

Discussed at standup 2026-01-30. Team agrees, proceeding.
```

Short, simple, decision made quickly.

### Example 2: Comprehensive RFC (Large Team)

```markdown
# RFC 0042: Multi-Region Deployment Architecture

**Status:** DRAFT
**Author:** @jordan
**Created:** 2026-01-15
**Stakeholders:** @infra-team, @backend-team, @product
**Target Decision:** 2026-02-15

## Summary

Proposes architecture for deploying our application across multiple geographic regions (US-West, US-East, EU) to improve latency and reliability for global users.

## Motivation

### Problem

Current single-region deployment (US-West):
- High latency for EU users (200-400ms)
- Single point of failure (region outage = full downtime)
- Compliance concerns (EU data residency)

### Goals

- Reduce latency for EU users (<100ms)
- Improve reliability (survive region outage)
- Meet data residency requirements

### Non-Goals

- Active-active writes across regions (too complex, phase 2)
- Edge caching (different solution, see RFC 0038)

## Proposal

### Architecture

**Multi-region active-passive:**
- Primary region: US-West
- Secondary regions: US-East, EU
- Reads served locally
- Writes routed to primary
- Async replication to secondaries

[Diagram would go here]

### Data Strategy

**Read replicas:** Each region has read-only DB replica
**Write path:** All writes to primary (US-West)
**Replication lag:** Accept <1 second lag for reads

**EU data residency:** EU user data stored in EU-specific tables, replicated bidirectionally

### Routing

**GeoDNS:** Route users to nearest region
**Failover:** If region unhealthy, route to next-nearest

### Migration

**Phase 1:** Add US-East (4 weeks)
- Set up infrastructure
- Test replication
- Gradual traffic shift

**Phase 2:** Add EU (6 weeks)
- Same as Phase 1
- Additional: EU data residency logic

## Alternatives Considered

### Alternative 1: Active-Active (Multi-Master)

**Pros:** Lower write latency globally, no single primary
**Cons:** Complex conflict resolution, risk of data inconsistency
**Why not:** Complexity not justified for our write patterns (90% reads)

### Alternative 2: Edge Caching Only

**Pros:** Simpler, lower cost
**Cons:** Doesn't solve data residency, limited latency improvement
**Why not:** Doesn't meet compliance goals

### Alternative 3: Fully Independent Regions

**Pros:** Simple, no cross-region dependencies
**Cons:** Separate user accounts per region, poor UX
**Why not:** Users expect single global account

## Trade-offs

**Chose:**
- Simple active-passive over complex active-active
- Accept replication lag (<1s) for operational simplicity
- Incremental rollout over big-bang migration

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Replication lag causes stale reads | Medium | Monitor lag, alert if >1s |
| Primary region failure loses write availability | High | Fast failover process, DR plan |
| Increased operational complexity | Medium | Comprehensive runbooks, training |
| Cost increase (3x infrastructure) | Medium | Start with cheaper instance tiers |

## Open Questions

- [ ] What's acceptable replication lag? (proposed: <1s)
- [ ] How to handle EU-specific data deletion requests? (GDPR)
- [ ] Which cloud provider for EU region? (AWS vs. GCP)

## Implementation Plan

### Phase 0: Preparation (2 weeks)
- Finalize cloud provider choice
- Design DB replication setup
- Create IaC for new regions

### Phase 1: US-East (4 weeks)
- Deploy infrastructure
- Set up replication
- Test failover
- Gradual traffic rollout (10% → 50% → 100%)

### Phase 2: EU (6 weeks)
- Deploy infrastructure
- Implement EU data residency logic
- Set up bidirectional replication for EU data
- Compliance review
- Gradual traffic rollout

**Total Timeline:** ~12 weeks

## Success Metrics

- EU user latency <100ms (p95)
- Replication lag <1s (p99)
- Zero data loss during failover tests
- Successfully pass EU compliance audit

## References

- [AWS Multi-Region Architectures](https://aws.amazon.com/solutions/implementations/multi-region/)
- [Netflix Multi-Region Strategy](https://netflixtechblog.com/active-active-for-multi-regional-resiliency-c47719f6685b)
- [EU Data Residency Requirements](link)

---

## Decision Log

**2026-01-15:** Initial draft
**2026-01-22:** Feedback from infra team incorporated
**2026-01-29:** Presented at architecture review
**TBD:** Final decision
```

Comprehensive, structured, thorough.

## Best Practices

### Writing RFCs

**1. Be concise** - Respect reviewers' time
- Summary in 1-2 paragraphs
- Details as needed, but no fluff
- Use diagrams/examples over long prose

**2. Show your work** - Include alternatives
- What did you consider?
- Why not those approaches?
- Shows thoroughness, saves debate

**3. Identify trade-offs** - Nothing is perfect
- What are we giving up?
- What are we gaining?
- Honest about costs

**4. Make it reviewable** - Clear structure
- Use template (consistency helps reviewers)
- Headers, lists, tables (easy to scan)
- Highlight open questions

**5. Update based on feedback** - Living document during review
- Address questions in the RFC itself
- Track major changes in decision log
- Don't be precious about initial proposal

### Reviewing RFCs

**1. Be constructive** - Improve the proposal
- Suggest alternatives if criticizing
- Ask questions to understand
- Assume good intent

**2. Focus on substance** - Not bikeshedding
- Architecture, trade-offs, risks
- Not naming, formatting, minor details
- Save style feedback for code review

**3. Be timely** - Don't block
- Review within deadline
- If can't review, say so
- Silence ≠ approval (explicit sign-off)

**4. Know when to accept "good enough"**
- Perfection is the enemy of done
- Accept reasonable proposals even if not your preferred approach
- Can iterate after implementation

### Process Management

**1. Set deadlines** - Don't let RFCs linger
- Feedback deadline (e.g., 2 weeks)
- Decision deadline
- If no consensus by deadline, escalate (don't extend forever)

**2. Drive to decision** - Don't get stuck in review
- Author/lead responsible for moving to decision
- Set decision date upfront
- If prolonged disagreement, escalate to decision-maker

**3. Archive outcomes** - Document all RFCs
- Accepted RFCs: Keep for reference
- Rejected RFCs: Keep with rejection reason
- Deferred RFCs: Note why and when to revisit

**4. Link implementation to RFC** - Traceability
- Reference RFC in PRs/commits
- Update RFC with implementation notes
- Mark RFC as implemented when done

**5. Review the process** - Iterate on RFC process itself
- Too heavyweight? Simplify
- Too many RFCs? Raise threshold
- Too few RFCs? Encourage use
- Retrospect periodically

## Anti-Patterns

### ❌ RFC After Implementation

Writing RFC for something already built.

**Why bad:** Skips the benefit (input before work invested)
**Better:** Document as ADR (decision record), not RFC

### ❌ RFC Hell (Over-Process)

Every small change requires RFC.

**Why bad:** Slows down unnecessarily, teams route around process
**Better:** Reserve RFCs for significant changes

### ❌ Perfection Paralysis

Endlessly revising RFC, never reaching decision.

**Why bad:** Analysis paralysis, opportunity cost
**Better:** Set decision deadline, accept "good enough"

### ❌ Ignored RFCs

RFCs written but not reviewed or decided.

**Why bad:** Wasted effort, team loses faith in process
**Better:** Lightweight process, clear ownership, deadlines

### ❌ Post-Hoc RFC Acceptance

Accepting RFC because "implementation already started."

**Why bad:** Defeats purpose, creates pressure to accept
**Better:** Don't start implementation before decision (unless explicit prototype)

## Summary

**RFCs are a tool, not a requirement.**

- Use for significant, impactful decisions
- Choose process complexity to match team and change size
- Drive to decision (don't let RFCs languish)
- Archive for future reference
- Iterate on process based on what works

**Good RFC process:**
- ✅ Improves decision quality
- ✅ Builds consensus
- ✅ Documents rationale
- ✅ Feels helpful, not bureaucratic

**Bad RFC process:**
- ❌ Slows down unnecessarily
- ❌ Creates busy work
- ❌ Gets ignored or worked around
