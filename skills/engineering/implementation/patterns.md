# Design Patterns

Common solutions to recurring design problems.

## Table of Contents

- [Creational Patterns](#creational-patterns)
- [Structural Patterns](#structural-patterns)
- [Behavioral Patterns](#behavioral-patterns)
- [When to Use Patterns](#when-to-use-patterns)

## Creational Patterns

### Factory

Create objects without specifying exact class.

```python
# Problem: Client code knows too much about creation
if type == "csv":
    parser = CsvParser(config, options)
elif type == "json":
    parser = JsonParser(config, options)
elif type == "xml":
    parser = XmlParser(config, options)

# Solution: Factory hides creation details
class ParserFactory:
    @staticmethod
    def create(type: str) -> Parser:
        parsers = {
            "csv": CsvParser,
            "json": JsonParser,
            "xml": XmlParser,
        }
        return parsers[type](config, options)

# Usage
parser = ParserFactory.create("csv")
```

**Use when**: Object creation logic is complex or varies.

### Builder

Construct complex objects step by step.

```python
# Problem: Constructor with many parameters
user = User(
    name="John",
    email="john@example.com",
    age=30,
    address="123 Main St",
    phone="555-1234",
    role="admin",
    active=True,
    verified=False,
)

# Solution: Builder with fluent interface
user = (
    UserBuilder()
    .name("John")
    .email("john@example.com")
    .age(30)
    .address("123 Main St")
    .role("admin")
    .build()
)
```

**Use when**: Object has many optional parameters or complex construction.

### Singleton

Ensure only one instance exists.

```python
# Python: Module-level instance
# config.py
class Config:
    def __init__(self):
        self.settings = load_settings()

config = Config()  # Single instance

# Usage
from config import config
print(config.settings)
```

**Use sparingly**: Often overused. Consider dependency injection instead.

## Structural Patterns

### Adapter

Make incompatible interfaces work together.

```python
# Problem: Third-party library has different interface
class ThirdPartyLogger:
    def write_log(self, level, msg):
        ...

# Your code expects
class Logger:
    def info(self, msg): ...
    def error(self, msg): ...

# Solution: Adapter wraps third-party
class LoggerAdapter(Logger):
    def __init__(self, third_party: ThirdPartyLogger):
        self.logger = third_party

    def info(self, msg):
        self.logger.write_log("INFO", msg)

    def error(self, msg):
        self.logger.write_log("ERROR", msg)
```

**Use when**: Integrating external code with different interface.

### Decorator

Add behavior to objects dynamically.

```python
# Problem: Need to add features without modifying class
class DataSource:
    def read(self) -> str: ...

# Solution: Decorators wrap and add behavior
class EncryptedDataSource(DataSource):
    def __init__(self, wrapped: DataSource):
        self.wrapped = wrapped

    def read(self) -> str:
        return decrypt(self.wrapped.read())

class CompressedDataSource(DataSource):
    def __init__(self, wrapped: DataSource):
        self.wrapped = wrapped

    def read(self) -> str:
        return decompress(self.wrapped.read())

# Usage: Stack decorators
source = CompressedDataSource(
    EncryptedDataSource(
        FileDataSource("data.txt")
    )
)
data = source.read()  # Reads, decrypts, decompresses
```

**Use when**: Need to add responsibilities dynamically.

### Facade

Provide simple interface to complex subsystem.

```python
# Problem: Client must coordinate multiple objects
order = Order()
inventory = Inventory()
payment = Payment()
shipping = Shipping()

inventory.reserve(items)
payment.charge(user, total)
order.create(user, items)
shipping.schedule(order)

# Solution: Facade hides complexity
class OrderFacade:
    def __init__(self):
        self.order = Order()
        self.inventory = Inventory()
        self.payment = Payment()
        self.shipping = Shipping()

    def place_order(self, user, items):
        self.inventory.reserve(items)
        self.payment.charge(user, self.calculate_total(items))
        order = self.order.create(user, items)
        self.shipping.schedule(order)
        return order

# Usage
facade = OrderFacade()
order = facade.place_order(user, items)
```

**Use when**: Simplifying interaction with complex subsystem.

## Behavioral Patterns

### Strategy

Define family of algorithms, make them interchangeable.

```python
# Problem: Conditionals for different algorithms
def calculate_shipping(order, method):
    if method == "standard":
        return 5.0
    elif method == "express":
        return 15.0
    elif method == "overnight":
        return 25.0

# Solution: Strategy interface
class ShippingStrategy:
    def calculate(self, order) -> float: ...

class StandardShipping(ShippingStrategy):
    def calculate(self, order) -> float:
        return 5.0

class ExpressShipping(ShippingStrategy):
    def calculate(self, order) -> float:
        return 15.0

# Usage
class Order:
    def __init__(self, shipping: ShippingStrategy):
        self.shipping = shipping

    def get_shipping_cost(self):
        return self.shipping.calculate(self)

order = Order(ExpressShipping())
cost = order.get_shipping_cost()
```

**Use when**: Need to switch algorithms at runtime.

### Observer

Notify objects when state changes.

```python
# Problem: Objects need to react to changes
class Order:
    def complete(self):
        self.status = "completed"
        # Now need to notify inventory, email, analytics...

# Solution: Observer pattern
class Order:
    def __init__(self):
        self.observers = []

    def add_observer(self, observer):
        self.observers.append(observer)

    def complete(self):
        self.status = "completed"
        for observer in self.observers:
            observer.on_order_completed(self)

# Observers
class InventoryObserver:
    def on_order_completed(self, order):
        update_inventory(order.items)

class EmailObserver:
    def on_order_completed(self, order):
        send_confirmation(order.user)

# Usage
order = Order()
order.add_observer(InventoryObserver())
order.add_observer(EmailObserver())
order.complete()  # All observers notified
```

**Use when**: Objects need to react to events in other objects.

### Repository

Abstract data access logic.

```python
# Problem: Data access scattered throughout code
def get_user(id):
    return db.query("SELECT * FROM users WHERE id = ?", id)

def get_active_users():
    return db.query("SELECT * FROM users WHERE active = true")

# Solution: Repository encapsulates data access
class UserRepository:
    def __init__(self, db):
        self.db = db

    def find_by_id(self, id) -> User:
        row = self.db.query("SELECT * FROM users WHERE id = ?", id)
        return User(**row)

    def find_active(self) -> list[User]:
        rows = self.db.query("SELECT * FROM users WHERE active = true")
        return [User(**row) for row in rows]

    def save(self, user: User):
        self.db.execute("INSERT INTO users ...", user)

# Usage
repo = UserRepository(db)
user = repo.find_by_id(1)
active_users = repo.find_active()
```

**Use when**: Want to separate data access from business logic.

### Command

Encapsulate request as object.

```python
# Problem: Hard to undo, queue, or log operations
def delete_user(user_id):
    db.delete(user_id)  # Can't undo

# Solution: Command objects
class DeleteUserCommand:
    def __init__(self, user_id, db):
        self.user_id = user_id
        self.db = db
        self.backup = None

    def execute(self):
        self.backup = self.db.find(self.user_id)
        self.db.delete(self.user_id)

    def undo(self):
        if self.backup:
            self.db.insert(self.backup)

# Usage with command history
class CommandHistory:
    def __init__(self):
        self.history = []

    def execute(self, command):
        command.execute()
        self.history.append(command)

    def undo(self):
        if self.history:
            command = self.history.pop()
            command.undo()
```

**Use when**: Need undo, queuing, or logging of operations.

## When to Use Patterns

### Don't Force Patterns

```
Wrong mindset:
"I need to use Factory, Strategy, and Observer here"

Right mindset:
"I have a problem. Does a known pattern solve it?"
```

### Pattern Smells

Signs you might need a pattern:

| Smell | Consider |
|-------|----------|
| Long switch/if-else on type | Strategy, Factory |
| Duplicate code with variations | Template Method, Strategy |
| Complex object construction | Builder, Factory |
| Need to notify multiple objects | Observer |
| Data access mixed with logic | Repository |
| Hard to test due to dependencies | Dependency Injection |

### Pattern Costs

Every pattern has cost:
- **Indirection**: More classes, harder to follow
- **Complexity**: Must understand pattern to read code
- **Overhead**: Sometimes slower

**Rule**: Use pattern when benefit > cost.

### Simpler Alternatives

Before reaching for a pattern:

```python
# Instead of Strategy pattern for simple case
class ShippingCalculator:
    strategies = {
        "standard": lambda o: 5.0,
        "express": lambda o: 15.0,
    }

    def calculate(self, order, method):
        return self.strategies[method](order)

# Instead of Factory for simple case
def create_parser(type):
    return {"csv": CsvParser, "json": JsonParser}[type]()
```

Patterns are tools. Simple code is usually better than pattern-heavy code.
