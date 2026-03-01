# Defense-in-Depth Validation

Multiple validation layers that catch what single checks miss.

Inspired by [superpowers](https://github.com/obra/superpowers) framework.

## Table of Contents

- [Philosophy](#philosophy)
- [The Four Layers](#the-four-layers)
- [Layer Interactions](#layer-interactions)
- [Implementation Guide](#implementation-guide)
- [Context-Sensitive Strictness](#context-sensitive-strictness)

---

## Philosophy

> "All four layers were necessary during testing—each layer caught bugs the others missed."

A single validation layer is never enough because:

- Each layer has blind spots
- Different layers catch different issue types
- Layers complement each other's weaknesses

```
Single Layer:        Defense-in-Depth:

     ┌───┐           ┌───┬───┬───┬───┐
     │ V │           │ 1 │ 2 │ 3 │ 4 │
     └───┘           └───┴───┴───┴───┘

  Gaps exist         Layers overlap
  Issues slip        Issues caught
```

---

## The Four Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    DEFENSE-IN-DEPTH                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 1: ENTRY POINT VALIDATION                           │
│  ├── Reject invalid input at boundaries                    │
│  ├── Type checking, format validation                      │
│  └── Early exit for malformed data                         │
│                                                             │
│  Layer 2: BUSINESS LOGIC VALIDATION                        │
│  ├── Context-appropriate data checks                       │
│  ├── Domain rules enforcement                              │
│  └── State consistency verification                        │
│                                                             │
│  Layer 3: ENVIRONMENT GUARDS                               │
│  ├── Prevent dangerous operations in specific contexts     │
│  ├── Mode-aware safety checks                              │
│  └── Resource availability verification                    │
│                                                             │
│  Layer 4: DEBUG INSTRUMENTATION                            │
│  ├── Capture context for forensic analysis                 │
│  ├── Detailed logging of state transitions                 │
│  └── Evidence collection for troubleshooting               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Entry Point Validation

**Purpose**: Catch obviously wrong inputs early

**Examples**:

```
├── SKILL.md frontmatter:
│   ├── name: must be lowercase-with-hyphens
│   ├── description: max 1024 chars, no angle brackets
│   └── required fields present
│
├── Commit validation:
│   ├── Changes staged (not empty)
│   ├── Valid git state
│   └── Branch exists
│
└── PR validation:
    ├── Title present
    ├── Description not empty
    └── Target branch valid
```

**What it catches**:

- Malformed inputs
- Missing required data
- Type mismatches
- Format violations

### Layer 2: Business Logic Validation

**Purpose**: Enforce domain rules and semantics

**Examples**:

```
├── Cohesion check:
│   ├── Single purpose per commit
│   ├── Related changes grouped
│   └── No mixed concerns
│
├── Size assessment:
│   ├── Lines within threshold
│   ├── File count reasonable
│   └── Complexity manageable
│
└── Impact analysis:
    ├── Breaking changes identified
    ├── Affected code traced
    └── Migration path clear
```

**What it catches**:

- Semantic violations
- Business rule breaches
- Logical inconsistencies
- Domain constraint failures

### Layer 3: Environment Guards

**Purpose**: Prevent dangerous operations based on context

**Examples**:

```
├── Production protection:
│   ├── No force push to main
│   ├── No destructive commands
│   └── No unreviewed deploys
│
├── Session isolation:
│   ├── Stricter rules for group contexts
│   ├── Sandbox for untrusted code
│   └── Resource limits enforced
│
└── Tool availability:
    ├── Required binaries present
    ├── Permissions sufficient
    └── Dependencies installed
```

**What it catches**:

- Context-inappropriate actions
- Missing prerequisites
- Permission violations
- Resource exhaustion risks

### Layer 4: Debug Instrumentation

**Purpose**: Capture evidence for analysis and learning

**Examples**:

```
├── State capture:
│   ├── Before/after snapshots
│   ├── Decision points logged
│   └── Path taken recorded
│
├── Metrics collection:
│   ├── Execution time
│   ├── Token usage
│   ├── Resource consumption
│
└── Evidence preservation:
    ├── Command outputs saved
    ├── Exit codes recorded
    └── Error contexts captured
```

**What it catches**:

- Enables root cause analysis
- Provides learning data
- Supports trend detection
- Feeds feedback loop

---

## Layer Interactions

Layers work together, each covering gaps:

```
Issue Type           │ L1 │ L2 │ L3 │ L4 │
─────────────────────┼────┼────┼────┼────┤
Missing field        │ ✅ │    │    │    │
Wrong format         │ ✅ │    │    │    │
Mixed concerns       │    │ ✅ │    │    │
Breaking change      │    │ ✅ │    │    │
Force push to main   │    │    │ ✅ │    │
Missing tool         │    │    │ ✅ │    │
Recurring pattern    │    │    │    │ ✅ │
Performance issue    │    │    │    │ ✅ │
```

### Cascade Example

```
Commit Validation Flow:

Input: "git commit" request
         │
    ┌────▼────┐
    │ Layer 1 │ ── Check: staged changes exist? ──► No? STOP
    └────┬────┘
         │ Yes
    ┌────▼────┐
    │ Layer 2 │ ── Check: cohesive? sized? clean? ──► Issues? WARN
    └────┬────┘
         │ Pass/Acknowledged
    ┌────▼────┐
    │ Layer 3 │ ── Check: not main? tools available? ──► Unsafe? STOP
    └────┬────┘
         │ Safe
    ┌────▼────┐
    │ Layer 4 │ ── Record: commit details, validation time, issues found
    └────┬────┘
         │
         ▼
      Proceed
```

---

## Implementation Guide

### Adding Layers to Validators

Each validator should implement applicable layers:

```yaml
validator: reviewability
layers:
  entry_point:
    - changes_exist
    - valid_git_state
  business_logic:
    - cohesion_check
    - size_check
    - noise_detection
  environment:
    - tools_available
  instrumentation:
    - record_findings
    - capture_metrics
```

### Pipeline Configuration

```yaml
pipelines:
  comprehensive:
    defense_in_depth:
      layer_1: strict # Entry point
      layer_2: strict # Business logic
      layer_3: strict # Environment
      layer_4: enabled # Instrumentation

  quick:
    defense_in_depth:
      layer_1: strict
      layer_2: minimal # Only critical checks
      layer_3: warn # Warn but don't block
      layer_4: minimal # Basic logging only
```

### Layer Failure Handling

```
Layer 1 failure → STOP (invalid input)
Layer 2 failure → WARN or STOP (based on severity)
Layer 3 failure → STOP (unsafe operation)
Layer 4 failure → LOG (continue, but note issue)
```

---

## Context-Sensitive Strictness

Inspired by [openclaw](https://github.com/openclaw/openclaw) session isolation.

Different contexts warrant different strictness levels:

### Context Types

| Context              | Layer 1  | Layer 2  | Layer 3  | Layer 4 |
| -------------------- | -------- | -------- | -------- | ------- |
| **Personal project** | Standard | Standard | Standard | Full    |
| **Team project**     | Strict   | Strict   | Strict   | Full    |
| **Production**       | Strict   | Strict   | Maximum  | Full    |
| **Experiment/POC**   | Relaxed  | Relaxed  | Standard | Full    |

### Auto-Detection Rules

```yaml
context_detection:
  production:
    indicators:
      - branch: main|master|release/*
      - has_ci: true
      - has_deploy: true
    strictness: maximum

  team:
    indicators:
      - has_pr_template: true
      - has_codeowners: true
    strictness: strict

  experiment:
    indicators:
      - branch: experiment/*|poc/*|spike/*
    strictness: relaxed
```

### Override Capability

Users can override detected context:

```bash
# Force strict validation on experimental branch
validate --context=production

# Relax validation for local testing
validate --context=experiment
```

---

## Metrics and Learning

Layer 4 feeds the feedback loop:

```
Layer 4 Instrumentation
         │
         ▼
    .memory/validations/
         │
         ├── Issue frequency per layer
         ├── Catch rates by layer
         ├── False positive rates
         └── Gap analysis
```

### Example Metrics

```markdown
## Defense-in-Depth Effectiveness (Last 30 Days)

| Layer     | Issues Caught | Unique Catches | Gap Coverage                |
| --------- | ------------- | -------------- | --------------------------- |
| L1: Entry | 23            | 23 (100%)      | N/A                         |
| L2: Logic | 45            | 38 (84%)       | Caught 7 L1 misses          |
| L3: Env   | 12            | 8 (67%)        | Caught 4 L2 misses          |
| L4: Debug | N/A           | N/A            | Enabled 15 root cause fixes |

**Key Insight**: Without L3, 8 unsafe operations would have proceeded.
```

---

## Anti-Patterns

| Anti-Pattern               | Why Bad                     | Fix                                    |
| -------------------------- | --------------------------- | -------------------------------------- |
| Single layer only          | Gaps inevitable             | Add complementary layers               |
| Skipping layers for speed  | Issues slip through         | Use quick pipeline, not layer skipping |
| Same strictness everywhere | Over/under validation       | Context-sensitive strictness           |
| Ignoring L4 data           | Missed learning opportunity | Analyze instrumentation regularly      |

---

## Checklist

For each validation:

- [ ] Layer 1: Did I check basic input validity?
- [ ] Layer 2: Did I apply domain rules?
- [ ] Layer 3: Did I verify environment safety?
- [ ] Layer 4: Did I capture evidence for learning?
- [ ] Are layers appropriate for the context?
- [ ] Am I learning from what layers catch?
