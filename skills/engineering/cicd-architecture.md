# CI/CD Architecture

Designing build and deployment pipelines for fast, safe delivery.

## Table of Contents

- [Pipeline Principles](#pipeline-principles)
- [Pipeline Stages](#pipeline-stages)
- [Deployment Strategies](#deployment-strategies)
- [Environment Management](#environment-management)
- [Pipeline Patterns](#pipeline-patterns)

## Pipeline Principles

### Fast Feedback

Fail fast, surface errors quickly.

```
Order stages by speed and failure likelihood:
1. Lint (seconds, catches syntax)
2. Type check (seconds, catches types)
3. Unit tests (seconds-minutes)
4. Build (minutes)
5. Integration tests (minutes)
6. E2E tests (minutes-hours)
```

### Reproducibility

Same inputs → same outputs.

**Ensure**:

- Pinned dependency versions
- Immutable build artifacts
- Deterministic build process
- Environment as code

### Isolation

Steps don't affect each other unexpectedly.

```
# Bad: shared state between jobs
Job A writes to shared directory
Job B reads from same directory (race condition)

# Good: explicit artifact passing
Job A → uploads artifact
Job B → downloads artifact
```

### Visibility

Easy to see what's happening and why.

- Clear stage names
- Detailed logs
- Status notifications
- Build badges

## Pipeline Stages

### Typical Pipeline

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Build   │ →  │   Test   │ →  │ Package  │ →  │  Deploy  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     ↓               ↓               ↓               ↓
  Compile       Unit tests      Container      Staging
  Bundle        Integration     Archive        Production
  Assets        E2E tests       Sign
```

### Stage Details

**Build**:

- Compile source code
- Bundle assets
- Generate artifacts
- Goal: Verify code builds

**Test**:

- Unit tests (isolated, fast)
- Integration tests (components together)
- E2E tests (full system, slow)
- Goal: Verify correctness

**Static Analysis**:

- Linting (code style)
- Type checking
- Security scanning (SAST)
- Dependency audit
- Goal: Catch issues without running

**Package**:

- Create deployable artifact
- Container image, zip, binary
- Tag with version/commit
- Goal: Immutable deployment unit

**Deploy**:

- Push to environment
- Run migrations
- Smoke test
- Goal: Make available to users

### Parallelization

Run independent jobs in parallel:

```
          ┌→ Lint ────────┐
          ├→ Type Check ──┤
Build → ──┼→ Unit Tests ──┼→ Package → Deploy
          └→ Security ────┘
```

## Deployment Strategies

### Rolling Deployment

Gradually replace old instances with new.

```
Before: [v1] [v1] [v1] [v1]
Step 1: [v2] [v1] [v1] [v1]
Step 2: [v2] [v2] [v1] [v1]
Step 3: [v2] [v2] [v2] [v1]
After:  [v2] [v2] [v2] [v2]
```

**Pros**: Simple, no extra infrastructure
**Cons**: Mixed versions during deploy, slower rollback
**Use when**: Stateless services, backward-compatible changes

### Blue-Green Deployment

Two identical environments, switch traffic instantly.

```
           ┌──────────┐
           │   Load   │
           │ Balancer │
           └────┬─────┘
        ┌───────┴───────┐
        ↓               ↓
   ┌─────────┐     ┌─────────┐
   │  Blue   │     │  Green  │
   │  (v1)   │     │  (v2)   │
   │ ACTIVE  │     │  IDLE   │
   └─────────┘     └─────────┘

After switch:
   ┌─────────┐     ┌─────────┐
   │  Blue   │     │  Green  │
   │  (v1)   │     │  (v2)   │
   │  IDLE   │     │ ACTIVE  │
   └─────────┘     └─────────┘
```

**Pros**: Instant rollback, no mixed versions
**Cons**: Double infrastructure cost
**Use when**: Critical systems, need instant rollback

### Canary Deployment

Route small percentage of traffic to new version first.

```
Step 1: 5% → v2, 95% → v1
        Monitor metrics...
Step 2: 25% → v2, 75% → v1
        Monitor metrics...
Step 3: 50% → v2, 50% → v1
        Monitor metrics...
Step 4: 100% → v2
```

**Pros**: Limited blast radius, metrics-driven
**Cons**: Complex routing, longer deployment
**Use when**: High-traffic systems, risky changes

### Feature Flags

Deploy code, control activation separately.

```python
if feature_flags.is_enabled("new_checkout", user):
    return new_checkout_flow(user)
else:
    return old_checkout_flow(user)
```

**Pros**: Decouple deploy from release, target users
**Cons**: Code complexity, flag cleanup needed
**Use when**: Gradual rollout, A/B testing, kill switch needed

## Environment Management

### Environment Tiers

```
Development → Staging → Production
    ↓            ↓          ↓
 Unstable   Production   Real users
 Latest     -like        Protected
 Frequent   Testing      Stable
```

### Environment Parity

Keep environments as similar as possible:

**Same**:

- OS and runtime versions
- Service configuration
- Infrastructure topology
- Deployment process

**Different**:

- Scale (fewer instances in staging)
- Data (anonymized in non-prod)
- External services (sandboxed)

### Configuration Management

**Environment variables**:

```bash
# Different per environment
DATABASE_URL=postgres://...
API_KEY=...
LOG_LEVEL=debug|info|error
```

**Config hierarchy**:

```
defaults.yaml      ← Base configuration
├─ development.yaml  ← Dev overrides
├─ staging.yaml      ← Staging overrides
└─ production.yaml   ← Production overrides
```

### Secrets Management

**Never**:

- Commit secrets to repository
- Log secrets
- Pass secrets in URLs

**Use**:

- Secret managers (AWS Secrets Manager, HashiCorp Vault)
- CI/CD secret variables
- Encrypted config files

## Pipeline Patterns

### Trunk-Based Development

All developers work on main branch.

```
main: ──●──●──●──●──●──●──●──
         │     │     │
       deploy deploy deploy
```

**Requires**: Feature flags, strong testing
**Benefits**: Fast integration, simple branching

### GitFlow

Feature branches, release branches.

```
main:    ──────●─────────●──────
               ↑         ↑
release:    ──●───●   ──●───●
             ↑   ↑     ↑
develop: ──●──●──●──●──●──●──
            ↑  ↑     ↑
features: ──●  ●     ●
```

**Requires**: More ceremony, release management
**Benefits**: Clear release process, longer-lived versions

### Recommended: Simplified Flow

```
main:     ──●──●──●──●──●──●──●──
            ↑  ↑  ↑  ↑  ↑  ↑
features: ──●  ●  ●  ●  ●  ●
              short-lived branches
              deploy on merge to main
```

- Feature branches from main
- Keep branches short-lived (<1 week)
- Merge to main triggers deploy
- Use feature flags for incomplete features

### Monorepo Pipeline

Single repo, multiple services.

```
┌─────────────────────────────────────────┐
│                Monorepo                  │
├──────────┬──────────┬──────────┬────────┤
│ service-a │ service-b │ service-c │ shared │
└──────────┴──────────┴──────────┴────────┘

On change:
1. Detect affected services
2. Run only affected pipelines
3. Deploy only changed services
```

**Tools**: Nx, Turborepo, Bazel

### Multi-Stage Docker Build

Optimize container builds:

```dockerfile
# Build stage
FROM node:18 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:18-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]
```

**Benefits**: Smaller final image, build tools not in production
