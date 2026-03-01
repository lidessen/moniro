# Template Pattern

Provide templates for output format to ensure consistency. Match the level of strictness to your needs.

## Table of Contents

- [When to Use](#when-to-use)
- [Pattern Types](#pattern-types)
- [Template Elements](#template-elements)
- [Examples by Use Case](#examples-by-use-case)
- [Combining Templates with Other Patterns](#combining-templates-with-other-patterns)
- [Testing Templates](#testing-templates)
- [Common Mistakes](#common-mistakes)
- [Checklist](#checklist)

## When to Use

- Output format matters for downstream processing (JSON, API responses)
- Consistency is important across multiple uses
- Structure helps Claude understand what to include
- Users expect a specific format

## Pattern Types

### 1. Strict Templates (Required Format)

Use for API responses, data formats, or when exact structure is critical.

**Example: Report Structure**

````markdown
## Report Structure

ALWAYS use this exact template structure:

\```markdown

# [Analysis Title]

## Executive Summary

[One-paragraph overview of key findings]

## Key Findings

- Finding 1 with supporting data
- Finding 2 with supporting data
- Finding 3 with supporting data

## Recommendations

1. Specific actionable recommendation
2. Specific actionable recommendation
3. Specific actionable recommendation

## Appendix

- Data sources used
- Methodology notes
  \```

Do not deviate from this structure.
````

**Example: JSON Response**

````markdown
## API Response Format

Return EXACTLY this structure:

\```json
{
"status": "success" | "error",
"data": {
"results": [...],
"count": 0,
"page": 1
},
"error": {
"code": "ERROR_CODE",
"message": "Human readable message"
},
"metadata": {
"timestamp": "ISO8601",
"version": "1.0"
}
}
\```

All fields are required. Use null for optional fields when not present.
````

**When to use strict templates**:

- API responses
- Data interchange formats
- Compliance requirements
- Automated processing

### 2. Flexible Templates (Guidance)

Use when structure is helpful but adaptation is valuable.

**Example: Analysis Report**

````markdown
## Report Structure

Here is a sensible default format, but use your best judgment:

\```markdown

# [Analysis Title]

## Executive Summary

[Overview of analysis and main conclusions]

## Background

[Context and motivation - optional if obvious]

## Methodology

[How analysis was performed]

## Findings

[Adapt sections based on what you discover]

- Theme 1: [Details]
- Theme 2: [Details]

## Recommendations

[Tailor to the specific context]

## Limitations

[Note any caveats or constraints]
\```

Adjust sections based on the analysis type:

- Add sections for complex findings
- Omit sections that aren't relevant
- Reorder if flow improves
````

**Example: Code Documentation**

````markdown
## Documentation Template

Use this as a starting point, adapt as needed:

\```python
def function_name(param1: Type, param2: Type) -> ReturnType:
"""Brief description of what the function does.

    More detailed explanation if the function is complex.

    Args:
        param1: Description of param1
        param2: Description of param2

    Returns:
        Description of return value

    Raises:
        ExceptionType: When this exception occurs

    Example:
        >>> function_name(value1, value2)
        expected_output
    """

\```

For simple functions, brief descriptions are fine.
For complex functions, add more detail and examples.
````

**When to use flexible templates**:

- Content creation
- Documentation
- Analysis reports
- Where context determines best structure

### 3. Template with Variants

Provide multiple templates for different scenarios.

**Example: Commit Messages**

````markdown
## Commit Message Templates

Choose the appropriate template based on change type:

**Feature**:
\```
feat(scope): brief description

Detailed description of the feature

- Key point 1
- Key point 2
  \```

**Bug Fix**:
\```
fix(scope): brief description

- What was broken
- How it's fixed
- How to verify the fix
  \```

**Refactoring**:
\```
refactor(scope): brief description

- What was changed
- Why it was changed
- Impact on functionality (if any)
  \```

**Chore** (dependencies, config):
\```
chore: brief description

- List of changes
- Version updates
  \```
````

**Example: Test Cases**

````markdown
## Test Templates

**Unit Test**:
\```python
def test_function_name_condition(): # Arrange
input_data = prepare_test_data()

    # Act
    result = function_name(input_data)

    # Assert
    assert result == expected_value

\```

**Integration Test**:
\```python
def test_integration_scenario(): # Setup
setup_test_environment()

    # Execute workflow
    step1_result = perform_step1()
    step2_result = perform_step2(step1_result)

    # Verify
    assert final_state_is_correct()

    # Cleanup
    teardown_test_environment()

\```
````

**When to use variants**:

- Different types of content require different structures
- Scenarios have distinct patterns
- One template doesn't fit all cases

## Template Elements

### Required Sections

Mark sections that must be present:

```markdown
## Report Structure

**Required sections**:

- Executive Summary (always include)
- Key Findings (always include)
- Recommendations (always include)

**Optional sections**:

- Background (include if context isn't obvious)
- Methodology (include for complex analysis)
- Appendix (include for supporting data)
```

### Placeholders

Use clear placeholder syntax:

````markdown
\```

# [Title - replace with actual title]

Author: [Your Name]
Date: [YYYY-MM-DD]

## [Section Name]

[Section content goes here]
\```
````

### Conditional Content

Show when sections should be included:

````markdown
## API Response Template

\```json
{
"status": "success",
"data": { ... },
"error": null, // Only populate if status is "error"
"pagination": { // Only include for paginated endpoints
"page": 1,
"total": 100
}
}
\```
````

## Examples by Use Case

### Code Review Feedback

````markdown
## Code Review Template

\```markdown

## Summary

[One sentence overview]

## Critical Issues (Must Fix)

- [ ] Issue 1: [Description and location]
- [ ] Issue 2: [Description and location]

## Suggestions (Optional)

- Suggestion 1: [Description and why it would help]
- Suggestion 2: [Description and why it would help]

## Positive Notes

- [What was done well]
- [Good patterns to call out]

## Testing

- [ ] Verified tests pass
- [ ] Checked test coverage for new code
      \```
````

### Database Query Results

````markdown
## Query Results Template

\```markdown

# Query: [Brief description]

## Results

- **Count**: [number] rows
- **Time**: [execution time]

## Sample Data

| Column1 | Column2 | Column3 |
| ------- | ------- | ------- |
| value   | value   | value   |

## Insights

- [Key insight 1]
- [Key insight 2]

## SQL

\```sql
[The actual query used]
\```
\```
````

### Error Reports

````markdown
## Error Report Template

\```markdown

## Error Summary

**Type**: [Error type]
**Location**: [File:line or component]
**Severity**: [Critical/High/Medium/Low]

## Description

[What went wrong]

## Steps to Reproduce

1. [Step 1]
2. [Step 2]
3. [Observe error]

## Expected Behavior

[What should happen]

## Actual Behavior

[What actually happened]

## Logs/Stack Trace

\```
[Relevant logs]
\```

## Fix Suggested

[Proposed solution]
\```
````

## Combining Templates with Other Patterns

### Template + Examples Pattern

````markdown
## Commit Message Format

**Template**:
\```
type(scope): brief description

Detailed explanation
\```

**Examples**:

\```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
\```

\```
fix(reports): correct date formatting

Use UTC timestamps consistently across report generation
\```
````

### Template + Workflow Pattern

````markdown
## Report Generation Workflow

1. **Gather data**: Query all relevant sources
2. **Analyze**: Identify patterns and insights
3. **Draft report** using this template:

\```markdown

# [Report Title]

...
\```

4. **Review**: Check against quality criteria
5. **Finalize**: Save as `report-YYYY-MM-DD.md`
````

## Testing Templates

Verify your template by checking:

1. **Can Claude fill it out?** Try with real data
2. **Is required content clear?** No ambiguity about what goes where
3. **Is it flexible enough?** Works for typical variations
4. **Is it strict enough?** Maintains needed consistency

## Common Mistakes

### Mistake 1: Template Too Complex

```markdown
❌ Bad:

# [Title matching pattern: Verb + Noun + Context + Date]

## Executive Summary (50-100 words, no more than 3 sentences...)

[Paragraph with specific structure: Problem + Solution + Impact]

## Background (Optional if... Multiple conditions)

...
```

**Fix**: Simplify

```markdown
✅ Good:

# [Analysis Title]

## Executive Summary

[One paragraph: key findings and impact]

## Background

[Include if context isn't obvious]
```

### Mistake 2: Template Too Vague

````markdown
❌ Bad:
\```
Put your report content here
Include the important parts
Organize it nicely
\```
````

**Fix**: Provide structure

````markdown
✅ Good:
\```markdown

# [Report Title]

## Summary

[Key findings in one paragraph]

## Details

[Supporting information]

## Recommendations

[Action items]
\```
````

### Mistake 3: No Examples

```markdown
❌ Bad:
Use this format:
type(scope): description

[body]
```

**Fix**: Show examples

```markdown
✅ Good:
**Template**: type(scope): description

**Example**:
feat(auth): add login endpoint

Implement JWT-based authentication with refresh tokens
```

## Checklist

- [ ] Template matches your consistency needs (strict vs flexible)
- [ ] Placeholders are clearly marked
- [ ] Required vs optional sections are indicated
- [ ] Examples show the template in use
- [ ] Template is simple enough to follow
- [ ] Template is specific enough to be useful
- [ ] Conditional content is explained
