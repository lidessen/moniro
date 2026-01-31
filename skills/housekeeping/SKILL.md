---
name: housekeeping
description: Manages project housekeeping including documentation organization (AGENTS.md, RFC processes, structure), dependency management (cleanup unused packages, update outdated deps), directory structure organization, code cleanup (remove dead code, consolidate duplicates), technical debt tracking, and infrastructure configuration. Use when organizing documentation, cleaning up dependencies (package.json, requirements.txt), reorganizing folders, removing dead code, addressing tech debt, or maintaining project structure and configuration.
---

# Project Housekeeping

Maintains project infrastructure, organization, and cleanliness - the "home management" that keeps projects healthy as they grow. While feature development focuses on external value ("building the business"), housekeeping focuses on internal quality ("managing the home").

**Not this skill**: For technical decisions (architecture, API design, tech choices), use `engineering`.

## Quick Start

### Common Housekeeping Tasks

**Documentation Management**
- Organize project documentation → [documentation/organization-strategies.md](documentation/organization-strategies.md)
- Write AGENTS.md/CLAUDE.md → [documentation/agent-docs.md](documentation/agent-docs.md)
- Set up RFC process → [documentation/rfc-process.md](documentation/rfc-process.md)
- Audit and clean up docs → [documentation/lifecycle.md](documentation/lifecycle.md)

**Dependency Management**
- Remove unused dependencies → [dependency-management.md](dependency-management.md)
- Update outdated packages → [dependency-management.md](dependency-management.md)
- Address security vulnerabilities → [dependency-management.md](dependency-management.md)

**Directory & Code Organization**
- Reorganize messy directories → [directory-structure.md](directory-structure.md)
- Remove dead code → [code-organization.md](code-organization.md)
- Consolidate duplicates → [code-organization.md](code-organization.md)
- Split large files → [code-organization.md](code-organization.md)

**Technical Debt & Infrastructure**
- Track and address tech debt → [tech-debt.md](tech-debt.md)
- Update project configs → [infrastructure.md](infrastructure.md)
- Maintain build system → [infrastructure.md](infrastructure.md)

## Six Areas of Project Housekeeping

### 1. Documentation Management

**Purpose**: Ensure documentation remains useful, discoverable, and current.

**Key activities**:
- Organize docs by audience (internal/public) and purpose
- Create navigation files (AGENTS.md) for AI agents
- Implement lifecycle management (cleanup temporary docs)
- Use RFC process for significant decisions
- **Verify index consistency** (README lists vs actual directories)

**Common problems addressed**:
- Can't find documentation
- Docs outdated or conflicting
- No clear place for new docs
- Documentation not used by team or agents
- Index documents (README, CLAUDE.md) don't reflect actual content

**Links**:
- [Organization Strategies](documentation/organization-strategies.md) - How to structure documentation
- [Lifecycle Management](documentation/lifecycle.md) - Keeping docs alive, not dead
- [Agent Documentation](documentation/agent-docs.md) - AGENTS.md/CLAUDE.md guidelines
- [RFC Process](documentation/rfc-process.md) - Design proposal workflow
- [Quick Reference](documentation/quick-reference.md) - Decision trees and patterns

### 2. Dependency Management

**Purpose**: Minimize dependency burden while keeping packages current and secure.

**Key activities**:
- Detect and remove unused dependencies
- Update outdated packages (patch, minor, major)
- Address security vulnerabilities
- Organize dependency files (package.json, requirements.txt)
- Manage lockfiles properly

**Common problems addressed**:
- Bloated node_modules or venv
- Security vulnerabilities
- Outdated packages causing compatibility issues
- Unclear what each dependency does

**Why it matters**: Every dependency is a liability - maintenance burden, security risk, and complexity. Keep only what provides value.

**Link**: [Dependency Management](dependency-management.md)

### 3. Directory Structure Organization

**Purpose**: Make it easy to find files and understand project layout.

**Key activities**:
- Detect structure smells (too deep, too flat, inconsistent)
- Choose organization pattern (by feature, layer, or type)
- Reorganize incrementally or comprehensively
- Maintain consistent naming conventions

**Common problems addressed**:
- "Where should this file go?" confusion
- Deep nesting (>5 levels)
- Flat structure with 50+ files in one directory
- Inconsistent naming (camelCase vs snake_case vs kebab-case)

**Why it matters**: Structure should make discovery easy and match how the team thinks about the code.

**Link**: [Directory Structure](directory-structure.md)

### 4. Code Organization

**Purpose**: Keep code clean, avoid duplication, and maintain clear module boundaries.

**Key activities**:
- Detect and remove dead code
- Find and consolidate duplicates
- Split large files (>500 lines)
- Merge scattered related code
- Relocate files to better locations

**Common problems addressed**:
- Unused functions and variables cluttering codebase
- Same code duplicated in multiple places
- Files too large to navigate (>1000 lines)
- Related code scattered across project

**Why it matters**: Clean code is easier to understand, modify, and maintain. Duplication creates maintenance burden.

**Link**: [Code Organization](code-organization.md)

### 5. Technical Debt Management

**Purpose**: Track and systematically address tech debt without blocking feature development.

**Key activities**:
- Identify and document tech debt
- Prioritize by impact and effort
- Handle deprecations properly
- Deal with legacy code strategically
- Integrate debt work into development process

**Common problems addressed**:
- Tech debt accumulates unchecked
- Team velocity decreasing
- Engineers avoiding certain code areas
- No visibility into debt impact

**Why it matters**: Like financial debt, tech debt compounds. Small amounts are fine; unchecked accumulation cripples productivity.

**Link**: [Technical Debt](tech-debt.md)

### 6. Project Infrastructure

**Purpose**: Maintain configuration files, build systems, and development environment.

**Key activities**:
- Manage config files (.gitignore, .editorconfig, etc.)
- Maintain build system configuration
- Keep CI/CD configs current
- Organize development environment (Docker, scripts)
- Update tooling configs (ESLint, Prettier, etc.)

**Common problems addressed**:
- Outdated build configuration
- Inconsistent development environments
- No CI/CD or broken pipelines
- Secrets accidentally committed

**Why it matters**: Infrastructure is the foundation. Poor infrastructure creates friction for every developer, every day.

**Link**: [Infrastructure](infrastructure.md)

## General Principles

### When to Do Housekeeping

**Regular cadence**:
- **Weekly**: Quick checks (unused imports, dead code warnings)
- **Monthly**: Dependency updates, documentation review
- **Quarterly**: Full project audit, tech debt sprint
- **Annual**: Major infrastructure updates

**Event-triggered**:
- **Before major refactors**: Clean house first
- **When onboarding**: Confusion reveals organizational issues
- **When velocity slows**: Tech debt may be accumulating
- **After releases**: Stable period for maintenance work

**Opportunistic**:
- **When touching code**: Leave it cleaner than you found it (Boy Scout Rule)
- **When blocked**: Use waiting time for housekeeping

### Housekeeping vs. Development

**Housekeeping** (this skill):
- Internal quality
- Project organization
- Infrastructure maintenance
- Making work easier

**Development** (feature work):
- External value
- User-facing features
- Business logic
- Delivering functionality

**Both are essential**: Features without housekeeping = unsustainable mess. Housekeeping without features = no product.

**Balance**: 80-90% development, 10-20% housekeeping (adjust based on project health).

### Progressive Approach

**Don't block development** with perfectionism:
- ✅ Incremental improvements
- ✅ Clean as you go
- ✅ Fix high-impact issues first
- ❌ Freeze all work for "cleanup month"
- ❌ Perfectionism paralysis
- ❌ Over-organizing small projects

**Start small**: Pick one area, make it better. Repeat.

## Common Workflows

### Workflow 1: Project Health Audit

**Goal**: Comprehensive check across all 6 housekeeping areas

**Frequency**: Quarterly or when project feels "messy"

**Steps**:
1. **Documentation audit**
   - Find all markdown files: `find . -name "*.md"`
   - Check for outdated content (last modified >6 months)
   - Verify AGENTS.md is current
   - Clean up temporary docs
   - **Index consistency**: Compare index docs (README, CLAUDE.md) against actual directories
     - Do listed items match existing directories/files?
     - Are new directories missing from indexes?

2. **Dependency check**
   - List outdated: `npm outdated` or `pip list --outdated`
   - Run security audit: `npm audit` or `safety check`
   - Find unused: `depcheck` or manual review
   - Update or remove as needed

3. **Directory structure review**
   - Identify structure smells (too deep, too flat, inconsistent)
   - Check for single-file directories
   - Verify naming consistency
   - Plan reorganization if needed

4. **Code cleanup**
   - Run dead code detection: `ts-prune`, `vulture`, etc.
   - Check for duplication: `jscpd`
   - Find large files: `find . -name "*.ts" -exec wc -l {} + | sort -rn | head -20`
   - Address top issues

5. **Tech debt inventory**
   - Search for TODOs: `rg "TODO|FIXME|HACK"`
   - Review DEBT.md or tech debt tickets
   - Prioritize top 3-5 items

6. **Infrastructure check**
   - Verify CI/CD working
   - Check for secrets in git: `git log -p | rg "API_KEY|PASSWORD"`
   - Update outdated configs
   - Ensure `.gitignore` comprehensive

**Output**: Prioritized list of housekeeping tasks for next quarter

### Workflow 2: Dependency Cleanup

**Goal**: Remove unused deps, update outdated ones, fix vulnerabilities

**Steps**:
1. Find unused dependencies: `depcheck` (npm) or `pipdeptree` (Python)
2. Verify each is truly unused: `rg "package-name"`
3. Remove: `npm uninstall package-name`
4. Test: `npm test && npm run build`
5. Check for outdated: `npm outdated`
6. Update patch versions (safe): `npm update`
7. Selectively update minor/major: `ncu -i`
8. Test after updates
9. Run security audit: `npm audit`
10. Fix vulnerabilities: `npm audit fix` or manual updates
11. Commit changes

**Time**: 1-2 hours monthly

### Workflow 3: Documentation Audit

**Goal**: Ensure documentation is current, organized, and discoverable

**Steps**:
1. Inventory all docs: `find . -name "*.md" > docs-inventory.txt`
2. Classify each: keep/update/archive/delete
3. Check for outdated: `find . -name "*.md" -mtime +180` (>6 months old)
4. Clean up temporary docs (docs/notes/ or similar)
5. Verify AGENTS.md reflects current structure
6. **Index consistency check**:
   - Identify index documents (README, CLAUDE.md, docs/index.md)
   - Compare listed items against actual directories/files
   - Add missing items, remove stale references
7. Fix broken links: check manually or with tool
8. Update navigation in README
9. Archive or delete obsolete content
10. Commit changes

**Time**: 2-4 hours quarterly

(See [documentation-audit example](examples/documentation-audit.md) for detailed walkthrough)

### Workflow 4: Codebase Cleanup Sprint

**Goal**: Dedicated time to address accumulated code issues

**When**: Quarterly or when code quality noticeably degraded

**Steps**:
1. **Prepare** (before sprint):
   - Run analysis tools (dead code, duplication, complexity)
   - Identify top 10 problem areas
   - Prioritize by impact

2. **During sprint**:
   - Remove dead code
   - Consolidate duplicates
   - Split large files
   - Fix structure issues
   - Each change: small commit, test, repeat

3. **Verify**:
   - All tests pass
   - No functionality broken
   - Metrics improved (coverage, complexity, duplication)

4. **Document**:
   - Summarize changes in commit message or PR
   - Update AGENTS.md if structure changed

**Time**: 1-2 days per quarter

## Navigation

### Documentation Management
- [Organization Strategies](documentation/organization-strategies.md)
- [Lifecycle Management](documentation/lifecycle.md)
- [Agent Documentation Guidelines](documentation/agent-docs.md)
- [RFC Process](documentation/rfc-process.md)
- [Quick Reference](documentation/quick-reference.md)

### Other Housekeeping Areas
- [Dependency Management](dependency-management.md)
- [Directory Structure Organization](directory-structure.md)
- [Code Organization](code-organization.md)
- [Technical Debt Management](tech-debt.md)
- [Project Infrastructure](infrastructure.md)

### Examples
- [New Project Setup](examples/new-project-setup.md)
- [Documentation Audit](examples/documentation-audit.md)

## Common Questions

**Q: How often should I do housekeeping?**
A: Quick checks weekly, focused work monthly, comprehensive audit quarterly. Don't wait until it's overwhelming.

**Q: Won't this slow down feature development?**
A: Short-term yes, long-term no. Tech debt and disorganization slow development more than regular housekeeping. Aim for 10-20% of time on housekeeping.

**Q: Where do I start with a messy project?**
A: Pick one area with most pain (likely docs or dependencies). Make that area good. Build momentum. Use [project health audit workflow](#workflow-1-project-health-audit).

**Q: How do I convince my team to prioritize this?**
A: Measure impact (velocity, onboarding time, bugs). Show quick wins. Integrate into regular work (don't ask for "cleanup month"). Frame as investment, not cost.

**Q: Should every TODO be tracked formally?**
A: No. Inline TODOs are fine for small things. Track formally (DEBT.md or tickets) for items that require dedicated work or affect velocity.

**Q: When should I reorganize directory structure?**
A: When finding files becomes painful or new developers are confused. Don't reorganize for perfection. See [directory-structure.md](directory-structure.md) decision framework.
