# Technical Debt Management

Strategies for tracking, prioritizing, and systematically addressing technical debt without blocking feature development.

## Table of Contents

- [What is Technical Debt](#what-is-technical-debt)
- [Types of Technical Debt](#types-of-technical-debt)
- [Tracking Systems](#tracking-systems)
- [Prioritization Frameworks](#prioritization-frameworks)
- [Deprecation Handling](#deprecation-handling)
- [Legacy Code Strategies](#legacy-code-strategies)
- [Measuring Tech Debt](#measuring-tech-debt)
- [Integration with Development](#integration-with-development)

## What is Technical Debt

**Metaphor**: Like financial debt, technical debt lets you go faster now but costs more later.

**Examples**:
- Quick hack instead of proper solution
- Skipped tests to meet deadline
- Outdated dependencies
- TODO comments never addressed
- Duplicated code
- Unclear architecture
- Missing documentation

**Not all shortcuts are debt**: Sometimes quick-and-dirty is appropriate (prototypes, experiments).

**Debt becomes a problem when**:
- It accumulates unchecked
- Interest (maintenance cost) exceeds value
- Makes future changes difficult
- Team velocity decreases

## Types of Technical Debt

### Deliberate vs. Inadvertent

**Deliberate** (conscious trade-off):
- "Ship now, refactor later"
- "Hardcode for MVP, make configurable in v2"
- Documented with TODOs

**Inadvertent** (didn't know better):
- Poor design choices
- Misunderstood requirements
- Lack of experience
- Technology evolved

### Reckless vs. Prudent

**Reckless**:
- No tests because "too slow"
- Copy-paste without understanding
- Ignoring best practices with no reason

**Prudent**:
- Skip optimization for deadline (measure, optimize later)
- Use library with known issues (better than blocking)
- Acceptable hack with documented plan to fix

**Best**: Prudent and deliberate
**Worst**: Reckless and inadvertent

## Tracking Systems

### System 1: TODO Comments (Minimal)

**Pattern**: Inline comments in code

```javascript
// TODO: Refactor this to use async/await instead of callbacks
function fetchData(callback) {
  // ... old callback-based code
}

// FIXME: This breaks for edge case X
function calculateDiscount(price, code) {
  // ... buggy logic
}

// HACK: Temporary workaround for API bug, remove when fixed
const result = data.field || data.field2 || null;
```

**Tagging conventions**:
- `TODO`: Needs to be done
- `FIXME`: Known bug or issue
- `HACK`: Temporary workaround
- `XXX`: Warning, problematic code

**Finding TODOs**:
```bash
rg "TODO|FIXME|HACK|XXX" --type js
```

**Pros**:
- Low friction (add inline)
- Context right in code
- Easy to find with search

**Cons**:
- Easy to ignore/forget
- No prioritization
- No ownership
- No tracking of progress

### System 2: DEBT.md File (Light)

**Pattern**: Centralized markdown file

```markdown
# Technical Debt

## High Priority

### Authentication System Refactor
**Impact**: High - affects all features
**Effort**: 1 week
**Owner**: @auth-team
**Created**: 2026-01-15
**Reason**: Current JWT implementation has security issues

### Database Query Optimization
**Impact**: High - slow page loads
**Effort**: 3 days
**Owner**: @backend-team
**Created**: 2026-01-20
**Reason**: N+1 queries in user dashboard

## Medium Priority

### Consolidate Duplicate Validation Logic
**Impact**: Medium - maintenance burden
**Effort**: 2 days
**Owner**: @frontend-team
**Created**: 2026-01-10

## Low Priority

### Update ESLint Configuration
**Impact**: Low - code style inconsistencies
**Effort**: 1 day
**Created**: 2025-12-01
```

**Finding debt**:
- Read DEBT.md
- Link from README or AGENTS.md

**Pros**:
- Centralized view
- Can prioritize
- Track ownership
- Minimal overhead

**Cons**:
- Separate from code (can get out of sync)
- No automated tracking
- Still manual process

### System 3: Issue Tracker (Formal)

**Pattern**: Issues/tickets with "tech-debt" label

**GitHub/GitLab Issues**:
```markdown
# Title: Refactor authentication system

**Labels**: tech-debt, high-priority, backend

## Description
Current JWT implementation has security vulnerabilities.
Need to migrate to more secure approach.

## Impact
- Security: High
- Maintenance: Medium
- Performance: Low

## Effort Estimate
1 week (5 days)

## Acceptance Criteria
- [ ] Replace current JWT library
- [ ] Add refresh token support
- [ ] Update all tests
- [ ] Migrate existing tokens

## Related Issues
- Fixes #123 (JWT security audit)
- Blocks #456 (OAuth integration)
```

**Querying**:
```bash
# GitHub CLI
gh issue list --label "tech-debt"

# Filter by priority
gh issue list --label "tech-debt,high-priority"
```

**Pros**:
- Integrates with workflow
- Can prioritize, assign, track
- Link to PRs
- Notifications
- Searchable

**Cons**:
- More overhead
- Can become backlog noise
- Requires discipline

### System 4: ADR + Debt Log (Comprehensive)

**Pattern**: Architecture Decision Records document debt explicitly

```markdown
# ADR 015: Use MongoDB for User Sessions

## Status
Accepted

## Context
Need session storage. Options: Redis, MongoDB, PostgreSQL.

## Decision
Use MongoDB (already in stack).

## Consequences

### Positive
- No new dependency
- Team familiar

### Negative
- Not ideal for session storage (better: Redis)

**TECH DEBT**: Should migrate to Redis when we hit scale issues.
Tracked in #789.
```

## Prioritization Frameworks

### Framework 1: Impact vs. Effort Matrix

```
High Impact ─┬─────────────┬────────────
             │ FIX NOW     │ PLAN       │
             │ (Quick Wins)│ (Big Wins) │
Low Impact  ─┼─────────────┼────────────
             │ MAYBE       │ SKIP       │
             │ (Fill-ins)  │ (Wastes)   │
             └─────────────┴────────────
             Low Effort    High Effort
```

**FIX NOW** (High impact, low effort):
- Security vulnerabilities (easy fix)
- Performance bottlenecks (simple query optimization)
- Critical bugs (1-line fix)

**PLAN** (High impact, high effort):
- Architecture refactors
- Major upgrades
- System rewrites

**MAYBE** (Low impact, low effort):
- Code style cleanup
- Update comments
- Rename variables

**SKIP** (Low impact, high effort):
- Perfect that rarely-used feature
- Refactor code that works and never changes

### Framework 2: Interest Rate Calculation

**Formula**: Interest = (Maintenance Cost per Month) × (Months Until Fixed)

**Example**:
```
Tech Debt: Messy codebase area

Maintenance cost: 2 hours/month (bugs, confusion, slow changes)
If not fixed: Will exist for 12 months
Interest: 2 hours/month × 12 months = 24 hours

Fix effort: 8 hours

Decision: Fix (saves 24 hours, costs 8 hours = net +16 hours)
```

**If interest > fix effort**: Pay off debt
**If interest < fix effort**: Leave it

### Framework 3: Team Velocity Impact

**Measure**: Is debt slowing us down?

**Indicators**:
- Stories take longer than similar past stories
- More bugs in old code
- Engineers avoid touching certain areas
- Onboarding takes longer

**Action**: Address debt that most impacts velocity

## Deprecation Handling

### Marking Deprecated Code

**Pattern**: Clear warnings, migration path

**JavaScript/TypeScript**:
```typescript
/**
 * @deprecated Use newFunction() instead. Will be removed in v3.0.
 */
function oldFunction() {
  console.warn('oldFunction is deprecated, use newFunction');
  // ... old implementation
}
```

**Python**:
```python
import warnings

def old_function():
    warnings.warn(
        "old_function is deprecated, use new_function instead",
        DeprecationWarning,
        stacklevel=2
    )
    # ... old implementation
```

### Deprecation Workflow

1. **Announce**: Document deprecation, provide alternative
2. **Warn**: Add runtime warnings
3. **Migrate**: Update internal usage
4. **Wait**: Give users time (1-2 major versions)
5. **Remove**: Delete deprecated code

**Example timeline**:
```
v2.0: Deprecate oldFunction, introduce newFunction
v2.1-2.9: Both exist, oldFunction warns
v3.0: Remove oldFunction
```

## Legacy Code Strategies

### Strategy 1: Strangler Fig Pattern

**Pattern**: Gradually replace old system with new

```
Phase 1: New system handles 10% of requests
Phase 2: New system handles 50% of requests
Phase 3: New system handles 100% of requests
Phase 4: Remove old system
```

**Implementation**:
```javascript
function handleRequest(req) {
  if (shouldUseNewSystem(req)) {
    return newSystem.handle(req);
  } else {
    return legacySystem.handle(req);  // Old code
  }
}

function shouldUseNewSystem(req) {
  // Gradual rollout (feature flag)
  return featureFlag('new-system', req.user);
}
```

### Strategy 2: Characterization Tests

**Problem**: Can't refactor safely without tests

**Solution**: Write tests that characterize current behavior

```javascript
// 1. Write test that captures current behavior
test('legacy function behavior', () => {
  expect(legacyFunction(input)).toBe(actualOutput);
  // Even if buggy, test current behavior
});

// 2. Refactor
function legacyFunction(input) {
  // ... refactored code
}

// 3. Tests ensure behavior unchanged
// (Fix bugs separately after refactoring)
```

### Strategy 3: Isolate and Contain

**Pattern**: Don't let legacy infect new code

```
old-system/      (legacy, isolated)
  // Don't touch unless necessary

new-system/      (clean, modern)
  // New development here

adapter/         (bridge between old and new)
  // Minimal interface layer
```

## Measuring Tech Debt

### Quantitative Metrics

**Code Quality Metrics**:
```bash
# Code coverage
jest --coverage
# Target: >80%

# Complexity
eslint --rule 'complexity: ["error", 10]'
# Target: <10 cyclomatic complexity

# Duplication
jscpd src/
# Target: <5% duplication

# Dependencies
npm audit
# Target: 0 high/critical vulnerabilities
```

**Tracking Over Time**:
```bash
# Weekly snapshot
echo "$(date),$(npm audit --json | jq '.metadata.vulnerabilities.total')" >> metrics.csv

# Plot trend
# Is tech debt increasing or decreasing?
```

### Qualitative Assessments

**Team Survey**:
- "How much does tech debt slow you down?" (1-10)
- "Which areas are most painful?"
- "How confident are you making changes?"

**Code Review Comments**:
- Count "we should refactor this" comments
- Indicates problematic areas

**Incident Analysis**:
- "Was this bug caused by tech debt?"
- Track incidents tied to known debt

## Integration with Development

### Pattern 1: Dedicated Debt Sprints

**Schedule**: Every 4-6 sprints, dedicate one to debt

**Process**:
1. Team lists debt items
2. Prioritize by impact/effort
3. Sprint focused only on debt
4. Measure improvement

**Pros**: Focused time
**Cons**: Delays features

### Pattern 2: Continuous (20% Time)

**Rule**: 20% of each sprint allocated to debt

**Process**:
- For every 5 story points of features, include 1 point of debt
- Engineers pick debt items each sprint
- Steady progress

**Pros**: Continuous improvement
**Cons**: Requires discipline

### Pattern 3: Opportunistic

**Rule**: Fix debt when you touch code

**Process**:
- Working on feature in area with debt?
- Fix the debt as part of the story
- "Leave code better than you found it"

**Pros**: Low overhead
**Cons**: Uneven progress, some debt never addressed

### Pattern 4: Hybrid (Recommended)

**Combine strategies**:
- **Continuous**: 10-20% each sprint for small debt
- **Opportunistic**: Boy Scout Rule (clean as you go)
- **Dedicated**: Quarterly debt sprint for big items
- **Critical**: Address high-impact debt immediately

## Best Practices Summary

1. **Make debt visible** - Track explicitly (TODO, DEBT.md, or issues)
2. **Prioritize by impact** - Fix what hurts most
3. **Don't ignore interest** - Debt compounds
4. **Balance with features** - Some debt is acceptable
5. **Measure progress** - Track metrics over time
6. **Integrate with workflow** - Don't defer indefinitely
7. **Communicate** - Explain debt cost to stakeholders
8. **Prevent new debt** - Code review, standards

**Red flags**:
- No visibility into debt
- Never addressing debt
- Velocity decreasing
- Engineers avoid certain code
- Bugs increasing
- Onboarding takes longer
