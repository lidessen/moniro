# Metrics Tracking

Track validation costs, performance, and effectiveness.

Inspired by [openclaw](https://github.com/openclaw/openclaw) session cost tracking.

## Table of Contents

- [Why Track Metrics](#why-track-metrics)
- [Metrics Types](#metrics-types)
- [Storage Format](#storage-format)
- [Analysis Patterns](#analysis-patterns)

---

## Why Track Metrics

Metrics enable:

- **Cost awareness**: Know the true cost of validation
- **Performance optimization**: Find slow validators
- **Effectiveness measurement**: Which validators catch real issues?
- **Trend analysis**: Is validation getting better over time?

---

## Metrics Types

### Execution Metrics

| Metric           | Description         | Use                      |
| ---------------- | ------------------- | ------------------------ |
| `duration_ms`    | Time taken          | Find slow validators     |
| `validators_run` | Count of validators | Pipeline efficiency      |
| `findings_count` | Issues found        | Validation effectiveness |
| `exit_code`      | Success/failure     | Error tracking           |

### Resource Metrics

| Metric              | Description        | Use                  |
| ------------------- | ------------------ | -------------------- |
| `files_validated`   | File count         | Scope tracking       |
| `lines_checked`     | Lines of code      | Coverage measurement |
| `commands_executed` | Shell commands run | Resource usage       |

### Cost Metrics (Optional)

If using AI-assisted validation:

| Metric           | Description        | Use              |
| ---------------- | ------------------ | ---------------- |
| `tokens_input`   | Input tokens used  | Cost calculation |
| `tokens_output`  | Output tokens used | Cost calculation |
| `estimated_cost` | $ estimate         | Budget tracking  |

---

## Storage Format

### Per-Validation Metrics

In validation report frontmatter:

```yaml
---
type: validation
metrics:
  duration_ms: 4523
  validators_run: 5
  findings:
    critical: 0
    important: 2
    suggestion: 3
  files_validated: 12
  lines_checked: 1847
  commands_executed: 8
  # Optional: AI usage
  tokens:
    input: 12500
    output: 2300
    estimated_cost_usd: 0.045
---
```

### Aggregated Metrics (JSONL)

For efficient querying, maintain `.memory/validations/metrics.jsonl`:

```jsonl
{"timestamp":"2026-01-31T10:30:00Z","pipeline":"standard","duration_ms":4523,"findings":{"critical":0,"important":2},"files":12}
{"timestamp":"2026-01-31T11:45:00Z","pipeline":"quick","duration_ms":823,"findings":{"critical":0,"important":0},"files":3}
{"timestamp":"2026-01-31T14:20:00Z","pipeline":"comprehensive","duration_ms":125000,"findings":{"critical":1,"important":5},"files":47}
```

### Weekly Summary

Generate weekly aggregate in `.memory/validations/weekly/YYYY-WNN.md`:

```markdown
# Validation Metrics: Week 2026-W05

## Overview

| Metric            | Value | Trend   |
| ----------------- | ----- | ------- |
| Total validations | 47    | ↑ +12   |
| Avg duration      | 3.2s  | ↓ -0.5s |
| Pass rate         | 87%   | ↑ +3%   |
| Critical issues   | 2     | ↓ -1    |

## By Pipeline

| Pipeline      | Count | Avg Duration | Pass Rate |
| ------------- | ----- | ------------ | --------- |
| quick         | 28    | 0.8s         | 96%       |
| standard      | 15    | 4.2s         | 80%       |
| comprehensive | 4     | 125s         | 75%       |

## Validator Effectiveness

| Validator     | Findings | True Positives | False Positives |
| ------------- | -------- | -------------- | --------------- |
| reviewability | 23       | 21 (91%)       | 2 (9%)          |
| security      | 3        | 3 (100%)       | 0 (0%)          |
| consistency   | 12       | 10 (83%)       | 2 (17%)         |

## Cost Summary (if tracked)

| Metric              | Value   |
| ------------------- | ------- |
| Total tokens        | 125,000 |
| Estimated cost      | $2.45   |
| Cost per validation | $0.05   |
```

---

## Analysis Patterns

### Finding Slow Validators

```bash
# From JSONL, find slowest validations
jq -s 'sort_by(.duration_ms) | reverse | .[0:5]' metrics.jsonl
```

### Tracking Effectiveness

```
Effectiveness = True Positives / (True Positives + False Positives)

Track over time:
- If effectiveness drops, validator needs tuning
- If effectiveness is low, validator may be too noisy
```

### Cost Optimization

```
Cost per finding = Total cost / Findings that led to fixes

Optimize by:
- Moving expensive validators later in pipeline
- Caching results for unchanged files
- Using cheaper validators for quick pipeline
```

### Trend Detection

Compare metrics across time windows:

```markdown
## Trend Analysis

### Duration Trend (Last 4 Weeks)

W02: 4.5s avg
W03: 4.2s avg ↓
W04: 3.8s avg ↓
W05: 3.2s avg ↓

Insight: Pipeline optimizations working.

### False Positive Trend

W02: 15%
W03: 12% ↓
W04: 11% ↓
W05: 9% ↓

Insight: Validator tuning effective.
```

---

## Configuration

Enable metrics tracking in `.validation.yml`:

```yaml
metrics:
  enabled: true

  # What to track
  track:
    duration: true
    findings: true
    files: true
    commands: false # Can be verbose

  # AI cost tracking (if applicable)
  cost_tracking:
    enabled: false
    # Cost per 1K tokens (adjust for your provider)
    input_cost_per_1k: 0.003
    output_cost_per_1k: 0.015

  # Aggregation
  jsonl_log: true
  weekly_summary: true
  retention_days: 90
```

---

## Integration with Feedback Loop

Metrics feed the learning system:

```
Metrics Collection
       │
       ├── High duration → Optimize validator
       │
       ├── Low effectiveness → Tune or remove validator
       │
       ├── Cost increasing → Review pipeline composition
       │
       └── Trends improving → Document what worked
```

---

## Privacy Considerations

- **Never log file contents** in metrics
- **Aggregate sensitive data** (use counts, not specifics)
- **Opt-in cost tracking** (some teams prefer not to track)
- **Retention limits** (auto-delete old metrics)
