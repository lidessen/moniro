# Impact Analysis Guide

**Impact analysis** = Understanding the blast radius of a code change.

Critical for: signature changes, shared utilities, data model changes, breaking changes.

## Table of Contents

- [When to Perform](#when-to-perform)
- [Analysis Techniques](#analysis-techniques)
  - [Function/Method Changes](#1-functionmethod-changes)
  - [Interface/Type Changes](#2-interfacetype-changes)
  - [Data Model/Schema Changes](#3-data-modelschema-changes)
  - [Shared Utility Changes](#4-shared-utility-changes)
- [Impact Analysis Workflow](#impact-analysis-workflow)
- [Common Impact Patterns](#common-impact-patterns)
- [Tools by Language](#tools-by-language)
- [Red Flags](#red-flags)
- [Efficiency Tips](#efficiency-tips)

---

## When to Perform

**Always analyze impact for**:
- Function signature changes (parameters, return type)
- Modified public APIs or exported functions
- Changed interfaces, types, or data structures
- Renamed or moved functions/classes
- Modified shared utilities or core libraries
- Database schema changes
- Breaking changes

**Skip impact analysis for**:
- Brand new functions (no existing callers)
- Private helper functions with local scope
- Internal implementation changes (signature unchanged)
- Test-only code

## Analysis Techniques

### 1. Function/Method Changes

**Detect signature changes**:
```bash
# Find modified function signatures
git diff <from>..<to> -- path/to/file.ts | grep -E "^[-+].*\b(function|def|async|export)\b"
```

**For each changed function**:
```bash
# Find all call sites
grep -r "functionName" --include="*.ts" --include="*.tsx" .

# Or use language-specific tools
# TypeScript: tsc --noEmit (reports type errors at call sites)
# Python: mypy (type check)
# Go: go build (compile errors show usage)
```

**Check**:
- [ ] All call sites still pass correct parameters
- [ ] Return type changes handled by callers
- [ ] Optional parameters have defaults or callers updated
- [ ] Removed parameters no longer used anywhere

**Example**:
```typescript
// Changed from:
- function getUserById(id: string): User
// To:
+ function getUserById(id: string, options?: FetchOptions): Promise<User>

// Impact analysis needed:
// 1. Now returns Promise - all callers must await
// 2. Grep for "getUserById(" → find ~15 call sites
// 3. Verify each handles Promise correctly
// 4. Check if any need the new options parameter
```

### 2. Interface/Type Changes

**Detect type changes**:
```bash
git diff <from>..<to> -- path/to/types.ts | grep -E "^[-+].*(interface|type|enum)\b"
```

**For each changed type**:
```bash
# Find all usage
grep -r "TypeName" --include="*.ts" .

# Check implementations
grep -r "implements TypeName\|extends TypeName" --include="*.ts" .
```

**Check**:
- [ ] All implementations updated for new/removed fields
- [ ] Serialization/deserialization handles new structure
- [ ] Database schema aligned if type maps to DB
- [ ] API contracts updated (OpenAPI, GraphQL schema)
- [ ] Migration path for existing data

**Example**:
```typescript
// Changed:
  interface User {
    id: string;
    name: string;
-   email: string;
+   email: string | null;  // Now nullable
+   phone?: string;         // New optional field
  }

// Impact analysis:
// 1. Email can be null - check all code assuming email exists
// 2. Phone is new - verify forms, API, DB all handle it
// 3. Search for "user.email" → validate null handling
// 4. Check DB migration adds phone column
```

### 3. Data Model/Schema Changes

**For database changes**:
```bash
# Find migration files
git diff <from>..<to> -- **/migrations/*.sql

# Find model definitions
git diff <from>..<to> -- **/models/*.ts **/models/*.py
```

**Verify complete data flow**:
- [ ] **Migration**: ALTER/CREATE statements present
- [ ] **Rollback**: DOWN migration exists (for safe rollback)
- [ ] **Backend model**: Updated to match schema
- [ ] **Validation**: Input validation handles new fields
- [ ] **API**: Endpoints accept/return new fields
- [ ] **Frontend**: Forms, displays updated
- [ ] **Tests**: Updated for new schema

**Example**:
```sql
-- Migration adds column:
+ ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- Impact analysis checklist:
-- [x] Migration file exists
-- [ ] Rollback migration (DROP COLUMN)
-- [ ] Backend User model has phone field
-- [ ] API serializer includes phone
-- [ ] Registration form has phone input
-- [ ] User profile displays phone
-- [ ] Tests cover phone validation
```

### 4. Shared Utility Changes

**Identify shared utilities**:
```bash
# Find utilities (common patterns)
find . -path "*/utils/*" -o -path "*/helpers/*" -o -path "*/lib/*" -o -path "*/core/*"

# Check if modified
git diff <from>..<to> --name-only | grep -E "(utils|helpers|lib|core)/"
```

**For each modified utility**:
```bash
# Find all imports
grep -r "from.*utilName\|import.*utilName" --include="*.ts" --include="*.py" .

# Count usage to assess blast radius
grep -r "utilFunctionName" --include="*.ts" | wc -l
```

**High usage (>10 call sites) = high risk**:
- [ ] Review utility change carefully
- [ ] Sample 3-5 diverse call sites to verify compatibility
- [ ] Check if change is backward compatible
- [ ] Consider deprecation instead of breaking change
- [ ] Ensure tests cover main use cases

**Example**:
```typescript
// Utility change in utils/validation.ts:
- export function validateEmail(email: string): boolean
+ export function validateEmail(email: string, options?: EmailOptions): ValidationResult

// Impact analysis:
// 1. Grep "validateEmail(" → 47 call sites! (high risk)
// 2. Return type changed: boolean → ValidationResult (breaking)
// 3. Sample 5 call sites - all assume boolean return
// 4. **Risk**: Will break 47 locations
// 5. **Recommendation**: Keep old signature, add new function instead
```

## Impact Analysis Workflow

```
1. Identify change type
   ↓
2. Determine if high-impact (shared, public API, data model)
   ↓
3. Find all usage locations (grep, language tools)
   ↓
4. Categorize by risk
   ├─ Breaking change → All sites must update
   ├─ Backward compatible → New usage okay, old still works
   └─ Internal → Minimal impact
   ↓
5. Sample verification
   ├─ Low usage (<5 sites): Check all
   ├─ Medium (5-20): Check 5-10 samples
   └─ High (>20): Check 10 diverse samples + rely on tests/types
   ↓
6. Report in review
   - Impact summary (X files affected)
   - Breaking change? (yes/no)
   - Verified? (sampled N call sites)
   - Recommendation (approve/needs test/needs migration guide)
```

## Common Impact Patterns

### Pattern 1: Function Signature Breaking Change
```
Change: Required parameter added
Impact: All N call sites must update
Action: Verify all sites updated OR make parameter optional
```

### Pattern 2: Data Model Evolution
```
Change: New field in database
Impact: Full stack (DB → API → UI)
Action: Trace data flow end-to-end, verify each layer updated
```

### Pattern 3: Shared Utility Refactor
```
Change: Internal logic improved, signature unchanged
Impact: None (backward compatible)
Action: Trust tests, spot-check 2-3 call sites
```

### Pattern 4: Interface Extension
```
Change: New optional field in interface
Impact: Implementations don't break (optional)
Action: Verify new field used where intended, old code still works
```

### Pattern 5: API Contract Change
```
Change: REST endpoint parameter renamed
Impact: Breaking for all API consumers
Action: Version API, document migration, verify clients updated
```

## Tools by Language

**TypeScript/JavaScript**:
- `tsc --noEmit`: Type errors reveal incompatible call sites
- `grep -r "functionName"`: Find usage
- IDE "Find All References": Most accurate

**Python**:
- `mypy`: Type check reveals issues
- `grep -r "function_name"`: Find usage
- `pytest`: Run tests to catch runtime issues

**Go**:
- `go build`: Compile errors show incompatibilities
- `go test`: Run tests
- `grep -r "FunctionName"`: Find usage

**Java**:
- `javac` or IDE: Compile errors
- `grep -r "methodName"`: Find usage

**Rust**:
- `cargo check`: Borrow checker catches issues
- `cargo test`: Verify changes
- `grep -r "function_name"`: Find usage

## Red Flags

🚩 **High-risk scenarios**:
- Shared utility changed, no tests ran
- Data type changed, no migration file
- Public API modified, no version bump
- >50 call sites affected by breaking change
- Core function signature changed without deprecation cycle

## Efficiency Tips

1. **Use language tooling first**: Type checkers catch most issues faster than manual grep
2. **Trust green CI**: If tests pass, likely call sites are compatible
3. **Sample, don't exhaustive**: For >20 call sites, check 10 diverse samples
4. **Look for patterns**: If first 3 samples all correct, likely others are too
5. **Focus on critical paths**: Auth, payment, data integrity changes need full trace
