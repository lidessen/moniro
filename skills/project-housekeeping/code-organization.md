# Code Organization

Strategies for organizing code within files - detecting dead code, finding duplicates, consolidating scattered logic, and safe refactoring approaches.

## Table of Contents

- [Dead Code Detection](#dead-code-detection)
- [Finding Duplicate Code](#finding-duplicate-code)
- [Consolidation Strategies](#consolidation-strategies)
- [File Relocation](#file-relocation)
- [Module Boundary Design](#module-boundary-design)
- [Splitting Large Files](#splitting-large-files)
- [Merging Scattered Code](#merging-scattered-code)
- [Safe Refactoring Workflows](#safe-refactoring-workflows)

## Dead Code Detection

### What is Dead Code?

**Unused code**:
- Functions never called
- Variables never read
- Imports never used
- Routes never accessed
- Components never rendered

**Why it accumulates**:
- Features removed but code remains
- Refactoring leaves orphaned code
- Copy-paste includes unused parts
- "Maybe we'll need it someday" (but never do)

### Detection Strategies

#### Automated Tools

**JavaScript/TypeScript**:
```bash
# ESLint with no-unused-vars
npm install --save-dev eslint
npx eslint . --ext .js,.ts,.tsx

# ts-prune (finds unused exports)
npm install --save-dev ts-prune
npx ts-prune

# Knip (comprehensive unused code finder)
npm install --save-dev knip
npx knip
```

**Python**:
```bash
# Vulture (finds unused code)
pip install vulture
vulture src/

# pylint with unused variable warnings
pylint src/ --disable=all --enable=unused-variable,unused-import
```

**Rust**:
```bash
# Compiler warnings
cargo build

# Will warn about:
# - unused variables
# - unused functions
# - dead code
```

**Go**:
```bash
# go vet finds some unused code
go vet ./...

# golangci-lint with deadcode check
golangci-lint run --enable=deadcode
```

#### Manual Search Patterns

**Find unreferenced functions**:
```bash
# List function definitions
rg "^function |^const \w+ = " --only-matching

# Search for each function name in codebase
# If only 1 result (the definition), likely unused
```

**Find unused imports**:
```bash
# TypeScript/JavaScript
rg "^import .* from" -o | sort -u

# Check each import
rg "ImportedName" --count
# If count is 1 (just the import line), unused
```

**Find unreferenced exports**:
```bash
# Find all exports
rg "^export " -l

# For each exported item, search across codebase
rg "exportedFunction" --count
```

### Safe Deletion Process

1. **Identify candidate** (appears unused)
2. **Double-check with search** - Global search across all files
3. **Check runtime usage** - Logs, analytics (is it called in production?)
4. **Consider reflection/dynamic imports** - Not caught by static analysis
5. **Remove and test** - Run all tests
6. **Commit separately** - Easy to revert
7. **Monitor** - Watch for errors after deployment

**Example**:
```bash
# 1. Tool identifies unused function
npx ts-prune

# 2. Verify
rg "processPayment" --count
# Output: 1 match (only in definition)

# 3. Check git history
git log -S "processPayment" --all
# When was it last used?

# 4. Remove
git rm src/payments/process-payment.ts

# 5. Update exports/imports
# ... remove from index.ts

# 6. Test
npm test

# 7. Commit
git commit -m "refactor: remove unused processPayment function

No references found in codebase.
Last used in commit abc123 (removed feature in v2.0).
All tests passing."
```

## Finding Duplicate Code

### Types of Duplication

**Exact duplicates**:
```javascript
// File A
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// File B (exact copy)
function formatDate(date) {
  return date.toISOString().split('T')[0];
}
```

**Structural duplicates** (same logic, different names):
```javascript
// File A
function calculateTotalPrice(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// File B (same structure)
function sumPrices(products) {
  return products.reduce((total, product) => total + product.price, 0);
}
```

**Near duplicates** (mostly similar):
```javascript
// File A
function validateEmail(email) {
  if (!email) return false;
  if (!email.includes('@')) return false;
  return true;
}

// File B (similar)
function isValidEmail(email) {
  if (!email) return false;
  if (!email.includes('@')) return false;
  if (!email.includes('.')) return false;  // One extra check
  return true;
}
```

### Detection Tools

**General-purpose**:
```bash
# jscpd (JavaScript Copy/Paste Detector)
npm install -g jscpd
jscpd src/

# PMD CPD (Copy-Paste Detector, multiple languages)
# Supports Java, JavaScript, Python, Go, etc.
```

**Language-specific**:

**JavaScript/TypeScript**:
```bash
jsinspect src/
```

**Python**:
```bash
# pylint with duplicate detection
pylint --disable=all --enable=duplicate-code src/
```

**Manual pattern**:
```bash
# Find files with similar function signatures
rg "function \w+\(" -o | sort | uniq -c | sort -rn

# Functions appearing multiple times might be duplicates
```

### Consolidation Decisions

**When to consolidate**:
- ✅ Exact duplicates (always consolidate)
- ✅ Structural duplicates with same purpose
- ✅ More than 2 instances (Rule of Three)
- ✅ Logic likely to change together

**When to leave separate**:
- ❌ Different domains (coincidentally similar)
- ❌ Different change rates (one stable, one evolving)
- ❌ Only 2 instances and unlikely to add more
- ❌ Consolidation adds complexity (abstraction cost > duplication cost)

**Example decision**:
```javascript
// Consolidate (same purpose, exact duplicate)
formatUserDate(date) { return date.toISOString().split('T')[0]; }
formatOrderDate(date) { return date.toISOString().split('T')[0]; }
// → Single formatDate(date) function

// Leave separate (different domains)
calculateShippingCost(items) { return items.reduce(...) }
calculateTaxTotal(items) { return items.reduce(...) }
// Similar structure but different purposes, likely to diverge
```

## Consolidation Strategies

### Strategy 1: Extract to Shared Module

**Pattern**: Move common code to shared location

```javascript
// Before
// src/orders/format-date.ts
export function formatDate(date) { ... }

// src/users/format-date.ts
export function formatDate(date) { ... }  // Duplicate

// After
// src/shared/format-date.ts
export function formatDate(date) { ... }

// src/orders/order.ts
import { formatDate } from '../shared/format-date';

// src/users/user.ts
import { formatDate } from '../shared/format-date';
```

**Process**:
1. Create shared module
2. Move function to shared location
3. Update all imports
4. Delete duplicates
5. Test

### Strategy 2: Extract to Library Package

**Pattern**: For monorepo or publishable code

```
Before:
packages/api/src/utils/format-date.ts
packages/web/src/utils/format-date.ts

After:
packages/shared/src/format-date.ts

packages/api/package.json:
  "dependencies": { "@company/shared": "workspace:*" }

packages/api/src/...:
  import { formatDate } from '@company/shared';
```

### Strategy 3: Create Abstraction

**Pattern**: Duplicate logic with variations

```javascript
// Before
function validateEmail(email) {
  if (!email) return false;
  if (!email.includes('@')) return false;
  return true;
}

function validatePhone(phone) {
  if (!phone) return false;
  if (phone.length < 10) return false;
  return true;
}

// After (if patterns truly shared)
function validateField(value, validators) {
  if (!value) return false;
  return validators.every(validator => validator(value));
}

const validateEmail = (email) => 
  validateField(email, [
    v => v.includes('@')
  ]);

const validatePhone = (phone) => 
  validateField(phone, [
    v => v.length >= 10
  ]);
```

**Caution**: Don't over-abstract. Sometimes duplication is clearer.

## File Relocation

### When to Move Files

**Indicators**:
- File in wrong directory for its purpose
- Better conceptual location exists
- Related files scattered
- Growing feature needs own directory

**Example**:
```
Before:
src/utils/user-validation.ts  (wrong: not a generic utility)

After:
src/user/validation.ts  (right: part of user domain)
```

### Safe Relocation Process

```bash
# 1. Plan destination
# Determine new location based on file's purpose

# 2. Move file (preserves git history)
git mv src/old/location.ts src/new/location.ts

# 3. Update imports
# Use IDE refactoring or manual search-replace
rg "from '.*old/location'" -l | xargs sed -i "s|old/location|new/location|g"

# 4. Update exports
# If file is re-exported from index, update those too

# 5. Test
npm run build
npm test

# 6. Commit
git commit -m "refactor: move location.ts to new directory

Moved from utils/ to user/ directory to better reflect purpose.
All imports updated.
Tests passing."
```

### Handling Barrel Files

**Barrel file** (index.ts that re-exports):
```typescript
// src/user/index.ts
export * from './User';
export * from './validation';
export * from './auth';
```

**When moving files**, update barrel exports:
```bash
# Before
src/utils/user-validation.ts

# After move
src/user/validation.ts

# Update src/user/index.ts
export * from './validation';  // Add this
```

## Module Boundary Design

### Good Module Boundaries

**Characteristics**:
- **High cohesion**: Related code stays together
- **Low coupling**: Modules don't depend on each other's internals
- **Clear interface**: Public API is explicit
- **Single responsibility**: Each module does one thing

**Example**:
```
src/user/
  User.ts           (domain model)
  repository.ts     (database access)
  service.ts        (business logic)
  controller.ts     (HTTP handlers)
  index.ts          (public exports)
```

External code only imports from `user/index.ts`, not internal files.

### Detecting Boundary Violations

**Smell**: Import from internal module
```typescript
// Bad - reaching into internals
import { UserRepository } from '../user/repository';

// Good - using public interface
import { UserService } from '../user';
```

**Tool check**:
```bash
# Find imports that skip barrel files
rg "from '\.\./\w+/[^']*'" --type ts
```

## Splitting Large Files

### When to Split

**Indicators**:
- File >500 lines
- Multiple responsibilities (violates Single Responsibility Principle)
- Hard to navigate
- Frequent merge conflicts (multiple people editing)

### Splitting Strategies

**Strategy 1: By Responsibility**

```javascript
// Before: user.ts (800 lines)
class User { ... }
function validateUser() { ... }
function formatUserDisplay() { ... }
class UserRepository { ... }

// After: Split by responsibility
// user.ts (200 lines)
class User { ... }

// user-validation.ts (100 lines)
function validateUser() { ... }

// user-formatting.ts (100 lines)
function formatUserDisplay() { ... }

// user-repository.ts (200 lines)
class UserRepository { ... }

// index.ts (exports)
export * from './user';
export * from './user-validation';
export * from './user-formatting';
export * from './user-repository';
```

**Strategy 2: By Feature**

```javascript
// Before: components.tsx (1000 lines)
export function Button() { ... }
export function Card() { ... }
export function Modal() { ... }
// ... 20 more components

// After: Split by component
// components/
//   Button.tsx
//   Card.tsx
//   Modal.tsx
//   index.ts (barrel file)
```

**Strategy 3: By Layer**

```javascript
// Before: user-api.ts (600 lines)
// HTTP handlers, business logic, database access all mixed

// After:
// user/
//   controller.ts   (HTTP layer)
//   service.ts      (business logic)
//   repository.ts   (data access)
```

## Merging Scattered Code

### When to Merge

**Indicators**:
- Related code in different files
- Always changing together
- Artificial separation
- Single-function files

**Example**:
```
Before (over-organized):
src/user/
  user-id.ts        (just type UserId = string;)
  user-name.ts      (just type UserName = string;)
  user-email.ts     (just type UserEmail = string;)
  user.ts           (uses all above types)

After (consolidated):
src/user/
  types.ts          (all types together)
  user.ts           (uses types)
```

## Safe Refactoring Workflows

### Workflow 1: Extract Function

```javascript
// Before
function processOrder(order) {
  // 50 lines of validation
  if (!order.email.includes('@')) return false;
  if (!order.items.length) return false;
  // ... 48 more lines
  
  // 30 lines of calculation
  let total = 0;
  for (let item of order.items) {
    total += item.price * item.quantity;
  }
  // ... 28 more lines
  
  // 20 lines of database save
  // ...
}

// After
function processOrder(order) {
  if (!validateOrder(order)) return false;
  const total = calculateTotal(order);
  saveOrder(order, total);
}

function validateOrder(order) {
  // validation logic
}

function calculateTotal(order) {
  // calculation logic
}

function saveOrder(order, total) {
  // database logic
}
```

**Process**:
1. Identify coherent blocks
2. Extract each block to named function
3. Replace inline code with function call
4. Test after each extraction

### Workflow 2: Move Code Between Files

**Process**:
1. Copy code to new location
2. Update imports in new location
3. Export from new location
4. Update imports in original consumers
5. Delete from original location
6. Test
7. Commit

### Workflow 3: Consolidate Duplicates

```bash
# 1. Find duplicates
jscpd src/

# 2. For each duplicate:
# 2a. Verify they're truly the same purpose
diff file1.ts file2.ts

# 2b. Choose canonical location
# Usually: most general location or shared/

# 2c. Keep one, import in others
# src/shared/helper.ts - keep this
# src/feature-a/helper.ts - delete, import from shared
# src/feature-b/helper.ts - delete, import from shared

# 3. Test
npm test

# 4. Commit
git commit -m "refactor: consolidate duplicate helper function"
```

## Best Practices Summary

1. **Eliminate dead code** - Use tools to find, verify, and remove
2. **Reduce duplication** - Consolidate exact duplicates, consider structural duplicates
3. **Respect module boundaries** - Don't import internals
4. **Split large files** - Keep files under 500 lines
5. **Merge scattered code** - Related code should be together
6. **Refactor incrementally** - Small, tested, committed changes
7. **Test everything** - Don't commit without testing
8. **Use IDE refactoring** - Safer than manual editing

**Red flags**:
- Files >1000 lines
- Exact duplicates
- Dead code warnings ignored
- Deep import paths bypassing public APIs
- Single-function files (over-split)
- Utils/helpers with >20 functions (under-split)
