# Review Checklist by Size

Focused checklists that adjust to change size. **Skip checks below your depth level.**

## Table of Contents

- [Priority Legend](#priority-legend)
- [Universal Checks (All Sizes)](#universal-checks-all-sizes)
- [Small Changes (<200 lines)](#small-changes-200-lines)
- [Medium Changes (200-800 lines)](#medium-changes-200-800-lines)
- [Large Changes (800-2000 lines)](#large-changes-800-2000-lines)
- [X-Large Changes (>2000 lines)](#x-large-changes-2000-lines)
- [Tool Delegation](#tool-delegation)
- [Language-Specific Quick Checks](#language-specific-quick-checks)

---

## Priority Legend

- 🔴 **Always check** (all sizes)
- 🟡 **Medium+ only** (skip for small if time limited)
- 🔵 **Small only** (skip for medium+)

---

## Universal Checks (All Sizes)

### 🔴 Security Critical

- [ ] **No hardcoded secrets** (API keys, passwords, tokens)
- [ ] **SQL queries parameterized** (no string concat with user input)
- [ ] **User input validated** before use (especially in file paths, URLs)
- [ ] **Authentication required** on protected endpoints
- [ ] **Authorization checked** (user can only access their own resources)
- [ ] **No command injection** (if executing shell commands with user input)

### 🔴 Data Integrity

- [ ] **Database changes have migrations** (if model changed, migration exists)
- [ ] **Transactions for multi-step operations** (create order + reduce inventory)
- [ ] **Backward compatible** for data model changes (existing data won't break)
- [ ] **Rollback possible** (migrations have DOWN, deploy can be reverted)

### 🔴 Breaking Changes

- [ ] **Function signatures preserved** OR all call sites updated
- [ ] **Public APIs versioned** if changed incompatibly
- [ ] **Data format changes migrated** (old and new format handled)

### 🔴 Impact Analysis (Signature Changes)

When function/type/API signature changed:
- [ ] **All call sites identified** (grep or language tools)
- [ ] **Sample call sites verified** (3-5 for medium, all for <5 sites)
- [ ] **Backward compatibility confirmed** OR breaking change documented

---

## Small Changes (<200 lines)

Can afford detail. Include quality checks.

### 🔵 Logic & Correctness

- [ ] Edge cases handled (null, empty, boundary values)
- [ ] Error handling present (try/catch, error returns)
- [ ] No off-by-one errors (array bounds, loop conditions)
- [ ] Async operations have error handling (catch, try/catch)

### 🔵 Code Quality

- [ ] Clear naming (functions/variables reveal intent)
- [ ] No magic numbers (extract to named constants)
- [ ] Functions focused (do one thing)
- [ ] No commented-out code (use git history)
- [ ] Complex logic commented or refactored

### 🔵 Testing

- [ ] New logic has tests
- [ ] Edge cases tested
- [ ] Error paths tested

---

## Medium Changes (200-800 lines)

**Focus on architecture and high-impact issues. Skip quality nitpicks.**

### 🟡 Architecture & Design

- [ ] Reasonable design (no over-engineering, no god classes)
- [ ] Dependencies injected (testable)
- [ ] Separation of concerns (UI, logic, data separate)
- [ ] No major code duplication

### 🟡 Performance

- [ ] No N+1 queries (use joins or eager loading)
- [ ] Pagination for large result sets
- [ ] Expensive operations cached or memoized
- [ ] Database indexes used (check query plans if available)

### 🟡 Error Handling

- [ ] Errors caught and handled gracefully
- [ ] User-friendly error messages (no stack traces to users)
- [ ] Cleanup in finally blocks (files closed, connections released)
- [ ] Partial failures handled (rollback or compensation)

### 🟡 API Contracts (if APIs changed)

- [ ] Input validation comprehensive
- [ ] Output format consistent
- [ ] HTTP status codes correct
- [ ] API documentation updated

### 🟡 Impact Analysis Deep Dive

For medium changes, **do impact analysis for**:
- [ ] Modified shared utilities → grep usage, verify compatibility
- [ ] Changed data types → check serialization, DB, API alignment
- [ ] New fields → verify: validation, storage, retrieval, display

**Skip** for medium:
- ❌ Naming improvements (unless truly confusing)
- ❌ Code style (let linter handle)
- ❌ Comment style
- ❌ Minor refactoring preferences

---

## Large Changes (800-2000 lines)

**Only review high-risk areas and architecture. Ignore everything else.**

### 🟡 High-Risk Areas Only

- [ ] **Security-sensitive code reviewed** (auth, payments, data access)
- [ ] **Database changes validated** (migrations, schema, data integrity)
- [ ] **Critical paths traced** (user registration, checkout, deletion)
- [ ] **Performance hotspots checked** (loops with DB calls, large data processing)

### 🟡 Architecture Assessment

- [ ] Overall design sound (no major anti-patterns)
- [ ] Scalability considered (if relevant)
- [ ] Major dependencies justified

### 🟡 Breaking Changes Tracked

- [ ] All breaking changes identified
- [ ] Migration path documented
- [ ] Version bump planned (if public API)

### 🟡 Impact Analysis (Critical Only)

- [ ] Modified core utilities → trace usage chains
- [ ] Changed shared data structures → verify all consumers updated
- [ ] API contract changes → verify clients notified/updated

**Skip** for large:
- ❌ All code quality feedback
- ❌ All style/formatting
- ❌ Minor logic improvements
- ❌ Test structure (trust CI)
- ❌ Documentation (unless critical)

---

## X-Large Changes (>2000 lines)

**Only review absolutely critical items. Require green CI before review.**

### 🔴 Critical Paths Only

- [ ] **Auth/security changes secure** (full flow traced)
- [ ] **Data migrations safe** (backward compatible, rollback exists)
- [ ] **Breaking changes documented** (migration guide, version bump)
- [ ] **Critical business logic correct** (payments, orders, deletions)

### 🔴 CI Must Be Green

- [ ] Tests passing ✅
- [ ] Linter passing ✅
- [ ] Type checks passing ✅
- [ ] Build successful ✅

**If CI not green, stop review and ask for green CI first.**

### 🔴 Impact Analysis (Core Changes Only)

- [ ] Core framework changes → assess blast radius
- [ ] Shared state management → verify thread safety, atomicity
- [ ] API versioning → confirm backward compatibility strategy

**Skip** for X-large:
- ❌ Everything except critical security, data integrity, breaking changes
- ❌ Rely on CI and tests for correctness
- ❌ Rely on linter for quality
- ❌ Defer detailed review until broken into smaller PRs (suggest splitting)

---

## Impact Analysis Checklist

When functions/types/APIs change, always perform:

### Step 1: Identify Changes
```bash
git diff <from>..<to> | grep -E "^[-+].*(function|def|class|interface|type)"
```

### Step 2: Find Usage
```bash
grep -r "functionName" --include="*.ts" .
# Or use language-specific tools (tsc, mypy, etc.)
```

### Step 3: Assess Impact
- **Breaking change?** (signature incompatible with old calls)
- **How many call sites?** (<5: check all, 5-20: sample 5-10, >20: sample 10 + rely on tests)
- **Critical paths affected?** (auth, payments, data integrity)

### Step 4: Verify
- [ ] Sample call sites checked
- [ ] Backward compatibility confirmed OR migration complete
- [ ] Tests cover changed behavior

---

## Tool Delegation

**Let tools handle these** (don't manually check):

### ✅ If linter configured (eslint, pylint, clippy):
- Formatting, indentation
- Import order
- Unused variables
- Basic style violations

### ✅ If type checker enabled (tsc, mypy, flow):
- Type mismatches
- Missing properties
- Incorrect function signatures (will error at call sites)

### ✅ If tests passing:
- Basic correctness
- Regression prevention
- Edge cases (if well-tested)

### ✅ If CI green:
- Build succeeds
- Dependencies resolve
- Syntax correct

**Trust these tools.** Focus human review on what they can't catch: logic, security, architecture, design decisions.

---

## Language-Specific Quick Checks

### JavaScript/TypeScript
- [ ] Use `const` over `let`, avoid `var`
- [ ] Promises awaited or .catch() used
- [ ] `===` not `==`
- [ ] TypeScript: No `any` without justification

### Python
- [ ] No bare `except:` (use specific exceptions)
- [ ] Context managers (`with`) for resources
- [ ] No mutable default arguments

### Go
- [ ] Errors checked (not ignored)
- [ ] `defer` for cleanup
- [ ] Goroutines have context for cancellation

### Java
- [ ] Try-with-resources for AutoCloseable
- [ ] `Optional` instead of null (when possible)
- [ ] Specific exception catches

### Rust
- [ ] `Result` and `Option` handled (no `.unwrap()` in production)
- [ ] Ownership correct
- [ ] Unsafe blocks justified

---

## Review Efficiency Tips

1. **Use grep/search aggressively**: Find all call sites quickly
2. **Sample, don't exhaust**: For >10 call sites, verify 5-10 diverse samples
3. **Trust CI**: Green CI = basic correctness likely okay
4. **Focus blast radius**: Changed shared code? Deep dive. New isolated feature? Light review.
5. **Short-circuit**: Found critical issue? Report immediately, don't waste time on minor issues.
