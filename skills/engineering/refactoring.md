# Refactoring

Improving code structure without changing behavior.

## Table of Contents

- [When to Refactor](#when-to-refactor)
- [Refactoring Strategies](#refactoring-strategies)
- [Common Refactorings](#common-refactorings)
- [Safe Refactoring Process](#safe-refactoring-process)
- [Refactoring Patterns](#refactoring-patterns)

## When to Refactor

### Good Times to Refactor

**Before adding features**:
> "Make the change easy, then make the easy change." — Kent Beck

If code structure makes the new feature awkward, refactor first.

**When understanding is hard**:
- You read code multiple times to understand it
- Comments explain "what" not "why"
- Function does multiple unrelated things

**When patterns emerge**:
- Third time you see similar code
- Abstraction becomes obvious

**When tests are hard to write**:
- Indicates code has too many responsibilities
- Refactor to make testable

### Bad Times to Refactor

**Code that works and won't change**:
- Don't improve what doesn't need improving
- Leave stable, tested code alone

**Without tests**:
- No safety net for behavior preservation
- Write tests first, then refactor

**Under deadline pressure**:
- Unless the refactoring unblocks the work
- Note for later, don't do now

**"While I'm here" syndrome**:
- Scope creep disguised as improvement
- Stay focused on current task

## Refactoring Strategies

### Strangler Fig Pattern

Gradually replace old system with new, piece by piece.

```
┌─────────────────────────────┐
│         Old System          │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│ ┌─────────┐                 │
│ │   New   │  Old System     │
│ └─────────┘                 │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│ ┌─────────────────────┐     │
│ │        New          │ Old │
│ └─────────────────────┘     │
└─────────────────────────────┘
              ↓
┌─────────────────────────────┐
│           New System        │
└─────────────────────────────┘
```

**Use when**:
- Large legacy system
- Can't stop feature development
- Need incremental progress

**Process**:
1. Identify boundary to replace
2. Create new implementation behind same interface
3. Route traffic to new implementation
4. Verify behavior matches
5. Remove old code
6. Repeat

### Branch by Abstraction

Introduce abstraction layer, swap implementation underneath.

```
Before:
  Code ──→ Old Implementation

Step 1: Add abstraction
  Code ──→ Abstraction ──→ Old Implementation

Step 2: Add new implementation
  Code ──→ Abstraction ──→ Old Implementation
                      └──→ New Implementation (not used yet)

Step 3: Switch
  Code ──→ Abstraction ──→ New Implementation
                      └──→ Old Implementation (not used)

Step 4: Clean up
  Code ──→ Abstraction ──→ New Implementation
```

**Use when**:
- Need to replace implementation
- Can't do big bang switch
- Want to test new implementation in parallel

### Parallel Change (Expand-Contract)

Run old and new code simultaneously, verify, then remove old.

**Expand**: Add new code alongside old
**Migrate**: Move consumers to new code
**Contract**: Remove old code

**Use when**:
- API changes needed
- Multiple consumers need migration time
- Need to verify equivalence

## Common Refactorings

### Extract Function

**Before**:
```python
def process_order(order):
    # Validate order
    if not order.items:
        raise ValueError("Empty order")
    if order.total < 0:
        raise ValueError("Invalid total")

    # Calculate discount
    discount = 0
    if order.total > 100:
        discount = order.total * 0.1

    # Process payment
    payment_result = payment_gateway.charge(order.total - discount)
    # ...
```

**After**:
```python
def process_order(order):
    validate_order(order)
    discount = calculate_discount(order)
    payment_result = process_payment(order.total - discount)
    # ...

def validate_order(order):
    if not order.items:
        raise ValueError("Empty order")
    if order.total < 0:
        raise ValueError("Invalid total")

def calculate_discount(order):
    if order.total > 100:
        return order.total * 0.1
    return 0

def process_payment(amount):
    return payment_gateway.charge(amount)
```

### Replace Conditional with Polymorphism

**Before**:
```python
def calculate_shipping(order):
    if order.shipping_type == "standard":
        return 5.0
    elif order.shipping_type == "express":
        return 15.0
    elif order.shipping_type == "overnight":
        return 25.0
```

**After**:
```python
class ShippingStrategy:
    def calculate(self, order): pass

class StandardShipping(ShippingStrategy):
    def calculate(self, order): return 5.0

class ExpressShipping(ShippingStrategy):
    def calculate(self, order): return 15.0

class OvernightShipping(ShippingStrategy):
    def calculate(self, order): return 25.0
```

### Introduce Parameter Object

**Before**:
```python
def create_report(start_date, end_date, department, format, include_charts):
    # ...
```

**After**:
```python
@dataclass
class ReportConfig:
    start_date: date
    end_date: date
    department: str
    format: str = "pdf"
    include_charts: bool = True

def create_report(config: ReportConfig):
    # ...
```

### Replace Magic Numbers/Strings with Constants

**Before**:
```python
if user.age >= 18:
    # ...
if status == "pending_review":
    # ...
```

**After**:
```python
LEGAL_AGE = 18
STATUS_PENDING_REVIEW = "pending_review"

if user.age >= LEGAL_AGE:
    # ...
if status == STATUS_PENDING_REVIEW:
    # ...
```

## Safe Refactoring Process

### The Refactoring Loop

```
1. Ensure tests pass
2. Make one small change
3. Run tests
4. If tests pass: commit
5. If tests fail: revert and try smaller change
6. Repeat
```

### Commit Discipline

**Each commit should**:
- Be a single, coherent change
- Leave code in working state
- Have clear commit message

**Example commit sequence**:
```
"Extract validate_order function"
"Extract calculate_discount function"
"Extract process_payment function"
"Rename process_order to handle_order_submission"
```

### Testing Requirements

**Before refactoring, ensure**:
- Tests cover behavior you're changing
- Tests are passing
- Tests are trustworthy (not flaky)

**If tests don't exist**:
1. Write characterization tests (test current behavior, even if bugs)
2. Then refactor
3. Then fix bugs (separately)

## Refactoring Patterns

### Large Class → Smaller Classes

**Signals**:
- Class has many methods
- Methods cluster into groups
- Some methods don't use all instance variables

**Approach**:
1. Identify method clusters
2. Extract class for each cluster
3. Original class delegates to new classes

### Long Method → Shorter Methods

**Signals**:
- Method longer than a screen
- Multiple levels of abstraction
- Comments separating sections

**Approach**:
1. Identify logical sections
2. Extract each section to named method
3. Method name replaces comment

### Feature Envy → Move Method

**Signals**:
- Method uses more data from another class than its own
- Chain of getters: `order.customer.address.city`

**Approach**:
1. Move method to class whose data it uses most
2. Pass minimal required data as parameters

### Primitive Obsession → Value Objects

**Signals**:
- Same primitives grouped together repeatedly
- Validation logic scattered for same concept
- Comments explaining what primitive means

**Approach**:
1. Create class for the concept
2. Move validation into class
3. Replace primitives with value object

**Example**:
```python
# Before: email as string everywhere
def send_email(to: str, subject: str): ...
def validate_email(email: str): ...

# After: Email value object
class Email:
    def __init__(self, value: str):
        if not self._is_valid(value):
            raise ValueError(f"Invalid email: {value}")
        self.value = value

    @staticmethod
    def _is_valid(value: str) -> bool:
        return "@" in value and "." in value

def send_email(to: Email, subject: str): ...
```
