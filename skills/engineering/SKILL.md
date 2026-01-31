---
name: engineering
description: Guides technical decisions, architecture, and implementation. Use for tech choices, system design, API design, refactoring, or "how should I build this" questions.
---

# Engineering

Technical leadership for projects - making sound technical decisions, designing robust architectures, and guiding quality implementations. While housekeeping maintains project health, engineering drives technical capability.

## Quick Navigation

**Technical Decisions**
- Evaluate technology options → [technical-decisions.md](technical-decisions.md)
- Choose between approaches → [technical-decisions.md](technical-decisions.md)
- Document decisions (ADRs) → [technical-decisions.md](technical-decisions.md)

**Architecture**
- Design system structure → [architecture/patterns.md](architecture/patterns.md)
- Define module boundaries → [architecture/boundaries.md](architecture/boundaries.md)
- Plan data flow → [architecture/data-flow.md](architecture/data-flow.md)

**Implementation**
- Apply best practices → [implementation/best-practices.md](implementation/best-practices.md)
- Use design patterns → [implementation/patterns.md](implementation/patterns.md)
- Refactor effectively → [refactoring.md](refactoring.md)

**Specialized Areas**
- Design APIs → [api-design.md](api-design.md)
- Optimize performance → [performance.md](performance.md)
- Architect CI/CD → [cicd-architecture.md](cicd-architecture.md)

## Core Responsibilities

### 1. Technical Decisions

**Purpose**: Make informed choices that balance trade-offs appropriately.

**Key activities**:
- Evaluate technology options (frameworks, libraries, tools)
- Weigh trade-offs (performance vs. simplicity, flexibility vs. complexity)
- Document decisions with rationale (ADRs)
- Revisit decisions when context changes

**Decision framework**:
```
1. What problem are we solving?
2. What are the constraints? (time, team, existing tech)
3. What are the options?
4. What are the trade-offs of each?
5. Which option best fits our constraints?
6. How will we know if it's wrong?
```

**Common decision types**:
- Language/framework selection
- Build vs. buy vs. open-source
- Monolith vs. microservices
- SQL vs. NoSQL
- Sync vs. async processing

**Link**: [Technical Decisions](technical-decisions.md)

### 2. System Architecture

**Purpose**: Design systems that are understandable, maintainable, and evolvable.

**Key activities**:
- Choose appropriate architecture patterns
- Define clear module boundaries
- Design data flow and state management
- Plan for scalability and resilience
- Document architecture for team understanding

**Architecture principles**:
- **Separation of concerns**: Each module has one clear purpose
- **Loose coupling**: Modules interact through well-defined interfaces
- **High cohesion**: Related functionality lives together
- **Explicit dependencies**: No hidden connections
- **Testability**: Architecture supports easy testing

**Common patterns**:
- Layered (presentation → business → data)
- Hexagonal (ports and adapters)
- Event-driven
- CQRS (Command Query Responsibility Segregation)
- Microservices

**Links**:
- [Architecture Patterns](architecture/patterns.md)
- [Module Boundaries](architecture/boundaries.md)
- [Data Flow Design](architecture/data-flow.md)

### 3. Implementation Guidance

**Purpose**: Write code that is correct, readable, and maintainable.

**Key principles**:
- **Clarity over cleverness**: Code is read more than written
- **YAGNI**: Don't build what you don't need yet
- **DRY with judgment**: Duplication is better than wrong abstraction
- **Fail fast**: Detect errors early, surface them clearly
- **Immutability by default**: Mutable state is error-prone

**When to abstract**:
```
Rule of Three:
- First time: Just write the code
- Second time: Note the duplication
- Third time: Consider abstraction (if patterns match)
```

**Links**:
- [Best Practices](implementation/best-practices.md)
- [Design Patterns](implementation/patterns.md)

### 4. Refactoring

**Purpose**: Improve code structure without changing behavior.

**When to refactor**:
- Before adding features (make change easy, then make easy change)
- When code is hard to understand
- When patterns emerge from duplication
- When tests are hard to write

**When NOT to refactor**:
- Code that works and won't change
- Without tests to verify behavior
- Under time pressure (unless it blocks the work)
- Just because it's "not how I'd write it"

**Refactoring strategies**:
- **Strangler fig**: Gradually replace old with new
- **Branch by abstraction**: Introduce seam, swap implementation
- **Parallel change**: Run old and new simultaneously, verify, cut over

**Link**: [Refactoring](refactoring.md)

### 5. API Design

**Purpose**: Create interfaces that are intuitive, consistent, and evolvable.

**Design principles**:
- **Consistency**: Similar things work similarly
- **Predictability**: Behavior matches expectations
- **Simplicity**: Easy things are easy, hard things are possible
- **Evolvability**: Can add features without breaking clients

**REST API guidelines**:
```
GET    /resources      → List resources
GET    /resources/:id  → Get single resource
POST   /resources      → Create resource
PUT    /resources/:id  → Replace resource
PATCH  /resources/:id  → Update resource partially
DELETE /resources/:id  → Delete resource
```

**Link**: [API Design](api-design.md)

### 6. Performance

**Purpose**: Build systems that meet performance requirements efficiently.

**Approach**:
```
1. Define requirements (latency, throughput, resource usage)
2. Measure current state (don't guess)
3. Identify bottlenecks (profile, don't assume)
4. Optimize the bottleneck
5. Measure again
6. Repeat if needed
```

**Performance hierarchy** (optimize in order):
1. **Algorithm**: O(n) vs O(n²) matters more than anything
2. **Architecture**: Caching, async, batching
3. **Implementation**: Data structures, memory layout
4. **Micro-optimization**: Usually not worth it

**Common optimizations**:
- Caching (but: cache invalidation is hard)
- Pagination (don't load everything)
- Lazy loading (load on demand)
- Denormalization (trade storage for speed)
- Connection pooling
- Async processing for non-critical paths

**Link**: [Performance](performance.md)

### 7. CI/CD Architecture

**Purpose**: Design build and deployment pipelines that enable fast, safe delivery.

**Pipeline principles**:
- **Fast feedback**: Fail fast, surface errors quickly
- **Reproducibility**: Same inputs → same outputs
- **Isolation**: Steps don't affect each other unexpectedly
- **Visibility**: Easy to see what's happening and why

**Typical pipeline stages**:
```
1. Build         → Compile, bundle
2. Test          → Unit, integration
3. Static Analysis → Lint, type-check, security scan
4. Package       → Create deployable artifact
5. Deploy (staging) → Deploy to test environment
6. Smoke test    → Verify deployment works
7. Deploy (production) → Deploy to production
```

**Deployment strategies**:
- **Rolling**: Gradually replace instances
- **Blue-green**: Switch traffic between two identical environments
- **Canary**: Route small percentage to new version first
- **Feature flags**: Deploy code, control activation separately

**Link**: [CI/CD Architecture](cicd-architecture.md)

## Engineering vs. Housekeeping

| Aspect | Engineering | Housekeeping |
|--------|-------------|--------------|
| Focus | Creating capability | Maintaining health |
| Question | "How should we build this?" | "How do we keep this clean?" |
| Tech debt | Designs solution | Identifies and tracks |
| CI/CD | Architects pipeline | Maintains configuration |
| Refactoring | Plans approach | Detects need |
| Dependencies | Selects and introduces | Cleans and updates |

**Collaboration points**:
- Engineering designs refactoring → Housekeeping verifies cleanup complete
- Housekeeping identifies tech debt → Engineering designs solution
- Engineering selects new dependency → Housekeeping maintains it

## Common Workflows

### Workflow 1: Technical Decision

**Trigger**: Need to choose between options (framework, approach, tool)

**Steps**:
1. **Clarify the problem**
   - What exactly are we trying to solve?
   - What are the constraints (time, team skill, existing systems)?

2. **Identify options**
   - What are the realistic choices?
   - Don't enumerate everything, focus on viable options

3. **Evaluate trade-offs**
   - For each option: pros, cons, risks
   - Consider: learning curve, maintenance burden, community support

4. **Make and document decision**
   - Choose the option that best fits constraints
   - Write ADR (Architecture Decision Record) if significant

5. **Plan validation**
   - How will we know if this was wrong?
   - What's the exit strategy if needed?

### Workflow 2: Architecture Design

**Trigger**: New feature/system needs structural planning

**Steps**:
1. **Understand requirements**
   - What does the system need to do?
   - What are the quality attributes (performance, scalability, security)?

2. **Identify components**
   - What are the major pieces?
   - What are their responsibilities?

3. **Define boundaries**
   - How do components communicate?
   - What are the interfaces?

4. **Consider cross-cutting concerns**
   - Error handling
   - Logging and monitoring
   - Authentication/authorization

5. **Document and validate**
   - Create architecture diagram
   - Walk through key scenarios
   - Get feedback from team

### Workflow 3: Refactoring Plan

**Trigger**: Code needs structural improvement

**Steps**:
1. **Assess current state**
   - What's the problem with current structure?
   - What tests exist?

2. **Define target state**
   - What should the code look like after?
   - What benefits do we expect?

3. **Plan incremental steps**
   - Break into small, safe changes
   - Each step should leave code working

4. **Execute with verification**
   - Make change
   - Run tests
   - Commit
   - Repeat

5. **Verify improvement**
   - Did we achieve the goal?
   - Any unexpected issues?

## Principles for Good Engineering

### Simplicity First

> "Simple things should be simple, complex things should be possible." — Alan Kay

- Start with the simplest solution that could work
- Add complexity only when proven necessary
- Question every abstraction: does it earn its keep?

### Reversibility

- Prefer decisions that are easy to reverse
- When irreversible, invest more in evaluation
- Build in escape hatches where possible

### Pragmatism over Purity

- Perfect is the enemy of good
- Working software beats elegant architecture
- Best practices are guidelines, not laws
- Context determines the right approach

### Continuous Learning

- Every project teaches something
- Mistakes are learning opportunities
- Share knowledge with the team
- Stay curious about better approaches

