# Documentation Organization Strategies

Guide for designing documentation organization that fits your project - focused on principles and decision-making rather than prescriptive structures.

## Table of Contents

- [Core Principles](#core-principles)
- [Decision Dimensions](#decision-dimensions)
- [Common Strategy Patterns](#common-strategy-patterns)
- [Real-World Examples](#real-world-examples)
- [Decision Framework](#decision-framework)
- [Anti-Patterns](#anti-patterns)

## Core Principles

These principles apply regardless of your specific directory structure:

### 1. Discoverability Over Neatness

**Good:**
- Important docs linked from README.md or AGENTS.md
- Clear entry points for different audiences
- Searchable file names with keywords

**Bad:**
- Perfectly organized but buried 5 levels deep
- No index or navigation
- Generic names like "doc1.md", "notes.md"

### 2. Fit Your Project, Not a Template

**Questions to ask:**
- Who reads our documentation? (team only? public users? agents?)
- How much documentation do we have? (5 files? 500?)
- How is it maintained? (with code? separate process? generated?)
- Where is it published? (repo only? website? wiki?)

**Your answers determine your structure**, not a one-size-fits-all template.

### 3. Minimize Ceremony

Start simple, add structure only when pain points emerge:

- **5-20 docs:** Flat structure is fine
- **20-100 docs:** Add 2-3 top-level categories
- **100+ docs:** Consider hierarchical organization

Don't create elaborate directory structures for 10 markdown files.

### 4. Make It Living, Not Dead

Documentation is "alive" when:
- ✅ Updated alongside code changes
- ✅ Easy to find and navigate
- ✅ Clear ownership and maintenance
- ✅ Regular cleanup of outdated content
- ✅ Integrated into workflows (e.g., RFC for design decisions)

Documentation is "dead" when:
- ❌ Written once, never updated
- ❌ Buried in obscure locations
- ❌ Duplicated in multiple places
- ❌ No one knows what's still relevant

**Structure should support "alive" documentation.**

### 5. Separate by Maintenance, Not Just Topic

Consider grouping documents by:
- **Who maintains them** (team A vs team B)
- **How they're updated** (manual vs generated)
- **Publication pipeline** (stays in repo vs published to website)
- **Access control** (public vs internal)

This often matters more than topical similarity.

## Decision Dimensions

### Dimension 1: Public vs Internal

**Strategy A: Separate at Top Level**
```
docs-public/          # or just 'docs/'
website/              # or 'documentation/'
.internal/            # or 'team-docs/'
```
When: Clear publication boundary, different processes

**Strategy B: Mixed with Markers**
```
docs/
├── api/              # Public
├── guides/           # Public
└── .architecture/    # Internal (dot-prefix or other convention)
```
When: Similar maintenance, want unified search

**Strategy C: All Public (or All Internal)**
```
docs/                 # Everything is public
README.md
AGENTS.md
```
When: No internal-only docs, or private repository

**Strategy D: Public in Repo, Internal Elsewhere**
```
docs/                 # Public only
# Internal docs in wiki/Notion/Google Docs
```
When: Different tools for different audiences

### Dimension 2: Generated vs Manual

**Strategy A: Separate Directories**
```
docs/                 # Manual, version controlled
api-docs/             # Generated, gitignored
build/                # Build output
```
When: Generated docs rebuilt frequently, don't want in git history

**Strategy B: Mixed, Different Extensions**
```
docs/
├── guide.md          # Manual
└── api.html          # Generated
```
When: Both published together, different formats

**Strategy C: Source vs Output**
```
docs/
└── source/           # Manual markdown
website/
└── build/            # Generated from source
```
When: Using doc generator like Sphinx, Docusaurus, MkDocs

### Dimension 3: Granularity

**Strategy A: Flat**
```
docs/
├── installation.md
├── configuration.md
├── api-reference.md
├── architecture.md
└── contributing.md
```
When: <50 docs, single team, similar types

**Strategy B: Grouped**
```
docs/
├── user-guide/
├── developer-guide/
└── architecture/
```
When: 50-200 docs, clear groupings, multiple audiences

**Strategy C: Hierarchical**
```
docs/
├── guides/
│   ├── user/
│   └── developer/
├── reference/
│   ├── api/
│   └── cli/
└── architecture/
    ├── decisions/
    └── diagrams/
```
When: 200+ docs, complex project, multiple teams

**Rule of thumb:** Stop at 2-3 levels deep. If you need more, reconsider your groupings.

### Dimension 4: Code-Adjacent vs Centralized

**Strategy A: Centralized**
```
docs/                 # All documentation here
src/                  # Code only (maybe minimal README)
```
When: Documentation managed separately from code

**Strategy B: Distributed**
```
src/
├── auth/
│   ├── README.md     # Auth-specific docs
│   └── api.md
└── payments/
    ├── README.md
    └── integration.md
docs/
└── overview.md       # High-level only
```
When: Microservices, component teams, docs maintained with code

**Strategy C: Hybrid**
```
src/
└── auth/
    └── README.md     # Component-specific implementation notes
docs/
├── architecture/
│   └── auth.md       # Overall auth architecture
└── guides/
    └── authentication.md  # User guide
```
When: Need both component details and cross-cutting documentation

## Common Strategy Patterns

These are common patterns, not requirements. Pick what fits your project.

### Pattern 1: Simple README-First

**What:**
- README.md (comprehensive)
- AGENTS.md (for AI agents)
- LICENSE
- CONTRIBUTING.md (if open source)

**When:**
- Small projects (<10k lines)
- Single team
- Limited documentation needs

**Example projects:**
- CLI tools
- Libraries
- Small services

### Pattern 2: Audience-Based

**What:**
```
docs/                 # User-facing
team/                 # Internal
# or
public/
internal/
```

**When:**
- Clear separation needed
- Different publication processes
- Different maintenance teams

**Example projects:**
- SaaS products (user docs vs runbooks)
- APIs (public reference vs internal architecture)

### Pattern 3: Type-Based (Diátaxis)

**What:**
```
docs/
├── tutorials/        # Learning-oriented
├── guides/           # Task-oriented
├── reference/        # Information-oriented
└── explanations/     # Understanding-oriented
```

**When:**
- Public documentation focus
- Multiple documentation types
- User-facing product

**Example projects:**
- Frameworks
- Developer tools
- Open source projects

### Pattern 4: Feature/Component-Based

**What:**
```
docs/
├── authentication/
├── api-gateway/
└── data-pipeline/
```

**When:**
- Microservices architecture
- Component teams own documentation
- Strong code-to-docs mapping

**Example projects:**
- Large distributed systems
- Multi-team products

### Pattern 5: Minimal + Wiki/External

**What:**
```
README.md
AGENTS.md
# Everything else in Confluence/Notion/GitHub Wiki
```

**When:**
- Team prefers collaborative editing tools
- Documentation needs rich formatting/collaboration
- Separation of code and docs preferred

**Example projects:**
- Enterprises with existing doc platforms
- Non-technical stakeholders involved

## Real-World Examples

### Example 1: Open Source Library (Small)

**Project:** TypeScript utility library, 5k lines, 3 contributors

**Choice:**
```
README.md             # Overview, quick start, API reference
CONTRIBUTING.md
LICENSE
examples/             # Code examples
```

**Why:**
- Small scope, documentation fits in README
- Examples speak louder than prose
- No internal/external distinction needed

**Agent docs:** Not needed, README sufficient

---

### Example 2: Company Internal API (Medium)

**Project:** REST API service, 50k lines, 10-person team

**Choice:**
```
README.md             # Quick overview
AGENTS.md             # Agent navigation
docs/
├── api-reference.md  # Generated from OpenAPI
├── runbooks/         # Operations guides
├── architecture/     # Design docs
└── rfcs/             # Decision records
```

**Why:**
- Internal only (no public/private split needed)
- Operations content separate from design docs
- RFCs track major decisions

**Agent docs:** AGENTS.md links to key workflows

---

### Example 3: SaaS Product (Large)

**Project:** Multi-service platform, 500k lines, 50 engineers

**Choice:**
```
README.md
docs/                 # Public user documentation
├── getting-started/
├── guides/
├── api/
└── examples/
.wiki/                # Internal team wiki (git submodule)
├── architecture/
├── runbooks/
├── processes/
└── rfcs/
services/             # Each service has its own README
└── auth-service/
    └── README.md
```

**Why:**
- Public docs published to website from `docs/`
- Internal wiki separate (different access, tools, maintenance)
- Service READMEs for distributed ownership

**Agent docs:** Not practical to index everything; agents read on-demand

---

### Example 4: Open Source Framework (Large)

**Project:** Web framework, 200k lines, 100+ contributors

**Choice:**
```
README.md
website/              # Docusaurus/MkDocs source
└── docs/
    ├── tutorial/
    ├── guide/
    ├── reference/
    └── advanced/
CONTRIBUTING.md
rfcs/                 # Design proposals
```

**Why:**
- Documentation as important as code
- Multiple audience levels (beginner to expert)
- Website generator needs specific structure
- RFCs for community input on changes

**Agent docs:** Framework too large; agents navigate via search

---

### Example 5: Consulting/Agency Projects

**Project:** Client projects, varying sizes

**Choice:**
```
README.md             # Project overview
AGENTS.md             # Agent context for this specific project
docs/
└── client-facing.md  # Handoff documentation
.internal/
├── decisions.md      # Why we made certain choices
└── notes/            # Meeting notes, explorations
```

**Why:**
- Need to separate what client sees vs internal notes
- Lightweight (not building long-term product)
- Clear handoff documentation

**Agent docs:** AGENTS.md updated per project specifics

## Decision Framework

Use this to choose your organization strategy:

### Step 1: Assess Current State

**How much documentation do you have?**
- <10 files → Flat is fine
- 10-50 files → Consider 2-3 categories
- 50-200 files → Hierarchical might help
- 200+ files → Likely need structure

**Who are your audiences?**
- Single (e.g., just team) → No need to separate
- Multiple (e.g., users + team) → Consider separation
- Public + private → Definitely separate

**How is it maintained?**
- Manual only → Simple structure
- Generated + manual → Separate by source
- Multiple teams → Consider ownership-based structure

### Step 2: Choose Primary Organizing Principle

Pick ONE primary dimension (you can nest others inside):

**By Audience** (public/internal)
- Clear publication boundary
- Different maintenance processes

**By Type** (guides/reference/explanations)
- Documentation-heavy projects
- User-facing products

**By Feature/Component**
- Microservices
- Distributed ownership

**By Lifecycle** (active/archive)
- Long-lived projects
- Historical decision tracking

### Step 3: Add Secondary Structure (If Needed)

Only add nested structure if you have pain points:
- Can't find documents → Add categorization
- Unclear ownership → Organize by team
- Mixed audiences → Add audience subdirectories

### Step 4: Establish Conventions

Document your chosen strategy:

**In README.md or AGENTS.md:**
```markdown
## Documentation

- `docs/` - User-facing guides and API reference
- `runbooks/` - Operations and incident response
- `rfcs/` - Design decisions and proposals
- Each service has a README.md with service-specific docs
```

**File naming:**
- Lowercase with hyphens: `api-reference.md`
- Descriptive: `oauth-implementation-guide.md` not `guide.md`
- Date-prefixed for temporary: `2026-01-30-investigation.md`

**Lifecycle policy:**
- Where do temporary docs go?
- How long until review?
- Who owns cleanup?

### Step 5: Start Simple, Evolve

**Don't over-engineer upfront:**
1. Start with README.md + flat `docs/`
2. Add structure when you feel pain
3. Refactor when navigation becomes difficult
4. Document changes in commit messages

**Red flags that you need more structure:**
- Difficult to find relevant documents
- Frequent name conflicts
- Unclear where new docs should go
- Multiple READMEs competing for attention

## Anti-Patterns

### ❌ Copying Someone Else's Structure

Don't copy directory structures from other projects without understanding why they made those choices.

**Why it fails:** Their needs ≠ your needs

### ❌ Over-Organizing Early

Creating elaborate hierarchies before you have documentation.

**Why it fails:** Premature optimization; structure will be wrong

### ❌ Too Deep

Nesting beyond 3 levels.

```
docs/internal/engineering/backend/services/auth/documentation/guides/setup.md
```

**Why it fails:** Navigation nightmare, hard to remember paths

### ❌ Inconsistent Organization

Mixing organizing principles without clarity.

```
docs/
├── api/              # By type
├── authentication/   # By feature
├── internal/         # By audience
└── old/              # By lifecycle
```

**Why it fails:** No mental model for where things go

### ❌ Everything in Code Directories

```
src/auth/everything-about-auth.md        # 500 lines
src/payments/all-payment-docs.md         # 800 lines
```

**Why it fails:** Code directories are for code; cross-cutting docs are hard to find

### ❌ No Index or Navigation

Perfect organization but no README.md or AGENTS.md linking to it.

**Why it fails:** Structure without discoverability is useless

### ❌ Multiple "Sources of Truth"

```
docs/api.md
wiki/API-Documentation
confluence/API Reference
README.md (API section)
```

**Why it fails:** Impossible to know which is current

## Quick Decision Tree

```
Do you have <10 docs?
├─ Yes → Flat structure (README + maybe docs/)
└─ No → Continue

Do you have public AND internal docs?
├─ Yes → Separate them (how depends on publication)
└─ No → Continue

Do you have >100 docs?
├─ Yes → Hierarchical structure needed
│   ├─ Multiple teams? → Organize by ownership
│   ├─ Multiple products? → Organize by product
│   └─ Single coherent project? → Organize by type or feature
└─ No → Light structure (2-3 top-level categories)

Is documentation generated?
├─ Yes → Separate source from output
└─ No → Keep with content

Microservices architecture?
├─ Yes → Consider component-based (distributed docs)
└─ No → Consider centralized docs/
```

## Summary

**The goal is not perfect organization, but useful documentation.**

- Start with principles: discoverability, fit your project, minimize ceremony
- Choose structure based on your specific needs, not templates
- One primary organizing dimension, add secondary only if needed
- Document your conventions
- Evolve as project grows

**When in doubt: simpler is better.**
