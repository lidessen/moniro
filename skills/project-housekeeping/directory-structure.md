# Directory Structure Organization

Strategies for organizing project directories - detecting structural problems, common patterns by project type, and safe reorganization approaches.

## Table of Contents

- [Core Principles](#core-principles)
- [Structure Smells](#structure-smells)
- [Common Patterns by Project Type](#common-patterns-by-project-type)
- [Reorganization Strategies](#reorganization-strategies)
- [Safe Migration Patterns](#safe-migration-patterns)
- [When to Split or Merge](#when-to-split-or-merge)
- [Naming Conventions](#naming-conventions)

## Core Principles

### 1. Structure Serves Purpose

**Good structure** makes it easy to:
- Find files quickly
- Understand project at a glance
- Know where new files belong
- Navigate codebase

**Bad structure** creates:
- "Where does this go?" confusion
- Scattered related files
- Deep nesting that obscures relationships
- Inconsistent organization

**Principle**: Structure should emerge from your project's needs, not be imposed arbitrarily.

### 2. Optimize for Discovery

**Question**: How do people find things?
- By feature? (user-auth, payments, notifications)
- By layer? (controllers, models, views)
- By type? (components, utils, services)

**Your structure should match** how your team thinks about the code.

**Examples**:
- **Microservices**: Organize by service (each self-contained)
- **Layered app**: Organize by layer (all controllers together)
- **Feature-based**: Organize by feature (all user-auth code together)

**Principle**: Structure should match mental model.

### 3. Shallow is Better Than Deep

**Bad** (7 levels deep):
```
src/app/features/user/authentication/services/providers/oauth/google.ts
```

**Good** (3 levels):
```
src/auth/google-oauth.ts
```

**Why**: Deep nesting makes navigation tedious, paths long, and relationships obscure.

**Principle**: Keep nesting to 3-4 levels maximum.

### 4. Consistency Over Perfection

**Better** to have a consistent (even if imperfect) structure than:
- Mix of patterns (some by feature, some by layer)
- Inconsistent naming (camelCase vs snake_case)
- Different conventions per directory

**Principle**: Pick a pattern and apply consistently.

## Structure Smells

### Smell 1: Too Deep (>5 levels)

**Symptom**:
```
src/app/modules/features/user/components/forms/inputs/text/TextField.tsx
```

**Problem**:
- Hard to navigate
- Long import paths
- Obscures actual structure

**Refactor**:
```
src/user/TextField.tsx
# or
src/components/TextField.tsx
```

### Smell 2: Too Flat (<2 levels)

**Symptom**:
```
src/
  UserController.ts
  ProductController.ts
  OrderController.ts
  UserModel.ts
  ProductModel.ts
  OrderModel.ts
  UserService.ts
  ProductService.ts
  ... (50+ files)
```

**Problem**:
- Hard to scan
- No clear organization
- Related files scattered

**Refactor** (by layer):
```
src/
  controllers/
    UserController.ts
    ProductController.ts
    OrderController.ts
  models/
    UserModel.ts
    ProductModel.ts
  services/
    UserService.ts
    ProductService.ts
```

**Or refactor** (by feature):
```
src/
  user/
    UserController.ts
    UserModel.ts
    UserService.ts
  product/
    ProductController.ts
    ProductModel.ts
    ProductService.ts
```

### Smell 3: Inconsistent Naming

**Symptom**:
```
src/
  user-auth/
  productManagement/
  order_processing/
  PaymentServices/
```

**Problem**:
- No clear convention
- Hard to predict names
- Looks unprofessional

**Refactor**:
```
src/
  user-auth/
  product-management/
  order-processing/
  payment-services/
```

Pick one: `kebab-case`, `snake_case`, or `camelCase`. Stick to it.

### Smell 4: "Utils" or "Helpers" Dumping Ground

**Symptom**:
```
src/utils/
  formatDate.ts
  validateEmail.ts
  calculateTotal.ts
  sendNotification.ts
  queryDatabase.ts
  ... (30+ unrelated utilities)
```

**Problem**:
- Becomes catch-all for anything
- Unrelated code grouped together
- Name doesn't convey purpose

**Refactor** (by domain):
```
src/
  formatting/
    formatDate.ts
    formatCurrency.ts
  validation/
    validateEmail.ts
    validatePhone.ts
  calculations/
    calculateTotal.ts
    calculateTax.ts
  notifications/
    sendEmail.ts
    sendSMS.ts
```

**Or** integrate into feature directories:
```
src/
  orders/
    calculate-total.ts
    Order.ts
  users/
    validate-email.ts
    User.ts
```

### Smell 5: Single-File Directories

**Symptom**:
```
src/
  auth/
    auth.ts
  payment/
    payment.ts
  user/
    user.ts
```

**Problem**:
- Unnecessary nesting
- No benefit to directory structure

**Refactor**:
```
src/
  auth.ts
  payment.ts
  user.ts
```

**Exception**: If you expect these to grow, keep directories.

### Smell 6: Mixed Abstractions

**Symptom**:
```
src/
  controllers/     # By layer
  user-service/    # By feature
  db/              # By technology
  utils/           # By... vagueness
```

**Problem**:
- No clear organizing principle
- Confusion about where new files go

**Refactor**: Pick one organizing principle (layer, feature, or hybrid).

## Common Patterns by Project Type

### Web API/Backend Service

**Pattern 1: Layered Architecture**
```
src/
  controllers/     # HTTP endpoints
  services/        # Business logic
  models/          # Data models
  repositories/    # Database access
  middleware/      # HTTP middleware
  config/          # Configuration
  utils/           # Shared utilities
```

**When to use**: Traditional MVC-style applications

**Pattern 2: Feature-Based**
```
src/
  auth/
    auth.controller.ts
    auth.service.ts
    auth.model.ts
  users/
    users.controller.ts
    users.service.ts
    users.model.ts
  products/
    products.controller.ts
    products.service.ts
    products.model.ts
  shared/          # Shared utilities
    database.ts
    logger.ts
```

**When to use**: Domain-driven design, feature teams

### Frontend (React/Vue/etc.)

**Pattern 1: By Type**
```
src/
  components/      # React components
    Button.tsx
    Card.tsx
  hooks/           # Custom hooks
  services/        # API calls
  utils/           # Helpers
  pages/           # Page components
  styles/          # Global styles
```

**When to use**: Small to medium apps

**Pattern 2: By Feature**
```
src/
  features/
    auth/
      components/
      hooks/
      services/
      Auth.tsx
    products/
      components/
      hooks/
      services/
      Products.tsx
  shared/
    components/
    hooks/
    utils/
  pages/           # Page routing
```

**When to use**: Large apps, feature teams

### Library/Package

**Pattern: Simple and Flat**
```
src/
  index.ts         # Main entry point
  core/            # Core functionality
  utils/           # Utilities
  types/           # TypeScript types
examples/          # Usage examples
docs/              # Documentation
tests/             # Tests
```

**When to use**: Published packages, libraries

### CLI Tool

**Pattern: Command-Based**
```
src/
  commands/        # CLI commands
    init.ts
    build.ts
    deploy.ts
  lib/             # Shared library code
  utils/           # Helpers
  index.ts         # CLI entry point
```

**When to use**: Command-line tools

### Monorepo

**Pattern: Package-Based**
```
packages/
  api/             # Backend API
    src/
    package.json
  web/             # Frontend web app
    src/
    package.json
  mobile/          # Mobile app
    src/
    package.json
  shared/          # Shared code
    src/
    package.json
docs/              # Documentation
tools/             # Build tools
```

**When to use**: Multiple related projects

## Reorganization Strategies

### Strategy 1: Incremental Refactoring

**Pattern**: Move files gradually, don't block development

**Steps**:
1. **Document target structure** - Write down desired structure
2. **Identify clusters** - Group of related files to move together
3. **Move one cluster** - Move files, update imports
4. **Test** - Ensure everything still works
5. **Commit** - Small, reversible commits
6. **Repeat** - Move next cluster

**Example**:
```bash
# Week 1: Move user-related files
git mv src/UserController.ts src/users/UserController.ts
git mv src/UserService.ts src/users/UserService.ts
# Update imports, test, commit

# Week 2: Move product-related files
# ... repeat
```

**Pros**:
- Low risk
- Doesn't block other work
- Easy to revert

**Cons**:
- Takes longer
- Mixed structure during transition

### Strategy 2: Big Bang Refactoring

**Pattern**: Reorganize everything at once

**Steps**:
1. **Plan thoroughly** - Map out all moves
2. **Create branch** - Dedicated restructure branch
3. **Move all files** - Complete reorganization
4. **Update all imports** - IDE refactoring tools help
5. **Fix any issues** - Compilation errors, broken imports
6. **Test thoroughly** - All tests must pass
7. **Merge** - When fully working

**Example**:
```bash
git checkout -b refactor/directory-structure
# Move all files to new structure
# Update imports
# Test
git commit -m "refactor: reorganize directory structure

- Moved to feature-based organization
- All files reorganized by feature
- Updated all imports
- All tests passing
"
```

**Pros**:
- Clean result
- Done quickly
- Clear before/after

**Cons**:
- High risk
- Blocks other development
- Merge conflicts likely

**When to use**: Between releases, during slow periods

### Strategy 3: Create New Structure, Migrate Gradually

**Pattern**: Build new structure alongside old, migrate over time

**Steps**:
1. **Create new directories** - New structure exists alongside old
2. **New files use new structure** - All new code goes in new place
3. **Migrate old files opportunistically** - When touching a file, move it
4. **Set deadline** - "By end of Q2, all files migrated"
5. **Final cleanup** - Remove empty old directories

**Example**:
```
src/
  legacy/          # Old structure (to be removed)
    UserController.ts
    ProductController.ts
  users/           # New structure
    UserService.ts (migrated)
  products/        # New structure
    ProductService.ts (migrated)
```

**Pros**:
- Doesn't block development
- Clear progress (old directories empty out)
- Low risk

**Cons**:
- Mixed structure for a while
- Requires discipline

## Safe Migration Patterns

### Preserving Git History

**Problem**: `git mv` breaks `git blame` and history tracking

**Solution**: Git automatically tracks renames if file content mostly unchanged

**Process**:
```bash
# Move file (Git tracks this)
git mv src/old/file.ts src/new/file.ts

# Update imports (separate commit)
# ... edit files with imports

# Commit move and import updates separately
git add .
git commit -m "refactor: move file.ts to new location"
git commit -m "refactor: update imports for file.ts"
```

**To see history across renames**:
```bash
git log --follow src/new/file.ts
```

### Updating Imports Automatically

**TypeScript/JavaScript**:
- **VS Code**: Rename/move files in IDE, imports update automatically
- **Manual**: Use find-and-replace carefully

**Python**:
- Use IDE refactoring (PyCharm, VS Code)
- Or manual: `rg "from old.path import" -l | xargs sed -i 's/old\.path/new.path/g'`

**Go**:
- Update imports to new package path
- Run `go mod tidy`

### Testing After Reorganization

**Essential tests**:
```bash
# 1. Compilation/linting
npm run build    # or tsc, cargo build, etc.
npm run lint

# 2. Unit tests
npm test

# 3. Integration tests
npm run test:integration

# 4. Type checking
npm run type-check

# 5. Manual smoke test
# Start app, test critical paths
```

**If any fail**: Don't commit. Fix imports or revert.

## When to Split or Merge

### When to Split a Directory

**Indicators**:
- **Too many files** (>20-30 in one directory)
- **Multiple concerns** (mixed responsibilities)
- **Team boundaries** (different teams work on different parts)
- **Growing complexity** (subdirectories would clarify)

**Example**:
```
Before:
src/components/  (50+ components)

After:
src/components/
  ui/            # Reusable UI components
  forms/         # Form components
  layout/        # Layout components
  pages/         # Page-specific components
```

### When to Merge Directories

**Indicators**:
- **Single-file directories** (unnecessary nesting)
- **Rarely changing** (overorganized)
- **Always used together** (artificial separation)

**Example**:
```
Before:
src/
  user-auth/
    auth.ts
  user-profile/
    profile.ts

After:
src/user/
  auth.ts
  profile.ts
```

### Decision Framework

**Ask**:
1. Does this make finding files easier or harder?
2. Will new developers understand the structure?
3. Does this match how the team thinks about the code?
4. Is there a clear place for new files?

**If yes to most**: Good structure
**If no to most**: Reconsider

## Naming Conventions

### Directory Names

**Recommendations**:
- **Lowercase** with hyphens: `user-auth`, `order-processing`
- **Plural for collections**: `components/`, `services/`, `tests/`
- **Singular for single purpose**: `config/`, `lib/`, `util/`
- **Descriptive**: `authentication/` > `auth/` (unless context clear)

**Examples by language/ecosystem**:

**JavaScript/TypeScript**:
```
src/
  components/      (plural, kebab-case)
  user-service/    (kebab-case)
  api-client/      (kebab-case)
```

**Python**:
```
src/
  user_service/    (snake_case)
  api_client/      (snake_case)
  utils/           (snake_case)
```

**Go**:
```
internal/
  userservice/     (lowercase, no separator)
  apiclient/       (lowercase, no separator)
```

**Rust**:
```
src/
  user_service/    (snake_case)
  api_client/      (snake_case)
```

### Avoid These Names

**Too vague**:
- `common/` - common to what?
- `shared/` - shared by whom?
- `misc/` - miscellaneous what?
- `stuff/` - really?

**Better**:
- `user-common/` or `shared/user-models.ts` (specific)
- Split into specific categories

**Exception**: `shared/` OK if well-organized inside:
```
shared/
  types/
  utils/
  constants/
```

## Best Practices Summary

1. **Match your mental model** - Structure should reflect how you think about the code
2. **Stay shallow** - 3-4 levels maximum
3. **Be consistent** - Same pattern throughout
4. **Refactor incrementally** - Small, safe changes
5. **Test after moving** - Ensure nothing breaks
6. **Use meaningful names** - Clear, descriptive directory names
7. **Avoid premature organization** - Start simple, add structure when needed
8. **Document decisions** - Explain structure in README or AGENTS.md

**Red flags**:
- More than 5 levels deep
- Flat directory with >30 files
- Inconsistent naming conventions
- "Utils" has >20 files
- Single-file directories
- No clear organizing principle
