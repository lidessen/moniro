# Implementation Best Practices

Writing code that is correct, readable, and maintainable.

> **Note**: This is a decision reference, not a tutorial. Use it to quickly recall patterns when reviewing code or making implementation choices. Skip sections you already know well.

## Table of Contents

- [Code Clarity](#code-clarity)
- [Error Handling](#error-handling)
- [Testing Practices](#testing-practices)
- [Code Organization](#code-organization)
- [Common Pitfalls](#common-pitfalls)

## Code Clarity

### Naming

**Variables**: What it holds
```python
# Bad
d = get_data()
x = d[0]

# Good
users = get_active_users()
first_user = users[0]
```

**Functions**: What it does (verb + noun)
```python
# Bad
def data(): ...
def process(): ...

# Good
def fetch_user_data(): ...
def validate_order(): ...
```

**Booleans**: Question form
```python
# Bad
active = True
login = False

# Good
is_active = True
has_logged_in = False
can_edit = True
```

### Function Design

**Single responsibility**: One function, one job
```python
# Bad: Does too much
def process_order(order):
    validate(order)
    calculate_tax(order)
    charge_payment(order)
    send_email(order)
    update_inventory(order)

# Good: Orchestrates single-purpose functions
def process_order(order):
    validated_order = validate_order(order)
    order_with_tax = calculate_tax(validated_order)
    charge_payment(order_with_tax)
    send_confirmation_email(order_with_tax)
    update_inventory(order_with_tax)
```

**Small functions**: If it needs a comment explaining what a block does, extract it
```python
# Before
def process():
    # Validate input
    if not data:
        raise ValueError()
    if len(data) > 100:
        raise ValueError()

    # Transform data
    result = []
    for item in data:
        result.append(transform(item))

    return result

# After
def process():
    validate_input(data)
    return transform_all(data)
```

**Pure functions when possible**: Same input → same output, no side effects
```python
# Impure (harder to test, understand)
total = 0
def add_to_total(x):
    global total
    total += x

# Pure (easier to test, understand)
def add(a, b):
    return a + b
```

### Comments

**Comment why, not what**:
```python
# Bad: explains what (obvious from code)
# Increment counter by 1
counter += 1

# Good: explains why (not obvious)
# Reset after 3 failures to prevent lockout
counter = 0
```

**Better than comments: clear code**:
```python
# Instead of comment
# Check if user can edit
if user.role == 'admin' or user.id == resource.owner_id:

# Use well-named function
if user.can_edit(resource):
```

## Error Handling

### Fail Fast

Detect and report errors as early as possible.

```python
# Bad: Error appears later, far from cause
def process_user(user_id):
    user = get_user(user_id)  # Returns None if not found
    # ... 50 lines of code ...
    send_email(user.email)  # NoneType has no attribute 'email'

# Good: Fail immediately
def process_user(user_id):
    user = get_user(user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    # ... rest of code ...
```

### Specific Exceptions

Catch specific errors, not everything.

```python
# Bad: Catches everything, hides bugs
try:
    process(data)
except Exception:
    log("Something went wrong")

# Good: Catches expected errors specifically
try:
    process(data)
except ValidationError as e:
    log(f"Invalid data: {e}")
except NetworkError as e:
    log(f"Network issue: {e}")
    retry_later()
```

### Error Messages

Include context for debugging.

```python
# Bad: No context
raise ValueError("Invalid value")

# Good: Includes context
raise ValueError(f"Invalid age: {age}. Must be between 0 and 150")
```

### Don't Swallow Errors

```python
# Bad: Error disappears silently
try:
    important_operation()
except:
    pass

# Good: At minimum, log it
try:
    important_operation()
except OperationError as e:
    logger.error(f"Operation failed: {e}")
    raise  # or handle appropriately
```

## Testing Practices

### Test Structure: Arrange-Act-Assert

```python
def test_user_can_be_created():
    # Arrange: Set up test data
    user_data = {"name": "John", "email": "john@example.com"}

    # Act: Execute the code under test
    user = create_user(user_data)

    # Assert: Verify the result
    assert user.name == "John"
    assert user.email == "john@example.com"
```

### What to Test

**Test behavior, not implementation**:
```python
# Bad: Tests implementation detail
def test_user_service_calls_repository():
    mock_repo = Mock()
    service = UserService(mock_repo)
    service.get_user(1)
    mock_repo.find_by_id.assert_called_once_with(1)

# Good: Tests behavior
def test_get_user_returns_user():
    service = UserService(repo)
    user = service.get_user(1)
    assert user.id == 1
```

**Test edge cases**:
```python
def test_divide():
    assert divide(10, 2) == 5      # Normal case
    assert divide(0, 5) == 0        # Zero numerator
    with pytest.raises(ZeroDivisionError):
        divide(10, 0)               # Zero denominator
```

### Test Naming

Describe the scenario and expected outcome.

```python
# Bad: Vague
def test_user():
def test_it_works():

# Good: Descriptive
def test_create_user_with_valid_data_returns_user():
def test_create_user_with_invalid_email_raises_error():
def test_delete_user_removes_from_database():
```

### Test Independence

Each test should run independently.

```python
# Bad: Tests depend on each other
def test_create_user():
    user = create_user(data)
    # Stores in module variable for next test

def test_get_user():
    user = get_user(created_user.id)  # Depends on previous test

# Good: Each test is independent
def test_create_user():
    user = create_user(data)
    assert user.id is not None

def test_get_user():
    created = create_user(data)  # Create fresh data
    user = get_user(created.id)
    assert user.name == created.name
```

## Code Organization

### File Size

**Guideline**: Files over 500 lines often need splitting.

**Split by**:
- Separate classes into own files
- Group related functions
- Extract utilities

### Import Organization

```python
# Standard library
import os
import sys
from datetime import datetime

# Third-party packages
import requests
from sqlalchemy import Column

# Local modules
from .models import User
from .utils import validate
```

### Module Structure

```
module/
├── __init__.py      # Public exports
├── models.py        # Data structures
├── service.py       # Business logic
├── repository.py    # Data access
├── exceptions.py    # Custom exceptions
└── utils.py         # Helpers
```

### Dependency Direction

```
High-level (business logic)
         ↓
Low-level (utilities, data access)

# service.py imports from repository.py
# repository.py does NOT import from service.py
```

## Common Pitfalls

### Premature Abstraction

```python
# Bad: Abstraction for single use case
class AbstractUserProcessor:
    def process(self, user): pass

class ConcreteUserProcessor(AbstractUserProcessor):
    def process(self, user):
        return user.name.upper()

# Good: Just write the function
def format_user_name(user):
    return user.name.upper()
```

**Rule of Three**: Abstract when you have 3+ similar cases, not before.

### Stringly Typed

```python
# Bad: String for everything
def set_status(status: str):
    if status == "active": ...
    elif status == "inactive": ...
    # Typo "actve" won't be caught

# Good: Use enum or constants
class Status(Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"

def set_status(status: Status):
    if status == Status.ACTIVE: ...
```

### Magic Numbers

```python
# Bad: What does 86400 mean?
if elapsed > 86400:
    expire_session()

# Good: Named constant
SECONDS_PER_DAY = 86400
if elapsed > SECONDS_PER_DAY:
    expire_session()
```

### Deep Nesting

```python
# Bad: Hard to follow
def process(data):
    if data:
        if data.valid:
            if data.user:
                if data.user.active:
                    return do_work(data)
    return None

# Good: Early returns
def process(data):
    if not data:
        return None
    if not data.valid:
        return None
    if not data.user:
        return None
    if not data.user.active:
        return None
    return do_work(data)
```

### God Objects

```python
# Bad: One class does everything
class Application:
    def handle_request(self): ...
    def validate_user(self): ...
    def query_database(self): ...
    def send_email(self): ...
    def generate_report(self): ...
    def cache_data(self): ...

# Good: Separate concerns
class RequestHandler: ...
class UserValidator: ...
class UserRepository: ...
class EmailService: ...
class ReportGenerator: ...
class CacheService: ...
```
