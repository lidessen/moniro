# Example: Local Branch Review

This example shows reviewing a local branch with impact analysis for shared utility changes.

## Scenario

User request: "Review my current branch against main"

Context:
- Current branch: `feature/improve-logging`
- Target: `main`
- Changes: Refactored logging utility, updated call sites
- Size: Medium (580 lines, 18 files)

## Stage 1: Initialize

```bash
# Get current branch
git branch --show-current
# Output: feature/improve-logging

# Get metrics
git diff --stat main..HEAD
# 18 files changed, 380 insertions(+), 200 deletions(-)

git log --oneline main..HEAD
# 3 commits

# File distribution
git diff --numstat main..HEAD
# Mostly in: src/utils/logger.ts, src/**/*.ts (many files)
```

**Metrics**:
- 18 files, +380 -200 lines → Medium size
- Modified shared utility (logger.ts) → HIGH IMPACT potential
- Many files touched → Suggests widespread usage

**Exit**: ✅ Have metrics, identified high-impact change

## Stage 2: Reviewability

**Mixed concerns check**:
```bash
git diff --stat main..HEAD
```

**Analysis**:
- All changes related to logging refactor
- No mixed features
- Focused scope ✅

**Size**: Medium (580 lines) → "Manageable with focused attention"

**Exit**: ✅ Reviewable

## Stage 3: Context Understanding

**Project type**:
```bash
ls package.json  # TypeScript project
grep typescript package.json  # Using TypeScript
ls tsconfig.json  # Strict type checking enabled
```

**Strategy**: Balanced (standard TS project)

**Conventions**:
- Logging: Currently custom logger in `utils/logger.ts`
- Error handling: Throw typed errors
- Tests: Jest

**Exit**: ✅ Know conventions

## Stage 3.5: Review Depth

**Size**: Medium (580 lines)

**Depth**: Medium
- Focus: Architecture, API contracts, impact analysis
- **Critical**: Shared utility changed → MUST do impact analysis
- Skip: Formatting (has prettier config)

**CI check**:
```bash
npm run lint  # ✅ Pass
npm run type-check  # ✅ Pass
npm test  # ✅ Pass
```

**Exit**: ✅ Medium-depth, focus on impact

## Stage 4: Risk Analysis

**High-risk identified**:

1. 🔴 **Shared utility modification**: `utils/logger.ts`
   - Used across codebase
   - Signature might have changed
   - **REQUIRES IMPACT ANALYSIS**

2. 🟡 **Multiple file updates**: 15 files import logger
   - Need to verify all updated correctly

**Exit**: ✅ Risk: Shared utility change

## Stage 5: Detailed Review

### Step 1: Identify Signature Changes

```bash
git diff main..HEAD -- src/utils/logger.ts | grep -E "^[-+].*export.*function"
```

**Output**:
```diff
- export function log(level: string, message: string): void
+ export function log(options: LogOptions): void

- export function error(message: string): void
+ export function error(message: string, context?: ErrorContext): void

- export function info(message: string): void
+ export function info(message: string, metadata?: Record<string, any>): void
```

**Signature changes identified**:
1. `log()`: Breaking change (parameters completely different)
2. `error()`: Backward compatible (new param is optional)
3. `info()`: Backward compatible (new param is optional)

### Step 2: Impact Analysis for log()

**Find all usages**:
```bash
grep -r "logger.log(" --include="*.ts" src/
# Returns: 23 call sites
```

**Sample 5 call sites** to verify update pattern:

**Call site 1** (`src/api/auth.ts:45`):
```typescript
- logger.log('info', 'User logged in');
+ logger.log({ level: 'info', message: 'User logged in' });
```
✅ Updated correctly

**Call site 2** (`src/services/payment.ts:67`):
```typescript
- logger.log('error', `Payment failed: ${error.message}`);
+ logger.log({ level: 'error', message: 'Payment failed', context: { error } });
```
✅ Updated correctly with context

**Call site 3** (`src/jobs/cleanup.ts:12`):
```typescript
- logger.log('debug', 'Starting cleanup');
// Not updated! Still old signature
```
❌ **FINDING #1**: Missed update

**Agent thought**: Found issue in sample. Check if others also missed.

```bash
# Search for old pattern usage
grep -r 'logger\.log(' --include="*.ts" src/ | grep -v '{ level'
# Returns: 3 files still using old signature!
```

**FINDING #1: Incomplete migration of logger.log() calls**

**Files with old signature**:
- src/jobs/cleanup.ts:12
- src/jobs/notification.ts:34
- src/scripts/migrate.ts:8

**Impact**: TypeScript errors at runtime (CI should have caught this, but might be unchecked files)

**Severity**: 🔴 HIGH

**Suggestion**: Update remaining 3 files to new signature.

---

### Step 3: Verify Backward-Compatible Changes

**error() and info()**: New optional parameters, old calls should work.

**Spot-check 2 call sites each**:

```bash
grep -r "logger.error(" --include="*.ts" src/ | head -3
grep -r "logger.info(" --include="*.ts" src/ | head -3
```

**Sample checks**:
- Old usage: `logger.error('Failed')` → ✅ Still works (optional param)
- New usage: `logger.error('Failed', { userId: 123 })` → ✅ Uses new feature

✅ Backward compatible changes working correctly.

---

### Step 4: Architecture Review

**Read new logger implementation**:

```typescript
// src/utils/logger.ts (new)
export interface LogOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, any>;
  context?: ErrorContext;
}

export function log(options: LogOptions): void {
  const { level, message, metadata, context } = options;

  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
    context,
  };

  // Send to logging service
  loggingService.send(logEntry);
}
```

**FINDING #2: Missing log level validation**

**Issue**: No validation that `level` is one of allowed values.

**Impact**: Typos like `logger.log({ level: 'infoo', ... })` will pass TypeScript but create bad log entries.

**Severity**: 🟡 MEDIUM

**Suggestion**:
```typescript
const VALID_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export function log(options: LogOptions): void {
  if (!VALID_LEVELS.includes(options.level)) {
    throw new Error(`Invalid log level: ${options.level}`);
  }
  // ... rest
}
```

---

**FINDING #3: No tests for new logger functionality**

```bash
ls src/utils/__tests__/logger.test.ts
# File exists, check if updated
```

**Tests found**:
- ✅ Tests for old `log()` signature
- ❌ No tests for new `LogOptions` interface
- ❌ No tests for metadata handling
- ❌ No tests for error context

**Severity**: 🟡 MEDIUM

**Suggestion**: Add tests for new functionality.

**Exit**: ✅ Review complete

## Stage 6: Summary

```markdown
# Code Review Summary

## Overview
- **Review scope**: feature/improve-logging branch vs main
- **Files changed**: 18 files (+380 -200 lines)
- **Review strategy**: Balanced (medium-depth)
- **Key change**: Refactored shared logging utility
- **Overall assessment**: **Request Changes** (1 high, 2 medium issues)

## Critical Issues (🔴)

### Incomplete Migration of logger.log() Calls
**Impact**: 3 files still using old logger signature
**Files**:
- src/jobs/cleanup.ts:12
- src/jobs/notification.ts:34
- src/scripts/migrate.ts:8

**Fix**: Update to new signature:
```typescript
logger.log({ level: 'info', message: 'your message' })
```
**Priority**: Must fix (will cause runtime errors)

## Important Issues (🟡)

### Missing Log Level Validation
**File**: src/utils/logger.ts
**Impact**: Invalid log levels accepted silently
**Suggestion**: Add runtime validation for log levels
**Priority**: Should fix

### Insufficient Test Coverage for New Features
**File**: src/utils/__tests__/logger.test.ts
**Impact**: New metadata and context features not tested
**Suggestion**: Add tests for LogOptions interface and new parameters
**Priority**: Should fix

## Positive Observations

✅ Improved API design (object parameter is more extensible)
✅ Backward compatible changes for error() and info()
✅ Consistent update pattern across most files
✅ Clean TypeScript types
✅ All CI checks passing

## Impact Analysis Summary

**logger.log() signature change**:
- **Total usage**: 23 call sites found
- **Updated**: 20 sites ✅
- **Missed**: 3 sites ❌ (critical finding)
- **Verification method**: Sampled 5 sites, then searched for old pattern

**Shared utility risk assessment**:
- High-impact change (23 call sites)
- Mostly updated correctly
- Type system helped catch most issues
- Manual review caught edge cases (scripts/ not always type-checked)

## Recommendations

1. **Must fix**: Update remaining 3 call sites to new logger signature
2. **Should fix**: Add log level validation for robustness
3. **Should fix**: Add tests for new logger features
4. **Consider**: Run type-check on scripts/ directory to catch future issues

## Review Efficiency Notes

**What worked well**:
- Impact analysis caught incomplete migration
- Sampling strategy (5 call sites) efficient for 23 total usages
- Focused on high-risk (shared utility) first
- Trusted CI for basic type checking

**Time saved**:
- Didn't review formatting (prettier handles it)
- Didn't manually check all 23 call sites (sampled + searched for pattern)
- Relied on TypeScript for most compatibility checks
