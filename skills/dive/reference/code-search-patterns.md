# Code Search Patterns Reference

Strategic approaches for navigating codebases to find implementation details.

## Search Strategy by Question Type

### "How does feature X work?"

**Search sequence**:
1. Find entry point (routes, handlers, main)
2. Trace to business logic (services, controllers)
3. Follow to data layer (models, repositories)
4. Check tests for behavior validation

**Key files to search**:
- API routes/endpoints
- Controllers/handlers
- Service layer implementations
- Data models and schemas
- Test files

### "Where is X implemented?"

**Search sequence**:
1. Search for type definitions first
2. Find function/class definitions
3. Locate usage/imports
4. Check tests for examples

**Patterns**:
- Type definitions reveal structure
- Tests reveal usage patterns
- Imports map dependencies

### "What causes error Y?"

**Search sequence**:
1. Find error definition (class/constant)
2. Find where error is thrown
3. Trace to calling code
4. Check tests for error cases

### "Why is X designed this way?"

**Search sequence**:
1. Check design docs and ADRs
2. Review git history for rationale
3. Examine related code patterns
4. Look for comments explaining decisions

## Tracing Code Flow

### Entry Point → Implementation

**For web apps**:
```
Route → Controller → Service → Repository → Database
```

**Search approach**:
1. Find route definition
2. Extract handler name
3. Search for handler implementation
4. Follow service calls
5. Trace to data access

### Reverse Tracing (Implementation → Usage)

**When you have**: Function definition
**Find**: Where it's called

**Search approach**:
1. Note function name
2. Search for imports of the module
3. Search for function calls (excluding definition)
4. Analyze calling contexts

## Finding Patterns

### Common Entry Points

**Web frameworks**:
- Routes/endpoints definitions
- Main application file
- Server initialization

**CLIs**:
- Main function
- Command definitions
- Argument parsers

**Libraries**:
- Exported functions/classes
- Public API surface
- Index files

### Configuration Discovery

**What to search**:
1. Config files (*.config.*, config/)
2. Environment variables (process.env, getenv)
3. Constants files
4. Settings modules
5. .env.example for variable names

**Purpose**: Understand configurable behavior, defaults, and requirements.

### Dependency Mapping

**Find what component depends on**:
1. Check imports at file top
2. Review package.json/requirements.txt
3. Look for dependency injection

**Find what depends on component**:
1. Search for imports of the module
2. Check for usages of exports
3. Review test files

## Language-Specific Notes

### TypeScript/JavaScript

**Key searches**:
- Type definitions in `*.types.ts`, `*.d.ts`
- React components in `*.tsx`, `*.jsx`
- Entry points: `index.ts`, `main.ts`, `app.ts`

### Python

**Key searches**:
- Class definitions with `^class `
- Decorators (e.g., `@app.route`, `@dataclass`)
- Entry points: `__main__.py`, `main.py`, `app.py`

### Go

**Key searches**:
- Use `.` (project root) not `src/` for searches
- Entry points: `main.go`, `cmd/`
- Interfaces and structs

### Java

**Key searches**:
- Annotations (e.g., `@Service`, `@Entity`, `@RestController`)
- Entry points: `*Application.java`, `main()` methods
- Package structure in `src/main/java/`

## Advanced Techniques

### Finding Implicit Behavior

**Look for**:
- Middleware (authentication, logging, validation)
- Hooks/lifecycle methods
- Event listeners
- Decorators/annotations

**These often control behavior without explicit calls in code.**

### Cross-Referencing

**When findings conflict**:
1. Check git history (what changed, when, why)
2. Compare dev vs prod configs
3. Look for feature flags
4. Check environment-specific code

### Pattern Recognition

**After exploring**, note:
- Project-specific naming conventions
- Common utility locations
- Standard file organization
- Typical data flow patterns

**Use these patterns to guide future searches in the same project.**

## Multi-Step Search Examples

### Example 1: API Endpoint Behavior

**Goal**: Understand POST /users endpoint

```
Step 1: Find route
  → Search: route.*post.*users

Step 2: Find handler
  → Found: createUserHandler in routes
  → Search: function createUserHandler

Step 3: Find service
  → Handler calls: userService.create
  → Search: userService.*create

Step 4: Find data layer
  → Service uses: UserRepository.save
  → Search: class UserRepository

Step 5: Check validation
  → Search: validate.*user|user.*schema

Step 6: Check tests
  → Search: test.*create.*user
```

### Example 2: Configuration Value

**Goal**: Find database connection timeout

```
Step 1: Search configs
  → Search: timeout in config/

Step 2: Search env vars
  → Search: process.env.*TIMEOUT

Step 3: Search usage
  → Search: connection.*timeout

Step 4: Check defaults
  → Look in config initialization code

Step 5: Verify in tests
  → Search tests for timeout scenarios
```

### Example 3: Error Handling

**Goal**: How are payment errors handled?

```
Step 1: Find error definitions
  → Search: PaymentError|payment.*error

Step 2: Find throw sites
  → Search: throw.*Payment

Step 3: Find catch blocks
  → Search: catch.*payment in payment module

Step 4: Find error responses
  → Check API response handling

Step 5: Verify with tests
  → Search: test.*payment.*error
```

## Search Optimization Tips

### Start Specific, Expand Gradually

1. Exact match first
2. If not found, use partial match
3. Then use case-insensitive
4. Finally, related terms

### Use File Type Filters

Focus searches on relevant files:
- `--include="*.ts"` for TypeScript
- `--include="*.py"` for Python
- `--exclude-dir="node_modules"` to skip dependencies

### Context is Key

Use `-A`, `-B`, `-C` flags to see surrounding code when matches are found.

### Combine Tools

- **Glob**: Find files by pattern
- **Grep**: Search content within files
- **Read**: Examine full file context
- **Task**: For exploratory analysis across many files

## Common Search Failures

**Problem**: Can't find implementation

**Solutions**:
- Check for aliases/re-exports
- Look in parent/child directories
- Search for similar naming patterns
- Check if dynamically generated

**Problem**: Too many results

**Solutions**:
- Add file type filters
- Search in specific subdirectories
- Use more specific terms
- Exclude test/build directories

**Problem**: Outdated code found

**Solutions**:
- Check file timestamps
- Review git history
- Look for deprecation notices
- Confirm with tests
