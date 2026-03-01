# Validation Pipelines

Detailed documentation for pipeline configuration and execution.

## Table of Contents

- [Pipeline Concepts](#pipeline-concepts)
- [Built-in Pipelines](#built-in-pipelines)
- [Pipeline Execution](#pipeline-execution)
- [Configuration](#configuration)
- [Context-Aware Selection](#context-aware-selection)

---

## Pipeline Concepts

A pipeline is an ordered sequence of validators with shared configuration.

### Pipeline Structure

```
Pipeline Definition:
├── name: Identifier
├── validators: Ordered list of validators to run
├── timeout: Maximum execution time
├── fail_fast: Stop on first critical issue?
└── options: Validator-specific configuration
```

### Execution Flow

```
┌─────────────────────────────────────────────────┐
│              PIPELINE EXECUTION                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  1. Initialize                                  │
│     └── Load configuration                      │
│     └── Detect context (files, changes, etc.)  │
│                                                 │
│  2. Pre-flight                                  │
│     └── Verify validators available             │
│     └── Check timeouts are reasonable          │
│                                                 │
│  3. Execute validators (in order)              │
│     ┌─────────────────────────────────────┐    │
│     │  For each validator:                │    │
│     │  ├── Run validator                  │    │
│     │  ├── Collect findings               │    │
│     │  ├── Check fail_fast condition      │    │
│     │  └── Continue or stop               │    │
│     └─────────────────────────────────────┘    │
│                                                 │
│  4. Aggregate results                          │
│     └── Combine all findings                   │
│     └── Calculate overall status               │
│     └── Generate report                        │
│                                                 │
│  5. Post-actions                               │
│     └── Persist to .memory/validations/        │
│     └── Update trend data                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Built-in Pipelines

### Quick Pipeline

**Purpose**: Fast feedback for small changes
**Use when**: Every save, quick checks, small commits

```yaml
name: quick
timeout: 10s
fail_fast: true
validators:
  - syntax
  - reviewability:
      checks: [noise] # Skip cohesion/size for quick
```

**Characteristics**:

- Must feel instant (<10s)
- Only catch obvious issues
- No deep analysis

### Standard Pipeline

**Purpose**: Balanced validation for normal workflow
**Use when**: Before commits, explicit validation requests

```yaml
name: standard
timeout: 60s
fail_fast: false
validators:
  - syntax
  - reviewability:
      checks: [cohesion, size, noise]
  - security:
      checks: [secrets, injection]
  - consistency:
      checks: [index_alignment]
```

**Characteristics**:

- Thorough but reasonable time
- Catches most issues
- Default for most situations

### Comprehensive Pipeline

**Purpose**: Full validation for important changes
**Use when**: Before PR/MR creation, major releases

```yaml
name: comprehensive
timeout: 300s
fail_fast: false
validators:
  - syntax
  - reviewability:
      checks: [cohesion, size, noise]
  - security:
      checks: [secrets, injection, dependencies]
  - impact:
      checks: [breaking_changes, signature_changes, blast_radius]
  - consistency:
      checks: [index_alignment, doc_freshness, naming]
  - architecture:
      checks: [layer_violations, circular_dependencies, coupling]
```

**Characteristics**:

- Most thorough analysis
- May take several minutes
- Use for significant changes

---

## Pipeline Execution

### Validator Execution Order

Validators run in declared order. Recommended ordering:

```
1. syntax        → Catch basic errors first
2. reviewability → Check change quality
3. security      → Critical safety checks
4. impact        → Analyze change effects
5. consistency   → Project health
6. architecture  → Structural validation
7. [custom]      → Project-specific checks
```

### Fail-Fast Behavior

When `fail_fast: true`:

```
Validator 1: pass     → Continue
Validator 2: warning  → Continue
Validator 3: fail     → STOP (critical found)
Validator 4: (skipped)
```

When `fail_fast: false`:

```
Validator 1: pass     → Continue
Validator 2: warning  → Continue
Validator 3: fail     → Continue (record critical)
Validator 4: warning  → Continue
All validators run, all issues collected
```

### Timeout Handling

```
Pipeline timeout: 60s
Validator timeouts:
├── syntax: 10s
├── reviewability: 15s
├── security: 20s
└── remaining: shared from 60s

If validator exceeds timeout:
├── Record timeout as warning
├── Continue to next validator
└── Note in report
```

---

## Configuration

### Project Configuration (.validation.yml)

```yaml
# .validation.yml

# Override built-in pipelines
pipelines:
  quick:
    timeout: 5s # Faster for this project
    validators:
      - syntax

  standard:
    timeout: 120s # More time needed
    validators:
      - syntax
      - reviewability
      - security
      - domain-rules # Custom validator

  # Define new pipeline
  release:
    timeout: 600s
    validators:
      - syntax
      - reviewability
      - security
      - impact
      - consistency
      - architecture
      - performance-check # Custom

# Custom validators
custom_validators:
  - name: domain-rules
    command: ./scripts/validate-domain.sh
    severity: important
    timeout: 30s

  - name: performance-check
    command: npm run perf:check
    severity: suggestion
    timeout: 120s

# Global options
options:
  # Skip certain paths
  exclude_paths:
    - "vendor/**"
    - "node_modules/**"
    - "**/*.generated.*"

  # Severity thresholds
  fail_on: critical # 'critical', 'important', or 'any'

  # Auto-persist results
  persist_results: true
```

### Validator-Specific Options

```yaml
validators:
  - reviewability:
      # Size thresholds
      size_thresholds:
        excellent: 200
        good: 400
        warning: 800
      # Skip cohesion check for certain paths
      skip_cohesion:
        - "migrations/**"
        - "generated/**"

  - security:
      # Additional secret patterns
      custom_secret_patterns:
        - "INTERNAL_.*_KEY"
        - "COMPANY_SECRET_.*"
      # Ignore certain false positives
      ignore:
        - src/tests/fixtures/**

  - impact:
      # Always check these files thoroughly
      high_impact_paths:
        - "src/core/**"
        - "src/api/**"
```

---

## Context-Aware Selection

The system automatically selects pipelines based on context.

### Detection Rules

```
Context Detection Priority:
│
├── 1. Explicit request
│   └── "validate quick" → quick
│   └── "validate comprehensive" → comprehensive
│
├── 2. Workflow context
│   └── PR/MR creation → comprehensive
│   └── Commit → standard
│   └── git add → quick
│
├── 3. Change analysis
│   └── >500 lines changed → comprehensive
│   └── Security-sensitive files → comprehensive
│   └── API changes → standard+
│
└── 4. Default
    └── standard
```

### Automatic Pipeline Enhancement

System may enhance pipeline based on detected risks:

```
Detected: Changes to authentication code
Action: Add security validator even if not in pipeline

Detected: Database migration files
Action: Add impact validator for schema changes

Detected: API endpoint changes
Action: Enable breaking change detection
```

### Override Behavior

User can always override:

```
"validate quick --force"  → Run quick even if context suggests comprehensive
"validate --no-persist"   → Don't save results to .memory/
"validate --fail-fast"    → Stop on first critical
```

---

## Pipeline Results

### Result Structure

```yaml
pipeline_result:
  pipeline: standard
  context: "staged changes for commit"
  started: 2026-01-31T10:30:00Z
  finished: 2026-01-31T10:30:45Z
  duration: 45s

  overall_status: warning # pass, warning, fail

  summary:
    critical: 0
    important: 2
    suggestion: 5
    passed_checks: 23

  validators:
    - name: syntax
      status: pass
      duration: 3s
      findings: []

    - name: reviewability
      status: warning
      duration: 12s
      findings:
        - type: size
          severity: important
          message: "562 lines changed"

    - name: security
      status: pass
      duration: 18s
      findings: []

  recommendations:
    - "Consider splitting commit for easier review"
    - "All security checks passed"
```

### Status Calculation

```
Overall status rules:
├── Any critical finding → fail
├── Any important finding → warning
├── Only suggestions → pass (with notes)
└── No findings → pass
```
