# Built-in Validators

Detailed documentation for each built-in validator.

## Table of Contents

- [Reviewability Validator](#reviewability-validator)
- [Impact Validator](#impact-validator)
- [Security Validator](#security-validator)
- [Consistency Validator](#consistency-validator)
- [Architecture Validator](#architecture-validator)
- [Syntax Validator](#syntax-validator)
- [Creating Custom Validators](#creating-custom-validators)

---

## Reviewability Validator

**Source**: refining skill
**Pipeline**: quick, standard, comprehensive

Checks if changes are easy to review.

### Checks

| Check    | Severity      | Description                       |
| -------- | ------------- | --------------------------------- |
| Cohesion | 🟡 Important  | Single purpose per change         |
| Size     | 🟡 Important  | <400 lines ideal, >800 flag       |
| Noise    | 🔵 Suggestion | Debug code, TODOs, commented code |

### Cohesion Patterns

```
❌ Mixed Concerns:
├── Feature + Refactor → Split
├── Multiple features → Split
├── Bug fix + New feature → Split
└── Config + Logic → Split

✅ Single Purpose:
├── One feature implementation
├── One bug fix
├── One refactoring goal
└── Related config changes
```

### Size Thresholds

| Lines   | Assessment | Action                   |
| ------- | ---------- | ------------------------ |
| <200    | Excellent  | Proceed                  |
| 200-400 | Good       | Proceed                  |
| 400-800 | Large      | Consider split           |
| >800    | Too large  | Strongly recommend split |

### Noise Patterns

```
Debug code:
- console.log, console.debug
- print(), pprint()
- debugger, pdb.set_trace()
- System.out.println

TODO/FIXME in new code:
- // TODO:
- # FIXME:
- /* TODO */

Commented-out code:
- >3 consecutive commented lines
- Entire functions commented
```

### Output

```yaml
validator: reviewability
status: warning # pass, warning, fail
findings:
  - type: cohesion
    severity: important
    message: "Mixed concerns: feature implementation + refactoring"
    suggestion: "Split into two commits"
  - type: size
    severity: suggestion
    message: "587 lines changed"
    suggestion: "Consider splitting for easier review"
```

---

## Impact Validator

**Source**: refining skill
**Pipeline**: standard, comprehensive

Analyzes blast radius of changes.

### Checks

| Check                  | Severity     | Description                    |
| ---------------------- | ------------ | ------------------------------ |
| Breaking changes       | 🔴 Critical  | API/schema modifications       |
| Signature changes      | 🟡 Important | Function parameter changes     |
| Shared utility changes | 🟡 Important | Widely-used code modifications |

### Breaking Change Detection

```
API Changes:
├── Removed endpoints
├── Renamed endpoints
├── Changed response structure
└── Authentication changes

Schema Changes:
├── Removed fields
├── Type changes
├── Constraint modifications
└── Migration without rollback

Interface Changes:
├── Removed methods
├── Changed signatures
├── Removed exports
└── Type definition changes
```

### Blast Radius Analysis

```
Change Impact Assessment:
│
├── Direct Impact
│   └── Files that import/use the changed code
│
├── Indirect Impact
│   └── Files that depend on direct impact files
│
└── Test Impact
    └── Tests that cover affected code
```

### Sampling Strategy

| Call Sites | Strategy                  |
| ---------- | ------------------------- |
| <5         | Check all                 |
| 5-20       | Sample 5-10 diverse       |
| >20        | Sample 10 + rely on tests |

### Output

```yaml
validator: impact
status: warning
findings:
  - type: breaking_change
    severity: critical
    message: "Removed public method: UserService.getById()"
    affected:
      - src/controllers/user.ts:45
      - src/api/routes.ts:123
    suggestion: "Mark as deprecated first, or add BREAKING CHANGE notice"
  - type: signature_change
    severity: important
    message: "Parameter added to formatDate()"
    affected: 12 call sites sampled
    suggestion: "Make parameter optional with default value"
```

---

## Security Validator

**Source**: refining skill
**Pipeline**: standard, comprehensive

Checks for security vulnerabilities.

### Checks

| Check                 | Severity     | Description                    |
| --------------------- | ------------ | ------------------------------ |
| Hardcoded secrets     | 🔴 Critical  | API keys, passwords, tokens    |
| SQL injection         | 🔴 Critical  | Unsanitized SQL queries        |
| Command injection     | 🔴 Critical  | Unsanitized shell commands     |
| XSS vulnerabilities   | 🔴 Critical  | Unsanitized user input in HTML |
| Path traversal        | 🟡 Important | File path manipulation         |
| Insecure dependencies | 🟡 Important | Known vulnerable packages      |

### Secret Patterns

```
High confidence:
├── API_KEY=sk-...
├── password = "..."
├── AWS_SECRET_ACCESS_KEY
└── -----BEGIN RSA PRIVATE KEY-----

Medium confidence (verify context):
├── token = "..."
├── secret = "..."
└── key = "..."
```

### Injection Patterns

```
SQL Injection:
├── String concatenation in queries
├── f-strings in SQL
└── Template literals in SQL

Command Injection:
├── os.system(user_input)
├── subprocess.call(shell=True, user_input)
└── exec() with user input

XSS:
├── innerHTML = userInput
├── dangerouslySetInnerHTML
└── document.write(userInput)
```

### Output

```yaml
validator: security
status: fail
findings:
  - type: hardcoded_secret
    severity: critical
    message: "Possible API key detected"
    location: src/config.ts:23
    suggestion: "Use environment variable instead"
  - type: sql_injection
    severity: critical
    message: "String concatenation in SQL query"
    location: src/db/users.ts:45
    suggestion: "Use parameterized queries"
```

---

## Consistency Validator

**Source**: housekeeping skill
**Pipeline**: standard, comprehensive

Checks project consistency and documentation health.

### Checks

| Check               | Severity      | Description                    |
| ------------------- | ------------- | ------------------------------ |
| Index alignment     | 🟡 Important  | README lists match directories |
| Doc freshness       | 🔵 Suggestion | Documentation age              |
| Naming conventions  | 🔵 Suggestion | Consistent file/folder naming  |
| Import organization | 🔵 Suggestion | Consistent import patterns     |

### Index Alignment

```
Check: Do lists in documentation match actual files?

Example issues:
├── README lists "auth/" but directory doesn't exist
├── Directory "utils/" exists but not documented
└── File "helper.ts" moved but README not updated
```

### Doc Freshness

| Age        | Status | Action                   |
| ---------- | ------ | ------------------------ |
| <3 months  | Fresh  | None                     |
| 3-6 months | Aging  | Review if still accurate |
| >6 months  | Stale  | Flag for update          |

### Output

```yaml
validator: consistency
status: warning
findings:
  - type: index_alignment
    severity: important
    message: "README lists 'analytics/' but directory not found"
    suggestion: "Update README or create missing directory"
  - type: doc_freshness
    severity: suggestion
    message: "CONTRIBUTING.md last updated 8 months ago"
    suggestion: "Review and update if needed"
```

---

## Architecture Validator

**Source**: engineering skill
**Pipeline**: comprehensive

Validates architectural patterns and boundaries.

### Checks

| Check                 | Severity      | Description                   |
| --------------------- | ------------- | ----------------------------- |
| Layer violations      | 🟡 Important  | Cross-layer dependencies      |
| Circular dependencies | 🟡 Important  | Module cycles                 |
| Coupling              | 🔵 Suggestion | Tight coupling indicators     |
| Pattern compliance    | 🔵 Suggestion | Adherence to project patterns |

### Layer Boundaries

```
Common violations:
├── UI layer importing from data layer directly
├── Domain logic in controllers
├── Business rules in views
└── Database queries outside repository layer
```

### Circular Dependency Detection

```
A → B → C → A  ❌ Cycle detected

Resolution strategies:
├── Extract common interface
├── Dependency injection
├── Event-based communication
└── Restructure modules
```

### Output

```yaml
validator: architecture
status: warning
findings:
  - type: layer_violation
    severity: important
    message: "Controller directly accessing database"
    location: src/controllers/user.ts:89
    suggestion: "Use repository pattern"
  - type: circular_dependency
    severity: important
    message: "Cycle: auth → user → permissions → auth"
    suggestion: "Extract shared interface or use events"
```

---

## Syntax Validator

**Source**: built-in
**Pipeline**: quick, standard, comprehensive

Basic syntax and lint checks.

### Checks

Delegates to project's configured tools:

| Tool          | Detection                   | Checks      |
| ------------- | --------------------------- | ----------- |
| ESLint        | `.eslintrc*`                | JS/TS lint  |
| Prettier      | `.prettierrc*`              | Formatting  |
| Ruff/Flake8   | `pyproject.toml`, `.flake8` | Python lint |
| Clippy        | `Cargo.toml`                | Rust lint   |
| golangci-lint | `.golangci.yml`             | Go lint     |

### Output

```yaml
validator: syntax
status: pass
findings: []
delegated_to: eslint
execution_time: 2.3s
```

---

## Creating Custom Validators

Define in `.validation.yml`:

```yaml
custom_validators:
  - name: domain-rules
    description: "Check domain-specific business rules"
    command: ./scripts/validate-domain.sh
    severity: important
    timeout: 30s

  - name: api-contracts
    description: "Verify API contracts match implementation"
    command: npm run validate:contracts
    severity: critical

  - name: localization
    description: "Check all strings are localized"
    command: ./scripts/check-i18n.sh
    severity: suggestion
```

### Custom Validator Output Format

Custom validators should output JSON:

```json
{
  "status": "warning",
  "findings": [
    {
      "type": "domain_rule",
      "severity": "important",
      "message": "Order total must not exceed credit limit",
      "location": "src/services/order.ts:156",
      "suggestion": "Add credit limit check before order creation"
    }
  ]
}
```

### Validator Interface

```typescript
interface ValidatorResult {
  validator: string;
  status: "pass" | "warning" | "fail";
  findings: Finding[];
  execution_time?: string;
}

interface Finding {
  type: string;
  severity: "critical" | "important" | "suggestion";
  message: string;
  location?: string;
  affected?: string[];
  suggestion?: string;
}
```
