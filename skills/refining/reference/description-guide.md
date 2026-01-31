# PR/MR Description Guide

How to write descriptions that help reviewers understand changes quickly.

## Principles

1. **Reviewer time is precious** - Front-load the important information
2. **Context over code** - Explain the why, not just the what
3. **Visual when complex** - ASCII diagrams for architecture changes
4. **Guide attention** - Tell reviewers where to focus

---

## Title

### Format

```
<type>: <imperative description>
```

| Type | Use When |
|------|----------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `chore` | Build, CI, dependencies |

### Examples

```
feat: add user authentication with JWT
fix: prevent race condition in order processing
refactor: extract payment logic into service layer
perf: cache database queries for product listing
```

### Rules

- Imperative mood ("add" not "added" or "adding")
- <70 characters
- No period at end
- Lowercase after colon

---

## Description Structure

### Minimal (small changes)

```markdown
## Summary
Fix null pointer exception when user has no profile picture.

## Testing
- Verified with user without profile
- Existing tests pass
```

### Standard (most changes)

```markdown
## Summary
Add rate limiting to API endpoints to prevent abuse.

Rate limits are configurable per-endpoint and use Redis for distributed counting.

## Changes
- Add rate limiter middleware
- Configure limits in `config/rate-limits.yml`
- Add Redis client for distributed counting
- Return 429 with Retry-After header when exceeded

## Testing
- Unit tests for rate limiter logic
- Integration test with Redis
- Manual test: `curl` 100 requests, verify 429 on 101st

## Reviewer Notes
- Focus on the sliding window algorithm in `rateLimiter.ts:45-80`
- Redis connection handling follows existing patterns in `cache.ts`
```

### Complex (architecture changes)

```markdown
## Summary
Introduce event-driven architecture for order processing.

Replaces synchronous order flow with async events to improve reliability
and enable future scaling.

## Changes
- Add event bus abstraction (`src/events/`)
- Convert OrderService to emit events
- Add event handlers for inventory, payment, notification
- Add dead letter queue for failed events

## Architecture

### Before
```
OrderController ──▶ OrderService ──▶ InventoryService
                         │                  │
                         ▼                  ▼
                  PaymentService    NotificationService
```

### After
```
OrderController ──▶ OrderService ──▶ EventBus
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
             InventoryHandler    PaymentHandler    NotificationHandler
                    │                   │                   │
                    ▼                   ▼                   ▼
             InventoryService    PaymentService    NotificationService
```

## Testing
- Unit tests for each handler
- Integration test for full order flow
- Chaos test: kill handlers mid-process, verify recovery

## Reviewer Notes
- **Critical**: Event ordering in `eventBus.ts:120-150`
- **Risk**: Retry logic - verify idempotency in handlers
- Open question: Should we add circuit breaker? (not in this PR)
```

---

## ASCII Diagram Patterns

### Component Interaction

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Client  │───▶│   API    │───▶│    DB    │
└──────────┘    └────┬─────┘    └──────────┘
                     │
                     ▼ (new)
              ┌──────────┐
              │  Cache   │
              └──────────┘
```

### Request Flow

```
Request ──▶ Auth ──▶ Validate ──▶ Process ──▶ Response
              │          │            │
              ▼          ▼            ▼
           401 err    400 err     500 err
```

### State Machine

```
┌─────────┐
│ pending │
└────┬────┘
     │ submit
     ▼
┌─────────────┐     request
│  reviewing  │◀────changes────┐
└──────┬──────┘                │
       │ approve               │
       ▼                       │
┌─────────────┐                │
│  approved   │────────────────┘
└─────────────┘
```

### Data Flow

```
User Input ──▶ Validator ──▶ Transformer ──▶ Repository
    │              │              │              │
    │              ▼              ▼              ▼
    │          ValidationDTO   DomainModel    Entity
    │              │              │              │
    └──────────────┴──────────────┴──────────────┘
                        │
                        ▼
                   Error Response
```

### Layer Diagram

```
┌─────────────────────────────────────┐
│            Presentation             │
│  (Controllers, Views, API Routes)   │
├─────────────────────────────────────┤
│            Application              │
│    (Services, Use Cases, DTOs)      │
├─────────────────────────────────────┤
│              Domain                 │
│   (Entities, Value Objects, Repos)  │
├─────────────────────────────────────┤
│           Infrastructure            │
│  (Database, External APIs, Cache)   │
└─────────────────────────────────────┘
```

### Sequence (simple)

```
Client          Server          Database
   │               │                │
   │──── POST ────▶│                │
   │               │──── INSERT ───▶│
   │               │◀─── OK ────────│
   │◀─── 201 ──────│                │
```

---

## Reviewer Notes Section

### What to Include

| Include | Example |
|---------|---------|
| **Focus areas** | "Critical: auth logic in `auth.ts:45-80`" |
| **Risks** | "Risk: race condition possible if X" |
| **Trade-offs** | "Chose X over Y because..." |
| **Open questions** | "Should we also add Z? Not in this PR" |
| **Dependencies** | "Requires config change in production" |
| **Not included** | "Logging improvements deferred to follow-up" |

### What NOT to Include

- Obvious observations ("I added tests")
- Self-deprecation ("Sorry this is messy")
- Unrelated future work

---

## Platform-Specific

### GitHub

```bash
gh pr create \
  --title "feat: add rate limiting" \
  --body "$(cat <<'EOF'
## Summary
...

## Changes
...
EOF
)"
```

### GitLab

```bash
glab mr create \
  --title "feat: add rate limiting" \
  --description "$(cat <<'EOF'
## Summary
...

## Changes
...
EOF
)"
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Better |
|--------------|---------|--------|
| "Various fixes" | No information | List specific fixes |
| Wall of text | Hard to scan | Use headers, bullets |
| Code dump | Reviewer should read code | Explain intent |
| No testing info | How to verify? | Include test plan |
| "WIP" in title | Is it ready? | Use draft PR instead |
