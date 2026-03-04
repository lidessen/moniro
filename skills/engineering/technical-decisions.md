# Technical Decisions

Making sound technical choices and documenting them for future reference.

## Table of Contents

- [Decision Framework](#decision-framework)
- [Common Decision Types](#common-decision-types)
- [Architecture Decision Records](#architecture-decision-records)
- [Evaluating Trade-offs](#evaluating-trade-offs)
- [When to Revisit Decisions](#when-to-revisit-decisions)

## Decision Framework

### The Five Questions

Before any significant technical decision:

```
1. PROBLEM:   What exactly are we trying to solve?
2. CONTEXT:   What constraints exist? (time, team, tech, budget)
3. OPTIONS:   What are the realistic choices?
4. TRADE-OFFS: What does each option cost and provide?
5. VALIDATION: How will we know if we're wrong?
```

### Decision Checklist

- [ ] Problem clearly defined (not solution-shaped)
- [ ] Constraints identified and prioritized
- [ ] At least 2-3 viable options considered
- [ ] Trade-offs documented for each option
- [ ] Team input gathered
- [ ] Reversibility assessed
- [ ] Decision documented (ADR for significant choices)

## Common Decision Types

### Language/Framework Selection

**Consider**:

- Team expertise (learning curve cost is real)
- Ecosystem maturity (libraries, tooling, community)
- Performance requirements
- Hiring pool
- Long-term maintenance

**Red flags**:

- Choosing based on "what's hot"
- Ignoring team's existing expertise
- No consideration of ecosystem

### Build vs. Buy vs. Open Source

**Build when**:

- Core differentiator for your business
- Unique requirements not met by existing solutions
- Long-term ownership justifies upfront cost

**Buy when**:

- Not core to your business
- Vendor solution meets needs with acceptable trade-offs
- Time-to-market is critical

**Open source when**:

- Good solutions exist with acceptable licenses
- Community is active and healthy
- You can contribute back if needed

### Monolith vs. Microservices

**Start with monolith if**:

- Team is small (<10 developers)
- Domain boundaries unclear
- Moving fast is priority
- Operational expertise limited

**Consider microservices if**:

- Clear domain boundaries exist
- Teams can own services independently
- Scaling requirements vary significantly by component
- Operational maturity sufficient

**The path**: Monolith → Modular monolith → Extract services as needed

### SQL vs. NoSQL

**SQL (relational) when**:

- Data has clear relationships
- Need ACID transactions
- Query patterns vary or are unknown
- Data integrity is critical

**NoSQL when**:

- Data naturally fits document/key-value model
- Extreme scale requirements
- Schema flexibility needed
- Query patterns are known and simple

**Hybrid**: Often the answer is both, for different use cases

## Architecture Decision Records

### What is an ADR?

A short document capturing a significant architectural decision:

- **Context**: Why this decision matters
- **Decision**: What was decided
- **Consequences**: What follows from this decision

### ADR Template

```markdown
# ADR-NNN: Title

## Status

[Proposed | Accepted | Deprecated | Superseded by ADR-XXX]

## Context

What is the issue that we're seeing that is motivating this decision?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

### Positive

- Benefit 1
- Benefit 2

### Negative

- Cost 1
- Risk 1

### Neutral

- Side effect that's neither good nor bad
```

### ADR Example

```markdown
# ADR-001: Use PostgreSQL for primary database

## Status

Accepted

## Context

We need a database for our user management system. Requirements:

- ACID transactions for financial data
- Complex queries for reporting
- Team familiar with SQL
- Moderate scale (millions of rows, not billions)

## Decision

Use PostgreSQL as our primary database.

## Consequences

### Positive

- Team expertise exists (no learning curve)
- Excellent ecosystem (extensions, tools)
- Strong community support
- Handles our scale easily

### Negative

- Less flexible schema than document stores
- Horizontal scaling more complex than NoSQL
- Need to manage connection pooling carefully

### Neutral

- Will need separate solution if we need full-text search at scale
```

### When to Write an ADR

**Write ADR for**:

- Database/storage technology choices
- Framework/language selections
- Architecture pattern decisions
- Third-party service integrations
- Security-related choices
- Decisions that are hard to reverse

**Skip ADR for**:

- Library choices that are easily changed
- Implementation details
- Coding style decisions (use linter config)

## Evaluating Trade-offs

### Trade-off Matrix

| Option | Pros | Cons | Risk | Reversibility |
| ------ | ---- | ---- | ---- | ------------- |
| A      | ...  | ...  | High | Hard          |
| B      | ...  | ...  | Low  | Easy          |
| C      | ...  | ...  | Med  | Medium        |

### Common Trade-offs

**Performance vs. Simplicity**

- Optimize only when measured need exists
- Simple code that's "fast enough" beats complex fast code

**Flexibility vs. Complexity**

- Every abstraction has a cost
- YAGNI: don't build for hypothetical futures

**Consistency vs. Availability** (CAP theorem)

- Distributed systems: pick two of three
- Most systems can be "eventually consistent"

**Speed vs. Quality**

- Technical debt is sometimes acceptable
- But: know you're taking on debt, plan to pay it back

### Reversibility Spectrum

```
Easy to reverse          Hard to reverse
←─────────────────────────────────────→
Library choice    Database    Language
API endpoint      Schema      Architecture
Config change     Protocol    Data model
```

**Rule**: Invest decision effort proportional to reversibility difficulty.

## When to Revisit Decisions

### Triggers for Revisiting

- **Context changed**: Original constraints no longer apply
- **New information**: Discovered something that changes trade-offs
- **Pain signals**: Team consistently struggling with decision consequences
- **Scale shift**: System grew beyond original assumptions

### Revisiting Process

1. **Document why** original decision was made
2. **Identify what changed** in context
3. **Re-evaluate** with current information
4. **Consider migration cost** (often underestimated)
5. **Decide**: change or stay the course
6. **Update ADR** with new status and reasoning

### Signs a Decision Should Stay

- Working acceptably despite complaints
- Migration cost exceeds long-term benefit
- Team hasn't exhausted optimization of current choice
- "Grass is greener" syndrome without concrete evidence
