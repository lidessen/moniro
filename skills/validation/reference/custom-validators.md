# Custom Validators

Guide to creating project-specific validators.

## Quick Start

Add to `.validation.yml`:

```yaml
custom_validators:
  - name: my-validator
    command: ./scripts/validate.sh
    severity: important
```

## Validator Definition

```yaml
custom_validators:
  - name: string # Required: unique identifier
    description: string # Optional: what it checks
    command: string # Required: command to run
    severity: string # Required: critical | important | suggestion
    timeout: string # Optional: max execution time (default: 30s)
    when: string # Optional: condition to run
    env: object # Optional: environment variables
```

## Output Format

Validators must output JSON to stdout:

```json
{
  "status": "warning",
  "findings": [
    {
      "type": "rule_name",
      "severity": "important",
      "message": "Description of issue",
      "location": "file:line",
      "suggestion": "How to fix"
    }
  ]
}
```

### Status Values

| Status    | Meaning                   |
| --------- | ------------------------- |
| `pass`    | No issues found           |
| `warning` | Non-critical issues found |
| `fail`    | Critical issues found     |

### Finding Fields

| Field        | Required | Description                       |
| ------------ | -------- | --------------------------------- |
| `type`       | Yes      | Issue category                    |
| `severity`   | Yes      | critical / important / suggestion |
| `message`    | Yes      | Human-readable description        |
| `location`   | No       | file:line reference               |
| `suggestion` | No       | How to resolve                    |
| `affected`   | No       | List of affected files/locations  |

## Examples

### Shell Script Validator

```bash
#!/bin/bash
# scripts/check-todos.sh

findings=()

# Find TODO comments in source files
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  findings+=("{\"type\":\"todo\",\"severity\":\"suggestion\",\"message\":\"TODO found\",\"location\":\"$file:$linenum\"}")
done < <(grep -rn "TODO" src/ --include="*.ts" 2>/dev/null)

# Output JSON
if [ ${#findings[@]} -eq 0 ]; then
  echo '{"status":"pass","findings":[]}'
else
  echo "{\"status\":\"warning\",\"findings\":[$(IFS=,; echo "${findings[*]}")]}"
fi
```

### Node.js Validator

```javascript
#!/usr/bin/env node
// scripts/check-imports.js

const fs = require("fs");
const path = require("path");

const findings = [];

// Check for circular imports
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  // ... analysis logic ...
  if (hasIssue) {
    findings.push({
      type: "circular_import",
      severity: "important",
      message: `Circular import detected`,
      location: `${filePath}:${lineNumber}`,
      suggestion: "Break the cycle by extracting shared code",
    });
  }
}

// ... scan files ...

console.log(
  JSON.stringify({
    status: findings.length > 0 ? "warning" : "pass",
    findings,
  }),
);
```

### Python Validator

```python
#!/usr/bin/env python3
# scripts/check_naming.py

import json
import re
from pathlib import Path

findings = []

def check_file(path):
    content = path.read_text()
    for i, line in enumerate(content.split('\n'), 1):
        if re.search(r'class [a-z]', line):  # lowercase class
            findings.append({
                'type': 'naming_convention',
                'severity': 'suggestion',
                'message': 'Class name should be PascalCase',
                'location': f'{path}:{i}',
                'suggestion': 'Rename to PascalCase'
            })

for path in Path('src').rglob('*.py'):
    check_file(path)

print(json.dumps({
    'status': 'warning' if findings else 'pass',
    'findings': findings
}))
```

## Conditional Execution

Run validators only when relevant:

```yaml
custom_validators:
  - name: python-checks
    command: ./scripts/check-python.sh
    severity: important
    when: "glob('**/*.py')" # Only if Python files exist

  - name: api-contracts
    command: npm run validate:contracts
    severity: critical
    when: "changed('src/api/**')" # Only if API files changed

  - name: migration-check
    command: ./scripts/check-migrations.sh
    severity: critical
    when: "changed('db/migrations/**')"
```

### When Conditions

| Condition            | Description                       |
| -------------------- | --------------------------------- |
| `glob('pattern')`    | True if matching files exist      |
| `changed('pattern')` | True if matching files changed    |
| `env('VAR')`         | True if environment variable set  |
| `pipeline('name')`   | True if running in named pipeline |

## Environment Variables

Pass context to validators:

```yaml
custom_validators:
  - name: env-check
    command: ./scripts/check-env.sh
    severity: important
    env:
      CHECK_LEVEL: strict
      TARGET_ENV: production
```

Available built-in variables:

| Variable              | Description                       |
| --------------------- | --------------------------------- |
| `VALIDATION_PIPELINE` | Current pipeline name             |
| `VALIDATION_CONTEXT`  | What triggered validation         |
| `VALIDATION_FILES`    | Space-separated changed files     |
| `VALIDATION_BASE`     | Base branch/commit for comparison |

## Adding to Pipelines

Include custom validators in pipeline configuration:

```yaml
pipelines:
  standard:
    validators:
      - syntax
      - reviewability
      - my-custom-validator # Custom validator
      - security

  release:
    validators:
      - syntax
      - reviewability
      - security
      - api-contracts # Custom
      - migration-check # Custom
      - performance-check # Custom
```

## Best Practices

1. **Fast execution**: Keep under 30s for standard pipeline
2. **Clear messages**: Explain what's wrong and how to fix
3. **Specific locations**: Include file:line when possible
4. **Appropriate severity**: Reserve critical for blocking issues
5. **Idempotent**: Same input should give same output
6. **Exit codes**: Return 0 even for warnings (non-zero only for errors)
