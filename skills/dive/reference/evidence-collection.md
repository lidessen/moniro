# Evidence Collection Reference

Guide for collecting and citing evidence in project-expert answers.

## Citation Format

Standard format for all evidence citations:

```
[file-path]:[line-number] - [brief description]
```

**Examples**:
```
src/auth/handler.ts:45 - JWT generation logic
docs/api/endpoints.md:120-135 - POST /auth/login documentation
tests/user.test.ts:89 - User creation test case
config/database.ts:12 - Database connection config
```

### Code Snippet Citation

```markdown
**Source**: [file:line]
```language
[code snippet]
```
**Shows**: [what this proves]
```

**Example**:
```markdown
**Source**: src/auth/jwt.ts:34-38
```typescript
export function generateToken(userId: string): string {
  return jwt.sign({ userId }, SECRET_KEY, {
    expiresIn: '15m'
  });
}
```
**Shows**: Tokens expire after 15 minutes
```

## Collection Templates

### Basic Answer Template

```markdown
**Answer**: [Direct answer]

**Evidence**:
1. [file:line] - [finding]
2. [file:line] - [finding]
3. [file:line] - [finding]

**Summary**: [synthesis]
```

### With Uncertainty

```markdown
**Partial Answer**: [what's confirmed]

**Evidence**:
- [file:line] - [partial information]

**Gaps**: Cannot confirm [X] without [Y]

**Next**: Would you like me to [alternatives]?
```

## Multi-Source Verification

### Triangle Verification

Strongest evidence comes from three independent sources:

```markdown
**Documentation**: [file:line] - States X
**Implementation**: [file:line] - Implements X
**Tests**: [file:line] - Verifies X

All three sources confirm [finding]
```

### Cross-Layer Tracing

Trace through implementation layers:

```markdown
**Entry Point**: [file:line] - Route definition
**Handler**: [file:line] - Controller logic
**Service**: [file:line] - Business logic
**Data**: [file:line] - Model/schema
**Storage**: [file:line] - Database operation

Complete flow traced from API to database
```

### Handling Conflicts

When sources disagree:

```markdown
**Conflict**:
- Source A: [file:line] - Shows X
- Source B: [file:line] - Shows Y

**Resolution**:
- Check timestamps (which is newer)
- Check environment (dev vs prod)
- Check git history (what changed, why)

**Conclusion**: [resolved finding with explanation]
```

## Answer Formats

### Feature Explanation

```markdown
[Feature] works by [mechanism].

Evidence:
1. [docs file:line] - [documentation]
2. [impl file:line] - [implementation]
3. [test file:line] - [verification]

Confirmed by documentation, implementation, and tests.
```

### Technical Detail

```markdown
[Question] → [Answer]

Configuration: [file:line] - [value]
Implementation: [file:line] - [how implemented]
Usage: [file:line] - [real usage]
```

### Multi-Aspect

For complex questions:

```markdown
**[Aspect 1]**: [answer]
- Evidence: [file:line]

**[Aspect 2]**: [answer]
- Evidence: [file:line]

**[Aspect 3]**: [answer]
- Evidence: [file:line]

Integration: [how aspects work together]
```

## Evidence Organization

**By strength** (recommended):
```markdown
**Primary Evidence**:
- [strongest sources]

**Supporting Evidence**:
- [supporting sources]
```

**By topic**:
```markdown
**Authentication**:
- [evidence 1]
- [evidence 2]

**Authorization**:
- [evidence 3]
- [evidence 4]
```

## Quality Checklist

Before presenting evidence:

**Collection**:
- [ ] Searched docs, code, config, tests
- [ ] Found multiple sources where possible
- [ ] Resolved contradictions
- [ ] Noted gaps explicitly

**Citation**:
- [ ] All sources cited with file:line
- [ ] Code snippets included where relevant
- [ ] Context provided for each source

**Presentation**:
- [ ] Direct answer stated first
- [ ] Evidence organized logically
- [ ] Certainty level clear
- [ ] Synthesis provided
- [ ] Uncertainty acknowledged
- [ ] Next steps offered if incomplete

## Common Patterns

### Example 1: Complete Evidence

```markdown
**Question**: How are errors handled in payment processing?

**Answer**: Payment errors use a three-tier error hierarchy with retry logic.

**Evidence**:
1. src/payment/errors.ts:5-25 - Defines error types:
   - InsufficientFundsError
   - PaymentGatewayError
   - InvalidPaymentMethodError

2. src/payment/processor.ts:89-110 - Implements error handling:
   - Try-catch wraps gateway calls
   - Retries on timeout (3 attempts)
   - Logs to monitoring service

3. docs/api/errors.md:67 - Documents error responses:
   - 402 for InsufficientFunds
   - 502 for gateway errors

4. tests/payment.test.ts:234 - Verifies retry logic on timeout

Confirmed by implementation, documentation, and tests.
```

### Example 2: Partial Evidence with Gaps

```markdown
**Question**: What's the maximum file upload size?

**Partial Answer**: Application uses multer with configurable size limit.

**Evidence**:
- src/middleware/upload.ts:15 - References MAX_UPLOAD_SIZE constant

**Gaps**: Cannot determine actual limit value.

Searched but not found:
- Configuration files
- Environment variable docs
- Deployment configs

**Next**: Would you like me to check deployed environment variables or infrastructure configuration?
```

### Example 3: Cross-Referenced Evidence

```markdown
**Question**: How does user authentication work?

**Answer**: JWT-based authentication with 15-minute tokens and 7-day refresh tokens.

**Evidence**:

**Token Generation**:
- docs/api/auth.md:15-20 - Documents POST /auth/login
- src/auth/handler.ts:45 - Generates JWT (15min expiry)
- src/auth/handler.ts:67 - Issues refresh token (7 days)

**Verification**:
- src/auth/middleware.ts:23 - Validates JWT on requests
- tests/auth.test.ts:89 - Confirms 15min expiry
- tests/auth.test.ts:120 - Validates refresh flow

**Token Rotation**:
- src/auth/handler.ts:78 - Rotates refresh token on use
- tests/auth.test.ts:145 - Tests rotation logic

Complete authentication flow verified across docs, implementation, and tests.
```
