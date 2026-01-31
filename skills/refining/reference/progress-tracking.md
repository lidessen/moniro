# Progress Tracking for Large Reviews

For X-Large changes (>2000 lines or >50 files), use `.code-review-progress.md` to enable resumable reviews.

## When to Create

- **X-Large changes**: >2000 lines or >50 files
- **Multi-session reviews**: Expected to take multiple review sessions
- **User requests**: When user says "save progress" or "pause"

## Document Template

```markdown
# Code Review Progress

**Review ID**: `<branch>` or `PR #123`
**Size**: X files (+Y -Z lines) - X-Large
**Started**: 2024-01-15 10:30
**Last updated**: 2024-01-15 14:45
**Status**: In Progress
**Strategy**: Balanced
**Depth**: X-Large (critical paths only)

## Progress: 15/47 files (32%)

### ✅ Reviewed (15 files)
- [x] src/auth/login.ts - 🔴 1 critical (SQL injection)
- [x] src/auth/session.ts - ✅ Clean
- [x] src/api/users.ts - 🟡 2 high (missing auth checks)
- [x] src/db/schema.sql - 🔴 1 critical (no rollback)
- ... (11 more)

### 🔥 High Priority Pending (8 files)
- [ ] src/payment/processor.ts - **CRITICAL PATH**
- [ ] src/db/migration-002.sql - **DATA INTEGRITY**
- [ ] src/auth/permissions.ts - **SECURITY**
- ... (5 more)

### ⏸️ Medium Priority (18 files)
- [ ] src/api/orders.ts
- [ ] src/services/email.ts
- ... (16 more)

### ⏭️ Skipped (6 files - auto-generated/low-risk)
- package-lock.json
- dist/bundle.js
- ... (4 more)

## Findings: 2 Critical, 5 High, 8 Medium

### 🔴 Critical #1: SQL Injection in login
**File**: src/auth/login.ts:45
**Impact**: Database compromise possible
**Fix**: Use parameterized query
[Details saved in finding #1 below]

### 🔴 Critical #2: Missing migration rollback
**File**: src/db/schema.sql
**Impact**: Cannot rollback deployment if failed
**Fix**: Add DOWN migration
[Details saved in finding #2 below]

### 🟡 High Issues
- src/api/users.ts:67 - Missing authorization check on DELETE
- src/api/users.ts:89 - No rate limiting on password reset
... (3 more)

## Next Session Focus
1. Complete payment processor review (critical path)
2. Review remaining security-sensitive files
3. Check database migrations
4. Verify API contract changes

## Context Notes
- Payment integration change: Stripe → Adyen
- Database schema adds `transactions` table
- Breaking change: User API now requires auth header
- CI is green (tests, lint, types all pass)

---

## Detailed Findings

### Finding #1: SQL Injection in login
[Full detailed finding with code, impact, suggestion]

### Finding #2: Missing migration rollback
[Full detailed finding]

...
```

## Usage by Agent

### Creating

```typescript
// At start of Stage 5 for X-Large changes
1. Categorize files by priority (from risk analysis)
2. Create progress doc with template
3. Mark current file as first pending high-priority
```

### Updating

Update after every 5-10 files or before pausing:

```typescript
1. Move reviewed files from pending to reviewed
2. Add findings to summary
3. Update progress percentage
4. Update "last updated" timestamp
5. Update "Next session focus"
```

### Resuming

```typescript
// When user says "continue review" or progress file exists
1. Read progress file
2. Extract: reviewed files, pending high-priority, findings so far
3. Continue from first pending high-priority file
4. Preserve all existing findings
```

## Benefits

- **Resumable**: Exact checkpoint restoration
- **Transparent**: User sees progress anytime
- **Accountable**: No findings lost
- **Efficient**: No duplicate review work

## Location

Save in project root: `.code-review-progress.md`

Or in `.agents/` if project uses that convention.
