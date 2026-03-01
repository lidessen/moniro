# Decision Template (ADR)

```markdown
---
type: decision
status: active | superseded
tags: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
superseded_by: YYYY-MM-DD-new-decision-slug # if superseded
---

# {Decision Title}

## Context

What situation prompted this decision?

## Decision

What did we decide?

## Rationale

Why this choice over alternatives?

## Alternatives Considered

1. **Option A**: [pros/cons]
2. **Option B**: [pros/cons]

## Consequences

- Positive: ...
- Negative: ...
- Risks: ...

## References

- file:path/to/implementation.ts
- Related: [[previous-decision]]
```

## Usage

Record architectural and technical decisions that:

- Affect multiple components
- Are hard to reverse
- Team members might question later
- Have significant trade-offs

## Status Lifecycle

1. `active` - Current decision in effect
2. `superseded` - Replaced by newer decision (set `superseded_by`)

## Tags

Common decision tags:

- `database` - Data storage choices
- `api` - API design decisions
- `security` - Security-related choices
- `infrastructure` - Deployment/ops decisions
- `library` - Third-party dependency choices
