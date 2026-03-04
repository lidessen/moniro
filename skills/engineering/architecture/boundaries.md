# Module Boundaries

Defining clear boundaries between components.

## Table of Contents

- [Why Boundaries Matter](#why-boundaries-matter)
- [Identifying Boundaries](#identifying-boundaries)
- [Interface Design](#interface-design)
- [Dependency Rules](#dependency-rules)
- [Boundary Enforcement](#boundary-enforcement)

## Why Boundaries Matter

Good boundaries enable:

- **Independent development**: Teams work without blocking each other
- **Testability**: Modules can be tested in isolation
- **Changeability**: Changes in one module don't ripple everywhere
- **Understanding**: Clear ownership and responsibility

Bad boundaries cause:

- **Coupling**: Changes require coordinated updates
- **Circular dependencies**: A depends on B depends on A
- **God modules**: One module does everything
- **Leaky abstractions**: Internal details exposed

## Identifying Boundaries

### Domain-Driven Design Approach

Look for **bounded contexts** — areas where terms have consistent meaning.

```
E-commerce example:

┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Catalog   │  │  Ordering   │  │  Shipping   │
│             │  │             │  │             │
│ - Product   │  │ - Order     │  │ - Shipment  │
│ - Category  │  │ - LineItem  │  │ - Address   │
│ - Price     │  │ - Customer  │  │ - Tracking  │
└─────────────┘  └─────────────┘  └─────────────┘

"Product" means different things:
- Catalog: description, images, attributes
- Ordering: SKU, price at time of order
- Shipping: weight, dimensions
```

### Conway's Law

> "Organizations design systems that mirror their communication structures."

Use this intentionally:

- Team boundaries → module boundaries
- If teams must coordinate → modules should have clear interface

### Change Frequency

Group things that change together.

```
Changes together → Same module:
- User profile fields
- User profile validation
- User profile API

Changes independently → Separate modules:
- User authentication
- User preferences
- User billing
```

### Dependency Analysis

Look for clusters in dependency graph.

```
Tightly coupled (same module?):
A ↔ B ↔ C

Loosely coupled (different modules):
[A ↔ B ↔ C] ←interface→ [D ↔ E]
```

## Interface Design

### Public vs. Internal

Every module has:

- **Public interface**: What other modules can use
- **Internal implementation**: Hidden from other modules

```typescript
// module/index.ts (public interface)
export { UserService } from './user.service';
export { User } from './user.model';
export type { CreateUserDto } from './dto';

// module/user.repository.ts (internal)
// NOT exported from index.ts
class UserRepository { ... }
```

### Interface Principles

**Minimal**: Expose only what's needed

```typescript
// Too much
export class UserService {
  findAll(): User[];
  findById(id): User;
  findByEmail(email): User;
  findByPhone(phone): User;
  findByName(name): User;
  // ... 20 more methods
}

// Better: expose query interface
export class UserService {
  find(query: UserQuery): User[];
  findById(id): User;
}
```

**Stable**: Interface changes less than implementation

```typescript
// Unstable: exposes database details
findUsers(sqlWhere: string): User[]

// Stable: hides database
findUsers(filters: UserFilters): User[]
```

**Intention-revealing**: Names describe what, not how

```typescript
// How (exposes implementation)
getUserFromCache(id): User
getUserFromDatabase(id): User

// What (hides implementation)
getUser(id): User  // internally decides cache vs. db
```

## Dependency Rules

### Allowed Dependencies

```
┌─────────────────────────────────────────┐
│                 UI Layer                 │
│  (Can depend on: Business, Shared)      │
└─────────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────┐
│             Business Layer              │
│  (Can depend on: Data, Shared)         │
└─────────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────┐
│              Data Layer                 │
│  (Can depend on: Shared only)          │
└─────────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────┐
│           Shared/Common                 │
│  (Can depend on: nothing internal)     │
└─────────────────────────────────────────┘
```

### Forbidden Dependencies

**Circular dependencies**:

```
A → B → C → A  ❌

Fix: Extract common dependency
A → D
B → D
C → D
```

**Skip-layer dependencies**:

```
UI → Database  ❌

Fix: Go through business layer
UI → Business → Database
```

**Upward dependencies**:

```
Data → Business  ❌
(lower depending on higher)

Fix: Invert with interface
Business defines interface
Data implements interface
```

### Dependency Inversion

When lower layer needs higher layer logic:

```typescript
// Bad: Data layer depends on Business layer
// data/user.repository.ts
import { UserValidator } from '../business/user.validator';

// Good: Business layer defines interface
// business/interfaces.ts
interface ValidationRule {
  validate(data: unknown): boolean;
}

// business/user.validator.ts
class UserValidator implements ValidationRule { ... }

// data/user.repository.ts
class UserRepository {
  constructor(private validator: ValidationRule) { }
}
```

## Boundary Enforcement

### Directory Structure

```
src/
├── modules/
│   ├── users/
│   │   ├── index.ts      # Public exports only
│   │   ├── user.service.ts
│   │   ├── user.repository.ts  # Internal
│   │   └── user.model.ts
│   ├── orders/
│   │   ├── index.ts
│   │   └── ...
│   └── shared/
│       ├── index.ts
│       └── ...
└── ...
```

**Rule**: Only import from `index.ts` of other modules.

### Lint Rules

ESLint boundaries plugin:

```javascript
// .eslintrc.js
rules: {
  'boundaries/element-types': [2, {
    default: 'disallow',
    rules: [
      { from: 'ui', allow: ['business', 'shared'] },
      { from: 'business', allow: ['data', 'shared'] },
      { from: 'data', allow: ['shared'] },
    ]
  }]
}
```

### Package/Workspace Boundaries

For stronger enforcement, use separate packages:

```
packages/
├── ui/
│   └── package.json  # depends on: business, shared
├── business/
│   └── package.json  # depends on: data, shared
├── data/
│   └── package.json  # depends on: shared
└── shared/
    └── package.json  # no internal dependencies
```

Package manager enforces boundaries.

### Architecture Tests

Test that boundaries are respected:

```typescript
// architecture.test.ts
import { FileAnalyzer } from "arch-unit";

test("data layer does not import from business", () => {
  const files = FileAnalyzer.analyze("src/data/**/*.ts");

  files.forEach((file) => {
    expect(file.imports).not.toContainMatch(/src\/business/);
  });
});
```
