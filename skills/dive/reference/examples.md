# Examples

Practical examples of using project-expert workflow.

## Example 1: Business Logic Question

**Question**: "How does user authentication work?"

**Process**:
1. Search docs: `grep -r "authentication" docs/`
2. Find API docs: `docs/api/auth.md`
3. Locate implementation: `grep -r "class.*Auth" src/ --include="*.ts"`
4. Read auth handler and tests

**Answer**:
```
Authentication uses JWT tokens with refresh token rotation.

Evidence:
1. docs/api/auth.md:15-20: Documents POST /auth/login endpoint
2. src/auth/handler.ts:45: Generates JWT with 15min expiry
3. src/auth/handler.ts:67: Issues refresh token valid for 7 days
4. tests/auth.test.ts:120: Validates token rotation on refresh

Summary: System issues short-lived access tokens (15min) with
longer refresh tokens (7 days) to balance security and UX.
```

## Example 2: Technical Question

**Question**: "What database do we use for caching?"

**Process**:
1. Check README and docs
2. Search config: `grep -r "cache" config/`
3. Look at dependencies: `grep redis package.json`
4. Find usage: `grep "createClient" src/`

**Answer**:
```
Redis is used for caching.

Evidence:
1. README.md:34: Lists Redis as infrastructure requirement
2. config/cache.ts:12: Connects to Redis via ioredis client
3. package.json:18: Dependency on ioredis@5.3.0
4. src/services/cache.ts:8-15: Implements cache service wrapper

Summary: Redis cache with ioredis client library.
```

## Example 3: Uncertain Answer

**Question**: "What's the rate limit for API endpoints?"

**Process**:
1. Search docs: No mention of rate limiting
2. Check middleware: Found rate limiter but no config
3. Check env vars: Not documented

**Answer**:
```
I found rate limiting middleware but cannot determine the exact limits.

Evidence:
1. src/middleware/rateLimit.ts:10: Uses express-rate-limit middleware
2. src/middleware/rateLimit.ts:15: Limit set from env var RATE_LIMIT_MAX
3. No documentation found for RATE_LIMIT_MAX default value

The rate limit is configurable but I cannot confirm the default without:
- Checking deployed environment configuration
- Finding infrastructure/deployment docs
- Reviewing environment variable documentation

Would you like me to search deployment configurations or
infrastructure files?
```

## Example 4: Architecture Question

**Question**: "How do the frontend and backend communicate?"

**Process**:
1. Check ARCHITECTURE.md
2. Search for API client: `grep -r "axios\|fetch" src/frontend/`
3. Check API routes: `grep -r "router\|route" src/backend/`
4. Look for API specs: Check openapi.yaml

**Answer**:
```
Frontend communicates via REST API with JSON payloads.

Evidence:
1. ARCHITECTURE.md:45-50: Documents REST API architecture
2. src/frontend/api/client.ts:12: Uses axios for HTTP requests
3. src/backend/routes/api.ts:8-25: Defines REST endpoints
4. openapi.yaml: Full API specification with request/response schemas

Communication flow:
- Frontend: React app makes HTTP requests via axios client
- Backend: Express server handles requests through route handlers
- Format: JSON for both requests and responses
- Authentication: JWT tokens in Authorization header

Confirmed by architecture docs, implementation, and API specification.
```

## Example 5: Debugging Question

**Question**: "Why might users see 'Payment failed' errors?"

**Process**:
1. Search for error message: `grep -r "Payment failed" src/`
2. Find error types: `grep -r "PaymentError" src/`
3. Check error handling: Read payment processor code
4. Review tests: `grep -r "payment.*error" tests/`

**Answer**:
```
"Payment failed" errors can occur from multiple causes:

1. **Insufficient Funds**
   - src/payment/processor.ts:145: Throws InsufficientFundsError
   - Mapped to "Payment failed" in src/payment/errors.ts:34

2. **Gateway Timeout**
   - src/payment/processor.ts:167: Gateway timeout after 3 retries
   - Mapped to generic "Payment failed" message

3. **Invalid Payment Method**
   - src/payment/validator.ts:89: Validates card/payment details
   - Throws ValidationError → "Payment failed"

Evidence:
- src/payment/errors.ts:20-45: Error type hierarchy
- src/payment/processor.ts:140-180: Payment processing logic
- tests/payment.test.ts:234-267: Error scenario tests
- docs/api/errors.md:89: Documents error responses

To debug specific instance, check logs for underlying error type.
```

## Example 6: Configuration Question

**Question**: "How do I increase the API timeout?"

**Process**:
1. Check config docs: `grep -r "timeout" docs/`
2. Search .env.example: `grep TIMEOUT .env.example`
3. Find usage: `grep -r "timeout" config/`
4. Check default values

**Answer**:
```
API timeout is configured via API_TIMEOUT_MS environment variable.

Evidence:
1. .env.example:23: API_TIMEOUT_MS=30000 (default 30 seconds)
2. config/api.ts:45: Reads process.env.API_TIMEOUT_MS
3. src/api/client.ts:12: Applied to axios timeout configuration
4. docs/configuration.md:67: Documents timeout setting

To increase timeout:
1. Set API_TIMEOUT_MS in .env file (value in milliseconds)
2. Restart application to apply changes
3. Recommended maximum: 60000ms (60 seconds)

Default is 30 seconds, can be increased up to 60 seconds per docs.
```
