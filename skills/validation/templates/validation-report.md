---
type: validation
context: { { context } }
slug: { { slug } }
pipeline: { { pipeline } }
status: { { status } }
timestamp: { { timestamp } }
duration: { { duration } }
summary:
  critical: { { critical_count } }
  important: { { important_count } }
  suggestion: { { suggestion_count } }
  passed: { { passed_count } }
files_validated: { { files } }
tags: { { tags } }
---

# Validation: {{title}}

**Context**: {{context_description}}
**Pipeline**: {{pipeline}}
**Status**: {{status_emoji}} {{status_text}}

## Summary

| Severity      | Count                |
| ------------- | -------------------- |
| 🔴 Critical   | {{critical_count}}   |
| 🟡 Important  | {{important_count}}  |
| 🔵 Suggestion | {{suggestion_count}} |
| ✅ Passed     | {{passed_count}}     |

## Findings

{{#if critical_findings}}

### Critical (🔴)

{{#each critical_findings}}

#### {{@index}}. {{title}}

- **Validator**: {{validator}}
- **Location**: {{location}}
- **Message**: {{message}}
- **Suggestion**: {{suggestion}}
- **Status**: {{resolution_status}}

{{/each}}
{{/if}}

{{#if important_findings}}

### Important (🟡)

{{#each important_findings}}

#### {{@index}}. {{title}}

- **Validator**: {{validator}}
- **Location**: {{location}}
- **Message**: {{message}}
- **Suggestion**: {{suggestion}}
- **Status**: {{resolution_status}}

{{/each}}
{{/if}}

{{#if suggestions}}

### Suggestions (🔵)

{{#each suggestions}}
{{@index}}. **{{title}}**: {{message}}
{{/each}}
{{/if}}

## Validator Results

| Validator | Status | Duration | Findings |
| --------- | ------ | -------- | -------- |

{{#each validators}}
| {{name}} | {{status_emoji}} {{status}} | {{duration}} | {{finding_count}} |
{{/each}}

{{#if actions}}

## Actions Taken

{{#each actions}}

- [{{#if completed}}x{{else}} {{/if}}] {{description}}
  {{/each}}
  {{/if}}

{{#if related}}

## Related

{{#each related}}

- {{type}}: {{reference}}
  {{/each}}
  {{/if}}
