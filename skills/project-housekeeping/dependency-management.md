# Dependency Management

Strategies and tools for managing project dependencies - cleaning up unused packages, updating outdated ones, addressing security vulnerabilities, and maintaining dependency files.

## Table of Contents

- [Core Principles](#core-principles)
- [Detecting Unused Dependencies](#detecting-unused-dependencies)
- [Finding Outdated Packages](#finding-outdated-packages)
- [Security Vulnerability Management](#security-vulnerability-management)
- [Update Strategies](#update-strategies)
- [Dependency File Organization](#dependency-file-organization)
- [Lockfile Management](#lockfile-management)
- [Common Workflows](#common-workflows)
- [Tool-Specific Guides](#tool-specific-guides)

## Core Principles

### 1. Dependencies Are Liabilities

Every dependency adds:
- **Maintenance burden** - needs updates, security patches
- **Build complexity** - more downloads, slower installs
- **Attack surface** - more code that could have vulnerabilities
- **Breaking change risk** - dependencies can break your code

**Principle**: Minimize dependencies. Add only when value > cost.

### 2. Keep Dependencies Current

Outdated dependencies accumulate:
- **Security vulnerabilities** - known exploits
- **Compatibility issues** - harder to update later
- **Missing features** - can't use new capabilities
- **Technical debt** - large version jumps become risky

**Principle**: Regular small updates > rare big updates.

### 3. Explicit is Better Than Implicit

**Good**:
- Pinned versions in lockfiles
- Explicit version ranges in dependency files
- Documented why each dependency exists

**Bad**:
- Auto-updating to latest (unpredictable)
- Transitive deps without awareness
- "It works on my machine" (no lockfile)

**Principle**: Control your dependencies explicitly.

## Detecting Unused Dependencies

### Why Dependencies Become Unused

- Feature removed but dep remained
- Replaced with different library
- Development dependency no longer needed
- Copy-pasted package.json from another project

### Detection Strategies

#### JavaScript/Node.js

**Tool: depcheck**
```bash
# Install
npm install -g depcheck

# Run analysis
depcheck

# Output shows:
# - Unused dependencies
# - Missing dependencies (used but not listed)
```

**Manual check**:
```bash
# Find imports in code
rg "^import .* from ['\"]([^'\"]+)" --only-matching --no-filename | sort -u

# Compare against package.json dependencies
```

#### Python

**Tool: pip-check**
```bash
# Install
pip install pip-check

# Find unused packages (requires code analysis)
# No perfect automated tool - manual review needed

# List installed packages
pip list

# Check what imports what
pipdeptree
```

**Manual approach**:
```bash
# Find imports in Python code
rg "^import |^from .+ import" -o | sort -u

# Compare against requirements.txt
```

#### Rust

**Tool: cargo-udeps** (requires nightly)
```bash
# Install
cargo install cargo-udeps --locked

# Run (requires nightly toolchain)
cargo +nightly udeps
```

#### Go

```bash
# Go modules handle this automatically
go mod tidy  # Removes unused dependencies
```

### Safe Removal Process

1. **Identify candidate** (appears unused)
2. **Verify** - Search codebase for any imports
3. **Check if transitive** - Maybe another package needs it
4. **Remove from dependency file**
5. **Test thoroughly** - Especially integration/E2E tests
6. **Commit separately** - Easy to revert if wrong

**Example workflow (npm)**:
```bash
# 1. Find unused
depcheck

# 2. Verify specific package
rg "package-name" --type js

# 3. Remove
npm uninstall package-name

# 4. Test
npm test

# 5. Commit
git add package.json package-lock.json
git commit -m "chore: remove unused dependency package-name"
```

## Finding Outdated Packages

### Check for Updates

#### JavaScript/Node.js

```bash
# Show outdated packages
npm outdated

# Output columns:
# Package | Current | Wanted | Latest
# wanted = satisfies your version range
# latest = newest version available

# Interactive update tool
npx npm-check-updates
ncu -i  # Interactive mode
```

#### Python

```bash
# Show outdated
pip list --outdated

# Tool: pip-review
pip install pip-review
pip-review --interactive
```

#### Rust

```bash
# Check for updates
cargo outdated

# Update Cargo.toml
cargo update
```

#### Go

```bash
# List available updates
go list -u -m all

# Update dependencies
go get -u ./...
go mod tidy
```

### Understanding Semantic Versioning

**Format**: MAJOR.MINOR.PATCH (e.g., 2.5.3)

- **PATCH** (2.5.3 → 2.5.4): Bug fixes, safe to update
- **MINOR** (2.5.3 → 2.6.0): New features, backward compatible (usually safe)
- **MAJOR** (2.5.3 → 3.0.0): Breaking changes (requires caution)

**Version ranges**:
```json
"^2.5.3"  // 2.5.3 <= version < 3.0.0 (common, allows minor/patch)
"~2.5.3"  // 2.5.3 <= version < 2.6.0 (only patch updates)
"2.5.3"   // Exact version
"*"       // Any version (dangerous, don't use)
```

**Strategy**:
- PATCH updates: Low risk, update freely
- MINOR updates: Medium risk, test before deploying
- MAJOR updates: High risk, review changelog, test extensively

## Security Vulnerability Management

### Vulnerability Scanning

#### JavaScript/Node.js

```bash
# Built-in npm audit
npm audit

# Shows:
# - Severity (low, moderate, high, critical)
# - Package with vulnerability
# - Vulnerable versions
# - Fix recommendation

# Auto-fix (caution: may break things)
npm audit fix

# Check what would change
npm audit fix --dry-run

# Force major version updates (risky)
npm audit fix --force
```

#### Python

```bash
# Tool: safety
pip install safety

# Check for vulnerabilities
safety check

# Check requirements file
safety check -r requirements.txt
```

#### Rust

```bash
# Tool: cargo-audit
cargo install cargo-audit

# Check for vulnerabilities
cargo audit
```

#### Go

```bash
# Tool: govulncheck
go install golang.org/x/vuln/cmd/govulncheck@latest

# Check for vulnerabilities
govulncheck ./...
```

### Responding to Vulnerabilities

**Priority by severity**:

**Critical/High**: Address immediately
- Production deployment holds
- Emergency update and deploy
- May require workarounds if fix unavailable

**Moderate**: Address soon (within sprint)
- Include in planned work
- May wait for next regular deployment

**Low**: Address eventually
- Track in backlog
- Include in routine dependency updates

**When no fix available**:
1. Check if vulnerability applies (affected code path used?)
2. Consider alternative package
3. Implement mitigation (input validation, isolation)
4. Document decision and monitor for updates

## Update Strategies

### Strategy 1: Regular Scheduled Updates

**Pattern**: Dedicate time for dependency updates

**Frequency options**:
- **Weekly**: For fast-moving projects
- **Monthly**: Common for most projects
- **Quarterly**: Minimum recommended

**Process**:
```bash
# 1. Check for updates
npm outdated

# 2. Update patch versions (safest)
npm update

# 3. Review minor/major updates
ncu -i

# 4. Test thoroughly
npm test
npm run build

# 5. Manual testing
# 6. Commit and deploy
```

### Strategy 2: Automated PR-Based Updates

**Tools**:
- **Dependabot** (GitHub)
- **Renovate** (GitHub/GitLab)
- **Greenkeeper** (deprecated, use Dependabot)

**Pattern**: Bot creates PR for each update
- CI runs automatically
- Review and merge when green
- Configurable grouping (all patch updates in one PR)

**Configuration example (Dependabot)**:
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      # Group patch updates
      patch-updates:
        update-types:
          - "patch"
```

**Pros**:
- Automatic
- CI validates
- Clear changelog per update

**Cons**:
- PR noise
- Requires good CI coverage
- Merge overhead

### Strategy 3: Manual Batch Updates

**Pattern**: Periodically update many deps at once

**When to use**:
- Before major features
- After releases (stable period)
- Addressing tech debt sprint

**Process**:
1. Create branch: `chore/dependency-updates-2026-01`
2. Update all non-breaking: `npm update`
3. Selectively update breaking: Review changelogs, update one at a time
4. Test thoroughly
5. Document breaking changes
6. Merge when stable

**Pros**:
- Controlled timing
- Batch testing
- Single large PR

**Cons**:
- Higher risk (many changes)
- Harder to debug if something breaks
- Can be disruptive

### Update Decision Matrix

| Scenario | Strategy | Rationale |
|----------|----------|-----------|
| Small team, rapid iteration | Manual scheduled (weekly/monthly) | Flexibility, controlled |
| Large team, many repos | Automated PRs | Scales, reduces burden |
| Critical production app | Manual batch + extensive testing | Control risk |
| Library/framework | Keep current (weekly automated) | Users need latest, compatibility |
| Legacy codebase | Manual batch (quarterly) | Minimize disruption |

## Dependency File Organization

### JavaScript (package.json)

**Good structure**:
```json
{
  "dependencies": {
    // Runtime dependencies, alphabetical
    "express": "^4.18.0",
    "lodash": "^4.17.21",
    "react": "^18.2.0"
  },
  "devDependencies": {
    // Development only, alphabetical
    "@types/node": "^20.0.0",
    "eslint": "^8.50.0",
    "jest": "^29.7.0",
    "typescript": "^5.2.0"
  }
}
```

**Bad patterns**:
- Mixed alphabetical order (hard to find)
- Runtime deps in devDependencies (breaks production)
- Dev deps in dependencies (bloats production bundle)

**Use `--save-dev` or `-D` for dev dependencies**:
```bash
npm install --save-dev jest  # Not regular --save
```

### Python (requirements.txt)

**Good structure**:
```txt
# Production dependencies
django==4.2.5
psycopg2-binary==2.9.7
redis==5.0.0

# Comments explain non-obvious choices
requests==2.31.0  # Pinned due to breaking change in 3.0

# Optional: Group by purpose
# Database
SQLAlchemy==2.0.21

# API
fastapi==0.103.2
uvicorn==0.23.2

# Testing (or use requirements-dev.txt)
pytest==7.4.2
pytest-cov==4.1.0
```

**Separate files pattern**:
```
requirements.txt         # Production only
requirements-dev.txt     # Development tools (includes requirements.txt)
requirements-test.txt    # Testing tools
```

**requirements-dev.txt**:
```txt
-r requirements.txt  # Include production deps

# Development tools
black==23.9.1
mypy==1.5.1
```

### Rust (Cargo.toml)

**Good structure**:
```toml
[dependencies]
# Runtime dependencies, alphabetical
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1.32", features = ["full"] }

[dev-dependencies]
# Development only
criterion = "0.5"
proptest = "1.3"
```

### Go (go.mod)

Go handles this automatically:
```bash
go mod tidy  # Cleans up and organizes
```

## Lockfile Management

### Purpose of Lockfiles

**Lockfiles** (package-lock.json, poetry.lock, Cargo.lock) ensure:
- **Reproducible builds** - Same versions on all machines
- **Transitive dependency pinning** - Control indirect deps
- **Faster installs** - No resolution needed

### When to Commit Lockfiles

**Always commit**:
- Applications (deployed software)
- APIs, services
- CLI tools

**Sometimes commit**:
- **Libraries**: Commit if running CI tests (ensures CI uses intended versions)
- **Libraries**: Don't commit if you want consumers to use latest compatible versions

**Never commit**:
- Nothing - always use lockfiles somewhere (at least CI)

### Lockfile Conflicts

**When they occur**:
- Concurrent dependency changes in different branches
- Merge conflicts in lockfile

**Resolution**:
```bash
# Don't manually edit lockfiles!

# JavaScript
npm install  # Regenerates lock based on package.json

# Python (poetry)
poetry lock

# Rust
cargo update
```

## Common Workflows

### Workflow 1: Quarterly Dependency Update

```bash
# 1. Create branch
git checkout -b chore/dependency-updates-2026-q1

# 2. Check current state
npm outdated

# 3. Update patch versions (safe)
npm update

# 4. Review and selectively update minor/major
ncu -i  # Interactive update

# 5. Review changes
git diff package.json

# 6. Install and test
npm install
npm test
npm run build

# 7. Manual testing critical paths

# 8. Document changes
git log --oneline > UPDATES.txt
# Edit UPDATES.txt with notable changes

# 9. Commit
git add package.json package-lock.json
git commit -m "chore: quarterly dependency updates (Q1 2026)

Updated X packages, including:
- Major: Y (breaking changes addressed)
- Minor: Z (new features available)
- Patch: A (bug fixes and security patches)

All tests passing. Manual testing completed.
"

# 10. Open PR
git push -u origin chore/dependency-updates-2026-q1
gh pr create --title "Quarterly Dependency Updates (Q1 2026)" --body "..."
```

### Workflow 2: Security Vulnerability Response

```bash
# 1. Run audit
npm audit

# 2. Review vulnerabilities
# Note severity, affected packages, fix availability

# 3. For each high/critical vulnerability:

# 3a. Check if fix available
npm audit fix --dry-run

# 3b. If simple fix, apply
npm audit fix

# 3c. If requires major update, manual:
npm install package-name@latest

# 3d. If no fix available:
# - Check if code path is used
# - Consider alternative package
# - Document risk acceptance if unavoidable

# 4. Test
npm test

# 5. Commit
git add package.json package-lock.json
git commit -m "fix(deps): address security vulnerabilities

Fixes:
- CVE-2023-XXXXX in package-name (updated to vX.Y.Z)
- CVE-2023-YYYYY in other-package (updated to vA.B.C)
"

# 6. Deploy ASAP
```

### Workflow 3: Removing Unused Dependencies

```bash
# 1. Find unused dependencies
depcheck

# 2. For each unused dependency, verify:
rg "package-name" --type js

# 3. If truly unused, remove
npm uninstall package-name

# 4. Test (especially integration tests)
npm test

# 5. Commit individually (easy to revert)
git add package.json package-lock.json
git commit -m "chore: remove unused dependency package-name"

# Repeat for each unused dependency
```

## Tool-Specific Guides

### npm (Node.js)

**Essential commands**:
```bash
npm install              # Install dependencies from package.json
npm update               # Update to latest within semver range
npm outdated             # Show outdated packages
npm audit                # Security check
npm audit fix            # Auto-fix vulnerabilities
npm uninstall <package>  # Remove dependency
npm prune                # Remove packages not in package.json
```

**Useful flags**:
```bash
npm install --production  # Only production deps (no devDependencies)
npm install --dry-run     # Preview what would happen
npm audit fix --dry-run   # Preview security fixes
```

**Tools**:
- `npm-check-updates` (ncu) - Interactive major version updates
- `depcheck` - Find unused dependencies

### pip (Python)

**Essential commands**:
```bash
pip install -r requirements.txt
pip list --outdated
pip install --upgrade <package>
pip uninstall <package>
pip freeze > requirements.txt  # Generate requirements file
```

**Tools**:
- `pip-review` - Interactive update tool
- `pipdeptree` - Show dependency tree
- `safety` - Security vulnerability checker

**Best practice: use virtual environments**:
```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### cargo (Rust)

**Essential commands**:
```bash
cargo build              # Build with dependencies
cargo update             # Update dependencies
cargo outdated           # Show outdated crates
cargo audit              # Security check
cargo tree               # Show dependency tree
```

**Cargo.toml tips**:
- Use `cargo add <crate>` to add dependencies (recent Cargo versions)
- Cargo.lock should be committed for applications
- Optional dependencies: `serde = { version = "1.0", optional = true }`

### go mod (Go)

**Essential commands**:
```bash
go mod init <module-name>    # Initialize module
go mod tidy                  # Clean up dependencies
go get <package>             # Add dependency
go get -u <package>          # Update dependency
go get -u ./...              # Update all dependencies
go list -m all               # List all dependencies
go list -u -m all            # Show available updates
```

**go.mod is automatically managed** - usually just need `go mod tidy`

## Best Practices Summary

1. **Regular audits** - Check dependencies monthly
2. **Security first** - Address vulnerabilities promptly
3. **Small updates** - Easier to debug than big batches
4. **Test thoroughly** - Especially after updates
5. **Use lockfiles** - Ensure reproducibility
6. **Minimize dependencies** - Each one is a liability
7. **Document decisions** - Why you pin, why you update
8. **Automate where possible** - But maintain control

**Red flags**:
- Dependencies not updated in >1 year
- Many unused dependencies
- No lockfile
- Wildcard version ranges (`*`, `latest`)
- Hundreds of dependencies (question if all needed)
- Ignoring security vulnerabilities
