# Daemon API Auth Test Cases

Token-based authentication for daemon REST API.
Added in response to PR #75 security review (CORS `*` + unauthenticated API = cross-origin RCE).

## Background

- Daemon generates a random UUID token on start, writes to `~/.agent-worker/daemon.json`
- CLI client reads token from `daemon.json`, sends `Authorization: Bearer <token>` on every request
- CORS removed entirely — daemon serves local CLI only, no browser access

## Test Matrix

### Rejection: no token (all → 401)

| Endpoint | Method | Why it matters |
|----------|--------|----------------|
| `/health` | GET | Info leak (PID, port, agent list) |
| `/agents` | POST | Creates agent with arbitrary config |
| `/agents/:name` | DELETE | Stops running agent |
| `/run` | POST | Executes agent (SSE stream) |
| `/serve` | POST | Executes agent (sync) |
| `/workflows` | POST | **Highest risk**: accepts `ParsedWorkflow` with shell commands → RCE |
| `/workflows/:name/:tag` | DELETE | Stops workflow |
| `/shutdown` | POST | Kills daemon |

### Rejection: wrong credentials (→ 401)

| Scenario | Authorization header |
|----------|---------------------|
| Wrong token | `Bearer wrong-token` |
| Wrong scheme | `Token <correct-token>` |
| Empty header | `` |

### Acceptance: correct token (→ non-401)

Each endpoint with `Authorization: Bearer <token>` should reach the route handler.
Expected status depends on request validity (201, 400, 404, etc.) — the point is it's **not 401**.

| Endpoint | Method | Expected status | Reason |
|----------|--------|-----------------|--------|
| `/health` | GET | 200 | Normal response |
| `/agents` | POST | 201 | Agent created |
| `/run` | POST | 404 | Past auth, agent not found |
| `/serve` | POST | 404 | Past auth, agent not found |
| `/agents/:name` | DELETE | 404 | Past auth, agent not found |
| `/workflows` | POST | 400 | Past auth, validation fails (empty body) |
| `/workflows/:name/:tag` | DELETE | 404 | Past auth, workflow not found |

### Backward compatibility: no token configured

When `createDaemonApp` receives no `token`, all endpoints work without `Authorization` header.
This supports the legacy API path and test usage.

| Scenario | Expected |
|----------|----------|
| GET /health (no auth header) | 200 |
| POST /agents (no auth header) | 201 |

## Implementation

Test file: `test/unit/daemon-api.test.ts` → `describe("token auth")`

Key pattern: for "acceptance" tests on endpoints that require data (agents, workflows),
we send valid auth + minimal body and assert the status is **not 401**.
A 404 or 400 proves the request passed the auth middleware and reached the route handler.
