# Reviewability Assessment

Detailed criteria for evaluating if changes are ready for review.

## Cohesion Checks

### Mixed Concerns Detection

| Pattern | Signs | Action |
|---------|-------|--------|
| **Feature + Refactor** | New functionality alongside rename/restructure | Split: refactor first, feature second |
| **Multiple Features** | Unrelated modules changed, distinct commit messages needed | Split by feature/domain |
| **Bug Fix + Feature** | Fix for existing issue plus new capability | Split: fix first (backportable) |
| **Config + Logic** | CI/build changes with application code | Split: infra separate from logic |
| **Formatting + Logic** | >30% changes are whitespace/formatting | Split: format commit first |

### How to Detect

```bash
# Check file distribution
git diff --stat HEAD~1  # or --cached for staged

# Look for patterns:
# - Files from unrelated directories
# - Mix of test + non-test (OK) vs unrelated features (not OK)
# - Config files (.yml, .json) + source files
```

### Suggested Split Groups

When recommending splits, be specific:

```
Suggested split:
1. Refactoring (commit first):
   - src/utils/helpers.ts (rename functions)
   - src/utils/format.ts (extract method)

2. Feature (commit second):
   - src/features/auth/login.ts (new)
   - src/features/auth/logout.ts (new)
   - tests/auth.test.ts (new)
```

---

## Size Assessment

### Thresholds

| Size | Lines | Files | Review Effort | Recommendation |
|------|-------|-------|---------------|----------------|
| Small | <200 | <5 | 15-30 min | Ideal |
| Medium | 200-400 | 5-10 | 30-60 min | Good |
| Large | 400-800 | 10-20 | 1-2 hours | Consider split |
| X-Large | >800 | >20 | >2 hours | Strongly split |

### Context Matters

Size thresholds adjust based on:

- **Generated code**: Exclude from count (migrations, lockfiles)
- **Test code**: Higher tolerance (tests are lower risk)
- **Deletions**: Easier to review than additions
- **Mechanical changes**: Renames, moves count less

```bash
# Get meaningful stats
git diff --stat | grep -v "lock\|generated\|migration"
```

---

## Noise Detection

### Debug Code Patterns

| Language | Patterns |
|----------|----------|
| JavaScript/TS | `console.log`, `console.debug`, `debugger` |
| Python | `print(`, `breakpoint()`, `pdb.set_trace()` |
| Go | `fmt.Println`, `log.Print` (in non-log files) |
| Java | `System.out.print`, `e.printStackTrace()` |
| Ruby | `puts`, `p `, `binding.pry` |

### TODO/FIXME

```bash
# Check for markers in staged changes
git diff --cached | grep -E "TODO|FIXME|XXX|HACK"
```

Action: Ask if intentional. If debugging, remove. If legitimate TODO, ensure it has context.

### Commented Code

Look for:
- Blocks of commented-out code (>3 lines)
- Commented imports/requires
- `// old implementation` patterns

Action: Remove. Version control preserves history.

---

## Breaking Change Detection

### Patterns

| Type | Detection |
|------|-----------|
| **Removed export** | `export` removed from function/class |
| **Renamed public API** | Function/method/class name changed |
| **Signature change** | Parameters added (required), removed, reordered |
| **Type change** | Return type or parameter type changed |
| **Schema change** | Database/API schema field removed/renamed |
| **Config change** | Environment variable renamed, config key changed |

### Impact Assessment

For each breaking change, determine:

1. **Scope**: Internal only vs public API
2. **Callers**: How many places use this?
3. **Migration**: Can callers update easily?

```bash
# Find callers of changed function
grep -r "functionName" --include="*.ts" src/
```

---

## Proceed vs Block

### Block (require resolution)

- Mixed concerns detected AND user hasn't acknowledged
- >1000 lines without explicit user confirmation
- Debug code found AND not acknowledged as intentional

### Proceed with warning

- 400-800 lines (warn, but allow)
- Minor TODOs with context
- Breaking changes acknowledged by user

### Proceed freely

- <400 lines, single concern, no noise
- User explicitly says "proceed anyway"
