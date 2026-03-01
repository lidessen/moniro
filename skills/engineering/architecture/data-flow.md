# Data Flow Design

Planning how data moves through your system.

## Table of Contents

- [Data Flow Patterns](#data-flow-patterns)
- [State Management](#state-management)
- [Data Consistency](#data-consistency)
- [Data Flow Diagrams](#data-flow-diagrams)

## Data Flow Patterns

### Request-Response

Synchronous, client waits for response.

```
Client ──request──→ Server ──response──→ Client

Timeline:
Client: [request]────────────────[response]
Server:          [process]
```

**Use when**:

- Client needs immediate result
- Operation is fast
- Strong consistency required

### Fire-and-Forget

Async, client doesn't wait.

```
Client ──event──→ Queue ──→ Worker

Timeline:
Client: [emit event][continue work]
Worker:              [process later]
```

**Use when**:

- Client doesn't need result
- Operation can be delayed
- Decoupling desired

### Publish-Subscribe

One publisher, many subscribers.

```
Publisher ──event──→ Message Bus
                         │
              ┌──────────┼──────────┐
              ↓          ↓          ↓
         Subscriber  Subscriber  Subscriber
```

**Use when**:

- Multiple consumers for same event
- Loose coupling between components
- Event-driven architecture

### Request-Reply with Callback

Async request, callback when done.

```
Client ──request──→ Server ──→ processes async
       ←─callback──          ←─ when complete
```

**Use when**:

- Long-running operations
- Client can continue other work
- Need notification on completion

## State Management

### Where to Store State

```
┌─────────────────────────────────────────────────────┐
│                    Client State                      │
│  UI state, form data, navigation, cached data       │
└───────────────────────┬─────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────┐
│                   Session State                      │
│  User auth, preferences, shopping cart              │
└───────────────────────┬─────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────┐
│                  Application State                   │
│  In-memory cache, connection pools, config          │
└───────────────────────┬─────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────┐
│                  Persistent State                    │
│  Database, file storage, external services          │
└─────────────────────────────────────────────────────┘
```

### Unidirectional Data Flow

Data flows in one direction (easier to understand).

```
       ┌───────────────────────────────┐
       ↓                               │
   ┌───────┐    ┌────────┐    ┌───────┴───┐
   │ State │ →  │  View  │ →  │  Action   │
   └───────┘    └────────┘    └───────────┘

State changes → View updates → User acts → State changes
```

**Examples**: Redux, Flux, Elm architecture

### Bidirectional Data Flow

Data flows both directions (simpler but harder to debug).

```
   ┌───────┐    ┌────────┐
   │ Model │ ←→ │  View  │
   └───────┘    └────────┘

Model changes → View updates
View changes → Model updates
```

**Examples**: Two-way binding in Angular, Vue v-model

### Event Sourcing

Store events, not current state. Derive state from events.

```
Events:
1. UserCreated { id: 1, name: "John" }
2. UserEmailChanged { id: 1, email: "john@example.com" }
3. UserNameChanged { id: 1, name: "John Doe" }

Current State (derived):
{ id: 1, name: "John Doe", email: "john@example.com" }
```

**Pros**: Full history, audit trail, time travel
**Cons**: Complexity, storage, eventual consistency

## Data Consistency

### Strong Consistency

All readers see the same data immediately after write.

```
Write → Database → Read
                   ↓
              Sees new data immediately
```

**Achieved by**: Transactions, locks, single source of truth
**Cost**: Latency, availability

### Eventual Consistency

Readers may see stale data temporarily.

```
Write → Primary DB ──replication──→ Replica DB
                   (delay)           ↓
                                  Read (may be stale)
```

**Achieved by**: Async replication, caching
**Benefit**: Performance, availability

### Consistency Patterns

**Read-your-writes**: User sees their own changes

```
After write → Route reads to primary (briefly)
```

**Monotonic reads**: Never see older data after seeing newer

```
Track version → Reject reads from older replicas
```

**Causal consistency**: Related changes appear in order

```
Track dependencies → Apply in causal order
```

## Data Flow Diagrams

### Level 0: Context Diagram

System as black box with external entities.

```
                    ┌─────────────┐
                    │   System    │
      User ─────────┤             ├───────── Payment
                    │             │          Provider
      Admin ────────┤             ├───────── Email
                    └─────────────┘          Service
```

### Level 1: High-Level Flows

Major processes and data stores.

```
┌──────┐     order      ┌─────────────┐
│ User │ ─────────────→ │   Orders    │
└──────┘                │   Service   │
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              ↓                ↓                ↓
       ┌──────────┐    ┌──────────────┐   ┌─────────┐
       │ Inventory│    │   Payment    │   │  Email  │
       │  Service │    │   Service    │   │ Service │
       └──────────┘    └──────────────┘   └─────────┘
```

### Level 2: Detailed Process

Individual process broken down.

```
                    Order Service
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ Validate │ →  │  Check   │ →  │    Create    │  │
│  │  Order   │    │ Inventory│    │    Order     │  │
│  └──────────┘    └──────────┘    └──────────────┘  │
│       ↓               ↓                 ↓          │
│   [Validation    [Inventory        [Order DB]      │
│    Rules]         Service]                         │
└─────────────────────────────────────────────────────┘
```

### Sequence Diagram

Time-ordered interactions.

```
User          API           Service        Database
 │             │               │              │
 │──request───→│               │              │
 │             │──validate────→│              │
 │             │←─────ok───────│              │
 │             │               │──query──────→│
 │             │               │←────data─────│
 │             │←────result────│              │
 │←──response──│               │              │
 │             │               │              │
```

### Tips for Diagramming

1. **Start high-level**: Context → Processes → Details
2. **Show what matters**: Hide irrelevant details
3. **Be consistent**: Same notation throughout
4. **Update or delete**: Outdated diagrams are worse than none
5. **Place near code**: Diagrams in docs/architecture/, not separate wiki
