# Example: GitHub PR Review

This example shows a complete code review workflow for a medium-sized PR.

## Scenario

User request: "Review this PR: https://github.com/myorg/api-server/pull/456"

PR summary:
- Add user profile editing endpoint
- 12 files changed (+420 -85 lines)
- Medium size review

## Stage 1: Initialize Review

**Agent actions**:

```bash
# Fetch PR to local branch
gh pr view 456 --json title,body,headRefName
git fetch origin pull/456/head:pr-456
git checkout pr-456

# Get metrics
git diff --stat main..pr-456
git log --oneline main..pr-456
```

**Metrics captured**:
- 12 files changed (+420 -85)
- 3 commits
- Files: API routes (3), validators (2), DB models (1), tests (5), docs (1)

**Exit**: ✅ Have code and metrics

## Stage 2: Reviewability Assessment

**Check mixed concerns**:
- ❌ No formatting-only changes
- ❌ No refactoring mixed with features
- ✅ Focused on single feature (profile editing)
- ❌ No infrastructure changes

**Size assessment**:
- 420 lines added → **Medium size**
- Assessment: "Manageable with focused attention"

**Exit**: ✅ Changes are reviewable

## Stage 3: Project Context Understanding

**Identify project type**:
```bash
ls package.json  # Found - Node.js project
grep "express" package.json  # Express.js API
ls .eslintrc.json  # Has linter
ls jest.config.js  # Has tests
```

**Detect review strategy**:
- Standard Node.js/Express API
- Has CI, tests, linter
- No security/compliance indicators
- **Strategy**: Balanced

**Load conventions**:
- REST API style: /api/v1/...
- Error handling: Uses custom ApiError class
- Validation: Joi schemas
- Tests: Jest with supertest

**Exit**: ✅ Know project conventions and strategy

## Stage 3.5: Review Depth Strategy

**Size**: Medium (420 lines)

**Depth selected**: Medium
- Focus on: Architecture, API contracts, data flow, security
- Ignore: Style/formatting (trust eslint)
- Verify: Signature changes → check call sites
- Trust: CI for syntax, types, basic errors

**CI status check**:
```bash
gh pr checks 456
# All checks passing: ✅ lint, ✅ test, ✅ build
```

**Exit**: ✅ Will apply medium-depth review

## Stage 4: Risk Analysis

**Scan for high-risk changes**:

**Security-sensitive**:
- ✅ `routes/profile.ts` - Auth middleware applied
- ⚠️ `validators/profile.ts` - Input validation (needs review)

**Data integrity**:
- ⚠️ `models/user.ts` - User model modified (check migration)
- ❌ No migration file found → FLAG THIS

**Public API**:
- ✅ `routes/profile.ts` - New endpoint (not breaking existing)

**Priority for review**:
1. 🔴 HIGH: Missing migration for model change
2. 🟡 MEDIUM: Input validation correctness
3. 🟡 MEDIUM: Auth/authorization on new endpoint
4. 🔵 LOW: Test coverage
5. 🔵 LOW: Documentation

**Exit**: ✅ Risks identified, prioritized

## Stage 5: Detailed Review

**TodoWrite** created:
- [ ] Review missing migration (HIGH)
- [ ] Review input validation (MEDIUM)
- [ ] Review authorization logic (MEDIUM)
- [ ] Check test coverage (LOW)

### Finding #1: Missing Database Migration

**File**: `models/user.ts:12-15`

**Code changed**:
```typescript
export interface User {
  id: string;
  email: string;
  name: string;
+ bio: string;        // NEW FIELD
+ avatarUrl: string;  // NEW FIELD
}
```

**Issue**: Model adds `bio` and `avatarUrl` fields, but no database migration file in PR.

**Impact**:
- Application will crash when trying to save these fields (if DB schema doesn't match)
- Existing users won't have these fields (null handling needed)

**Severity**: 🔴 HIGH

**Suggestion**:
1. Add migration: `migrations/003_add_user_profile_fields.sql`
2. Make fields nullable or provide defaults
3. Handle null in code gracefully

---

### Finding #2: Weak Input Validation on Bio

**File**: `validators/profile.ts:8-11`

**Code**:
```typescript
const profileSchema = Joi.object({
  bio: Joi.string().max(500),
  avatarUrl: Joi.string().uri()
});
```

**Issue**: Bio field not validated for malicious content (script tags, etc.)

**Impact**: Potential XSS if bio is displayed without escaping in frontend.

**Severity**: 🟡 MEDIUM

**Suggestion**:
```typescript
bio: Joi.string().max(500).pattern(/^[^<>]*$/)  // Disallow HTML tags
```

Or ensure frontend escapes output properly.

---

### Finding #3: Missing Authorization Check

**File**: `routes/profile.ts:23-28`

**Code**:
```typescript
router.put('/api/v1/users/:userId/profile', authenticate, async (req, res) => {
  const { userId } = req.params;
  const profile = req.body;

  await updateUserProfile(userId, profile);
  res.json({ success: true });
});
```

**Issue**: User can edit ANY user's profile by changing `userId` in URL. No check that `req.user.id === userId`.

**Impact**: Authorization bypass - users can modify others' profiles.

**Severity**: 🔴 CRITICAL

**Suggestion**:
```typescript
router.put('/api/v1/users/:userId/profile', authenticate, async (req, res) => {
  const { userId } = req.params;

  // Add authorization check
  if (req.user.id !== userId && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const profile = req.body;
  await updateUserProfile(userId, profile);
  res.json({ success: true });
});
```

---

### Positive Observations

✅ **Good test coverage**: 5 test files covering happy path and error cases
✅ **Proper async/await**: No unhandled promise rejections
✅ **Error handling**: Uses ApiError consistently
✅ **Documentation**: API endpoint documented in OpenAPI spec

**Exit**: ✅ Review complete, findings logged

## Stage 6: Summary and Report

**Report generated**:

```markdown
# Code Review Summary

## Overview
- **Review scope**: PR #456 - Add user profile editing endpoint
- **Files changed**: 12 files (+420 -85 lines)
- **Review strategy**: Balanced (medium-depth)
- **CI status**: ✅ All checks passing
- **Overall assessment**: **Request Changes** (1 critical, 1 high issue)

## Critical Issues (🔴)

### Authorization Bypass on Profile Editing
**File**: routes/profile.ts:23-28
**Impact**: Users can edit other users' profiles
**Required**: Add `req.user.id === userId` check before update
**Priority**: Must fix before merge

## Important Issues (🟡)

### Missing Database Migration
**File**: models/user.ts (new fields: bio, avatarUrl)
**Impact**: Application will crash if DB schema not updated
**Required**: Add migration file for new fields
**Priority**: Must fix before merge

### Weak Input Validation on Bio Field
**File**: validators/profile.ts:8-11
**Impact**: Potential XSS vulnerability
**Suggestion**: Add HTML tag filtering or ensure frontend escaping
**Priority**: Should fix before merge

## Positive Observations

✅ Excellent test coverage (5 test files, happy + error paths)
✅ Proper authentication middleware applied
✅ Consistent error handling pattern
✅ API documentation updated
✅ Clean async/await usage

## Recommendations

### Must Address (blocking merge):
1. Add authorization check (critical security issue)
2. Create and include database migration file

### Should Address:
3. Strengthen input validation for bio field

### Nice to Have:
4. Consider adding rate limiting on profile update endpoint

## Review Metrics
- **Review depth**: Medium (focused on security, data flow, API design)
- **Skipped**: Style/formatting (delegated to eslint)
- **Verified**: Authorization, validation, data model changes
- **Test strategy**: Relied on passing CI for basic correctness
```

**Agent asks**: "Would you like me to create GitHub review comments for these findings?"

## Key Takeaways

**What made this review effective**:
1. ✅ **Appropriate depth**: Medium-depth for medium-sized PR
2. ✅ **Focused effort**: Didn't waste time on lint-able issues
3. ✅ **Impact analysis**: Caught missing migration by checking model changes
4. ✅ **Security focus**: Found critical auth bypass
5. ✅ **Trusted CI**: Didn't re-check what tests already verify
6. ✅ **Actionable**: Clear severity, impact, and fix suggestions

**Time saved**:
- Didn't review: Formatting, import order, naming (eslint's job)
- Didn't re-run: Tests, type checks (CI already passed)
- Focused on: What only human can catch (logic, security, architecture)

**Result**: High-value review in reasonable time.
