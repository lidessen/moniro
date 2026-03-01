# Performance

Building systems that meet performance requirements efficiently.

## Table of Contents

- [Performance Approach](#performance-approach)
- [Optimization Hierarchy](#optimization-hierarchy)
- [Common Optimizations](#common-optimizations)
- [Measuring Performance](#measuring-performance)
- [Performance Patterns](#performance-patterns)

## Performance Approach

### The Golden Rule

> "Premature optimization is the root of all evil." — Donald Knuth

**But also**: Don't ignore performance until it's too late.

### The Process

```
1. DEFINE   → What are the requirements? (latency, throughput, resources)
2. MEASURE  → What is current performance? (don't guess)
3. PROFILE  → Where is the bottleneck? (don't assume)
4. OPTIMIZE → Fix the bottleneck
5. VERIFY   → Did it improve? Any regressions?
6. REPEAT   → Until requirements met
```

### When to Optimize

**Do optimize when**:

- Measured performance doesn't meet requirements
- Users are complaining
- Cost (infrastructure) is too high
- Profile shows clear bottleneck

**Don't optimize when**:

- "It might be slow"
- "This could be more efficient"
- Performance is acceptable
- No measurement data

## Optimization Hierarchy

Optimize in order of impact:

### 1. Algorithm (Highest Impact)

O(n²) → O(n log n) matters more than anything else.

```python
# O(n²) - checking all pairs
def has_duplicate_slow(items):
    for i, a in enumerate(items):
        for b in items[i+1:]:
            if a == b:
                return True
    return False

# O(n) - using set
def has_duplicate_fast(items):
    return len(items) != len(set(items))
```

### 2. Architecture (High Impact)

System-level decisions: caching, async, batching.

```
Before: User → App → DB (every request)
After:  User → App → Cache → DB (cache hit = fast)
```

### 3. Implementation (Medium Impact)

Data structures, memory patterns, I/O handling.

```python
# Slow: string concatenation in loop
result = ""
for item in items:
    result += str(item)

# Fast: join
result = "".join(str(item) for item in items)
```

### 4. Micro-optimization (Low Impact)

Usually not worth it. Only after profiling shows specific hotspot.

## Common Optimizations

### Caching

**When to cache**:

- Data is read more than written
- Computing/fetching is expensive
- Stale data is acceptable (briefly)

**Cache strategies**:

```
Cache-aside (most common):
1. Check cache
2. If miss: fetch from source, store in cache
3. Return data

Write-through:
1. Write to cache and source simultaneously
2. Ensures consistency, slower writes

Write-behind:
1. Write to cache immediately
2. Async write to source
3. Faster, but risk of data loss
```

**Cache invalidation** (the hard problem):

- TTL (time-based expiration)
- Event-based invalidation
- Version/tag invalidation

### Pagination

Don't load everything when user only sees 20 items.

```python
# Bad: load all, then slice
all_users = db.query(User).all()  # 10,000 users
return all_users[0:20]

# Good: limit at database level
users = db.query(User).limit(20).offset(0).all()
```

**Cursor vs offset pagination**:

- Offset: Simple, but slow for large offsets
- Cursor: Consistent, scales well, slightly more complex

### Lazy Loading

Load only when needed.

```python
# Eager: load everything upfront
user = db.query(User).options(joinedload(User.orders)).get(id)

# Lazy: load orders only when accessed
user = db.query(User).get(id)
orders = user.orders  # Query happens here
```

**Use lazy when**: Data often unused
**Use eager when**: Data always needed, N+1 query problem

### Batching

Combine multiple operations into one.

```python
# Bad: N database calls
for user_id in user_ids:
    user = db.query(User).get(user_id)
    process(user)

# Good: 1 database call
users = db.query(User).filter(User.id.in_(user_ids)).all()
for user in users:
    process(user)
```

### Async Processing

Move non-critical work off the request path.

```
Sync (slow):
  Request → Process → Send Email → Send Notification → Response

Async (fast):
  Request → Process → Queue Email → Queue Notification → Response
                         ↓                    ↓
                    Worker sends          Worker sends
```

### Connection Pooling

Reuse database/HTTP connections instead of creating new ones.

```python
# Bad: new connection per request
def get_user(id):
    conn = create_connection()  # Expensive
    user = conn.query(...)
    conn.close()
    return user

# Good: connection pool
pool = ConnectionPool(min=5, max=20)

def get_user(id):
    conn = pool.get()  # Fast - reuses existing
    user = conn.query(...)
    pool.return(conn)
    return user
```

### Denormalization

Trade storage for query speed.

```sql
-- Normalized (slow for listing):
SELECT orders.*, users.name
FROM orders
JOIN users ON orders.user_id = users.id;

-- Denormalized (fast, but duplicate data):
SELECT * FROM orders;  -- includes user_name column
```

**Use when**: Read-heavy, query is critical path
**Cost**: Storage, complexity of keeping in sync

## Measuring Performance

### Key Metrics

**Latency**: Time to complete operation

- p50: Median (typical experience)
- p95: 95th percentile (most users)
- p99: 99th percentile (worst typical case)

**Throughput**: Operations per time unit

- Requests per second (RPS)
- Transactions per second (TPS)

**Resource usage**:

- CPU utilization
- Memory usage
- I/O wait

### Profiling Tools

**Application profiling**:

- Python: cProfile, py-spy
- Node.js: clinic.js, 0x
- Go: pprof
- Java: async-profiler, JFR

**Database profiling**:

- EXPLAIN ANALYZE (PostgreSQL/MySQL)
- Query logs with timing
- Database-specific tools

**System profiling**:

- top, htop (CPU/memory)
- iostat (disk I/O)
- netstat (network)

### Benchmarking

```python
# Simple timing
import time
start = time.perf_counter()
result = function_to_test()
elapsed = time.perf_counter() - start
print(f"Elapsed: {elapsed:.4f}s")

# Statistical benchmarking
import timeit
time = timeit.timeit(function_to_test, number=1000)
print(f"Average: {time/1000:.6f}s")
```

**Benchmark rules**:

- Warm up first (JIT, caches)
- Multiple runs (statistical significance)
- Realistic data (not toy examples)
- Isolated environment (no interference)

## Performance Patterns

### Read-Heavy: Add Caching

```
User → App → Cache (hit) → Response
              ↓ (miss)
           Database → Cache → Response
```

### Write-Heavy: Queue and Batch

```
User → App → Queue → Response (fast)
              ↓
         Worker → Batch Insert → Database
```

### High Throughput: Horizontal Scale

```
          ┌→ App Instance 1 ─┐
User → LB ├→ App Instance 2 ─┼→ Database
          └→ App Instance 3 ─┘
```

### Low Latency: Minimize Round Trips

```
Before: App → DB → App → Cache → App → External API → Response
After:  App → [DB + Cache + API in parallel] → Response
```

### Cost Optimization: Right-size Resources

```
Before: 10 large instances (80% idle)
After:  4 medium instances (70% utilized) + autoscaling
```
