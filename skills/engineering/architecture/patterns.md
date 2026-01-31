# Architecture Patterns

Common patterns for structuring systems.

## Table of Contents

- [Layered Architecture](#layered-architecture)
- [Hexagonal Architecture](#hexagonal-architecture)
- [Event-Driven Architecture](#event-driven-architecture)
- [Microservices](#microservices)
- [Choosing Patterns](#choosing-patterns)

## Layered Architecture

The classic approach: separate concerns into horizontal layers.

```
┌─────────────────────────────────┐
│       Presentation Layer        │  ← UI, API endpoints
├─────────────────────────────────┤
│        Business Layer           │  ← Domain logic, rules
├─────────────────────────────────┤
│       Persistence Layer         │  ← Data access
├─────────────────────────────────┤
│        Database Layer           │  ← Storage
└─────────────────────────────────┘
```

**Rules**:
- Each layer only depends on layer below
- No skipping layers
- Changes in one layer don't affect others

**Example structure**:
```
src/
├── api/           # Presentation
│   ├── routes/
│   └── middleware/
├── services/      # Business
│   ├── user.service.ts
│   └── order.service.ts
├── repositories/  # Persistence
│   ├── user.repository.ts
│   └── order.repository.ts
└── models/        # Shared entities
    ├── user.ts
    └── order.ts
```

**Pros**: Simple, well-understood, good for CRUD apps
**Cons**: Can become coupled, business logic leaks into layers

## Hexagonal Architecture

(Ports and Adapters)

Business logic at center, external concerns at edges.

```
                  ┌─────────────┐
                  │   REST API  │
                  │  (Adapter)  │
                  └──────┬──────┘
                         │
       ┌─────────┐  ┌────┴────┐  ┌─────────┐
       │  CLI    │──│  Port   │──│  Queue  │
       │(Adapter)│  │         │  │(Adapter)│
       └─────────┘  └────┬────┘  └─────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              │   Business Logic    │
              │      (Core)         │
              │                     │
              └──────────┬──────────┘
                         │
       ┌─────────┐  ┌────┴────┐  ┌─────────┐
       │Postgres │──│  Port   │──│  Redis  │
       │(Adapter)│  │         │  │(Adapter)│
       └─────────┘  └─────────┘  └─────────┘
```

**Key concepts**:
- **Core**: Business logic, no framework dependencies
- **Port**: Interface defined by core (what it needs)
- **Adapter**: Implementation of port (how it's provided)

**Example**:
```typescript
// Port (interface defined by core)
interface UserRepository {
  findById(id: string): Promise<User>;
  save(user: User): Promise<void>;
}

// Adapter (implementation)
class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<User> {
    // PostgreSQL-specific code
  }
}

// Core (depends only on port)
class UserService {
  constructor(private repo: UserRepository) {}

  async getUser(id: string): Promise<User> {
    return this.repo.findById(id);
  }
}
```

**Pros**: Testable, framework-independent core, swappable adapters
**Cons**: More boilerplate, learning curve

## Event-Driven Architecture

Components communicate through events.

```
┌──────────┐    Event     ┌──────────┐
│ Service A│ ─────────→   │Event Bus │
└──────────┘              └────┬─────┘
                               │
              ┌────────────────┼────────────────┐
              ↓                ↓                ↓
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ Service B│    │ Service C│    │ Service D│
        └──────────┘    └──────────┘    └──────────┘
```

**Event types**:
- **Event notification**: Something happened (fire and forget)
- **Event-carried state transfer**: Event contains data
- **Event sourcing**: Events are the source of truth

**Example flow**:
```
Order placed:
1. OrderService emits "OrderCreated" event
2. InventoryService subscribes, reserves stock
3. EmailService subscribes, sends confirmation
4. AnalyticsService subscribes, records metric
```

**Pros**: Loose coupling, scalable, resilient
**Cons**: Eventual consistency, debugging complexity, ordering challenges

## Microservices

System as collection of independently deployable services.

```
┌─────────┐    ┌─────────┐    ┌─────────┐
│  User   │    │  Order  │    │ Payment │
│ Service │    │ Service │    │ Service │
└────┬────┘    └────┬────┘    └────┬────┘
     │              │              │
     └──────────────┴──────────────┘
                    │
            ┌───────┴───────┐
            │   API Gateway │
            └───────────────┘
```

**Characteristics**:
- Each service owns its data
- Services communicate via API/messages
- Independent deployment
- Team ownership per service

**When to use**:
- Large team (>10 developers)
- Clear domain boundaries
- Different scaling needs per component
- Polyglot requirements

**When NOT to use**:
- Small team
- Unclear boundaries
- Limited operational expertise
- Simple domain

### Microservices Patterns

**API Gateway**: Single entry point, routing, auth
**Service mesh**: Infrastructure layer for service communication
**Circuit breaker**: Prevent cascade failures
**Saga**: Distributed transactions across services

## Choosing Patterns

### Decision Matrix

| Factor | Layered | Hexagonal | Event-Driven | Microservices |
|--------|---------|-----------|--------------|---------------|
| Team size | Small | Small-Med | Medium | Large |
| Complexity | Low | Medium | High | High |
| Testability | Medium | High | Medium | High |
| Scalability | Limited | Medium | High | High |
| Learning curve | Low | Medium | High | High |

### Start Simple

```
Phase 1: Monolith (Layered)
         ↓ when it hurts
Phase 2: Modular Monolith (Hexagonal)
         ↓ when boundaries clear
Phase 3: Extract Services (Microservices where needed)
```

### Hybrid Approaches

Real systems often combine patterns:

```
┌───────────────────────────────────────┐
│           API Gateway                 │
└───────────────┬───────────────────────┘
                │
    ┌───────────┼───────────┐
    ↓           ↓           ↓
┌───────┐  ┌────────┐  ┌─────────┐
│ Users │  │ Orders │  │Payments │
│(Layered)│ │(Hexag.)│ │(Microservice)
└───────┘  └────┬───┘  └─────────┘
                │
           Event Bus
                │
        ┌───────┴───────┐
        ↓               ↓
   ┌─────────┐    ┌──────────┐
   │Analytics│    │Notification│
   │(Event)  │    │  (Event)   │
   └─────────┘    └──────────┘
```
