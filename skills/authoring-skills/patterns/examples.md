# Examples Pattern

Provide concrete input/output examples to show desired style and level of detail.

## Table of Contents

- [When to Use](#when-to-use)
- [Basic Structure](#basic-structure)
- [Types of Examples](#types-of-examples)
- [Combining Examples with Templates](#combining-examples-with-templates)
- [How Many Examples?](#how-many-examples)
- [Making Examples Concrete](#making-examples-concrete)
- [Examples for Different Output Types](#examples-for-different-output-types)
- [Common Mistakes](#common-mistakes)
- [Checklist](#checklist)

## When to Use

- Output quality depends on seeing concrete examples
- Format or style needs to be specific
- Abstract descriptions aren't clear enough
- Multiple valid approaches exist but you prefer one style

## Basic Structure

````markdown
## [Task Name]

**Example 1**:
Input: [specific input]
Output:
\```
[specific output]
\```

**Example 2**:
Input: [specific input]
Output:
\```
[specific output]
\```

Follow this style for all outputs.
````

## Example: Commit Messages

````markdown
## Commit Message Format

Generate commit messages following these examples:

**Example 1: New Feature**
Input: Added user authentication with JWT tokens
Output:
\```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
\```

**Example 2: Bug Fix**
Input: Fixed bug where dates displayed incorrectly in reports
Output:
\```
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
\```

**Example 3: Refactoring**
Input: Updated dependencies and refactored error handling
Output:
\```
chore: update dependencies and refactor error handling

- Upgrade lodash to 4.17.21
- Standardize error response format across endpoints
  \```

Follow this style: type(scope): brief description, then detailed explanation.
````

## Example: Code Review Comments

````markdown
## Code Review Feedback Format

**Example 1: Critical Issue**
\```markdown
🔴 **Critical: SQL Injection Vulnerability**

Line 45: `query = f"SELECT * FROM users WHERE id = {user_id}"`

This is vulnerable to SQL injection. Use parameterized queries:

\`\`\`python
query = "SELECT \* FROM users WHERE id = %s"
cursor.execute(query, (user_id,))
\`\`\`
\```

**Example 2: Suggestion**
\```markdown
🟡 **Suggestion: Extract Complex Logic**

Lines 78-95: This function does too much. Consider extracting:

\`\`\`python
def validate_user_input(data): # Validation logic here
pass

def process_validated_data(data): # Processing logic here
pass
\`\`\`

This would improve testability and readability.
\```

**Example 3: Positive Feedback**
\```markdown
🟢 **Nice Work: Clean Error Handling**

Lines 120-135: Great job implementing comprehensive error handling with specific exception types and helpful error messages.
\```

Use these emoji indicators and structure for all feedback.
````

## Example: Data Analysis Output

````markdown
## Analysis Output Format

**Example 1: Sales Data**
Input: Analyze Q4 sales by region

Output:
\```markdown

# Q4 Sales Analysis by Region

## Summary

- **Total Sales**: $2.4M (↑15% vs Q3)
- **Top Region**: North America ($1.1M, 46%)
- **Fastest Growth**: Asia-Pacific (↑32% vs Q3)

## Regional Breakdown

| Region        | Q4 Sales | % of Total | vs Q3 |
| ------------- | -------- | ---------- | ----- |
| North America | $1.1M    | 46%        | ↑12%  |
| Europe        | $800K    | 33%        | ↑8%   |
| Asia-Pacific  | $500K    | 21%        | ↑32%  |

## Key Insights

- Asia-Pacific showing strong growth due to new market entry
- North America remains largest but growth slowing
- Europe steady, meeting expectations

## Recommendations

1. Increase investment in Asia-Pacific market
2. Investigate North America growth slowdown
3. Maintain current Europe strategy
   \```

**Example 2: User Engagement**
Input: Analyze daily active users trend

Output:
\```markdown

# Daily Active Users Analysis

## Summary

- **Current DAU**: 12,500 (↓3% vs last week)
- **7-Day Average**: 13,100
- **Peak**: 14,200 (Jan 15)

## Trend

\```
Week 1: 13,500 → Week 2: 13,100 → Week 3: 12,800 → Week 4: 12,500
\```

Downward trend over 4 weeks

## Contributing Factors

- Holiday season ended (expected seasonal drop)
- No new feature releases this month
- Increased competition from [Competitor X] launch

## Recommendations

1. Launch planned feature release next week
2. Run user re-engagement campaign
3. Monitor competitor activity
   \```

Follow this structure: Summary → Data → Insights → Recommendations
````

## Types of Examples

### Input/Output Pairs

```markdown
**Example 1**:
Input: Calculate revenue for January 2025
Output: $245,000

**Example 2**:
Input: Get top 5 customers by spend
Output:

- Acme Corp: $50K
- TechStart: $35K
- DataFlow: $28K
- CloudNet: $22K
- SysOps: $19K
```

### Before/After Examples

````markdown
**Example: Code Refactoring**

Before:
\```python
def process(data):
result = []
for i in range(len(data)):
if data[i] > 0 and data[i] < 100 and data[i] % 2 == 0:
result.append(data[i] \* 2)
return result
\```

After:
\```python
def process(data):
"""Double even numbers in range 0-100."""
return [
value * 2
for value in data
if 0 < value < 100 and value % 2 == 0
]
\```
````

### Good vs Bad Examples

````markdown
## Test Naming

**Good Examples**:
\```python
def test_login_fails_with_invalid_password():
def test_cart_total_includes_tax():
def test_email_validation_rejects_malformed_addresses():
\```

**Bad Examples**:
\```python
def test1():
def test_stuff():
def test_login(): # Too vague
\```
````

### Graduated Complexity

````markdown
## SQL Query Examples

**Simple** (single table):
\```sql
SELECT name, email
FROM users
WHERE status = 'active'
\```

**Medium** (join):
\```sql
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active'
GROUP BY u.id, u.name
\```

**Complex** (multiple joins, subquery):
\```sql
SELECT u.name, u.email, monthly_stats.total_orders, monthly_stats.total_revenue
FROM users u
JOIN (
SELECT user_id,
COUNT(\*) as total_orders,
SUM(amount) as total_revenue
FROM orders
WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY user_id
) monthly_stats ON u.id = monthly_stats.user_id
WHERE u.status = 'active'
AND monthly_stats.total_revenue > 1000
ORDER BY monthly_stats.total_revenue DESC
\```
````

## Combining Examples with Templates

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

\```
docs(api): update authentication section

Add examples for refresh token workflow
\```

Follow the template structure shown in examples.
````

## How Many Examples?

- **Minimum**: 2-3 examples
- **Ideal**: 3-5 examples
- **Too many**: 10+ examples (use progressive disclosure instead)

```markdown
## Core Examples

[3-5 essential examples here]

## Additional Examples

See [examples.md](examples.md) for more scenarios.
```

## Making Examples Concrete

**Too abstract**:

```markdown
Example:
Input: Some data
Output: Processed result
```

**Concrete**:

```markdown
Example:
Input: [1, 2, 3, 4, 5]
Output: [2, 4, 6, 8, 10]
```

**Realistic**:

```markdown
Example:
Input: User purchase history: [50, 75, 120, 30, 95]
Output: Total spend: $370, Average: $74, Max: $120
```

## Examples for Different Output Types

### Code Examples

````markdown
**Example: Error Handling**
\```python
try:
result = process_data(input_data)
except ValidationError as e:
logger.error(f"Invalid input: {e}")
return {"error": "Invalid data format", "details": str(e)}
except ProcessingError as e:
logger.error(f"Processing failed: {e}")
return {"error": "Processing failed", "retry": True}
\```
````

### Text Examples

````markdown
**Example: Email Response**
\```
Subject: Re: Your question about billing

Hi [Name],

Thanks for reaching out about your billing question.

[Direct answer to their question]

[Additional helpful context if needed]

Let me know if you have any other questions.

Best,
[Your name]
\```
````

### Data Examples

````markdown
**Example: JSON Response**
\```json
{
"status": "success",
"data": {
"user_id": 12345,
"name": "Jane Doe",
"email": "jane@example.com",
"role": "admin"
},
"timestamp": "2025-01-30T10:30:00Z"
}
\```
````

## Common Mistakes

### Mistake 1: Abstract Examples

```markdown
❌ Bad:
Example: Input some numbers, get results
```

**Fix**: Use concrete data

```markdown
✅ Good:
Example:
Input: [10, 20, 30, 40, 50]
Output: Sum: 150, Average: 30
```

### Mistake 2: No Context

````markdown
❌ Bad:
Example:
\```
feat: add feature
\```
````

**Fix**: Show input and output

````markdown
✅ Good:
Example:
Input: Added user profile page with avatar upload
Output:
\```
feat(profile): add user profile page with avatar upload

Implement profile view and avatar upload functionality

- Add profile route and component
- Integrate avatar upload with S3
- Add profile edit form
  \```
````

### Mistake 3: Examples Don't Match Template

````markdown
❌ Bad:
Template: type(scope): description

Example:
\```
Added new feature for users
\```
````

**Fix**: Match template

````markdown
✅ Good:
Template: type(scope): description

Example:
\```
feat(users): add profile page
\```
````

### Mistake 4: Only One Example

````markdown
❌ Bad:
Example:
\```
feat(auth): add login
\```
````

**Fix**: Show pattern with multiple examples

````markdown
✅ Good:
Example 1:
\```
feat(auth): add login endpoint
\```

Example 2:
\```
fix(api): handle timeout errors
\```

Example 3:
\```
docs(readme): update installation steps
\```
````

## Checklist

- [ ] At least 2-3 concrete examples
- [ ] Examples use realistic data
- [ ] Examples cover common scenarios
- [ ] Examples show consistent style
- [ ] Input and expected output are clear
- [ ] Examples match any provided templates
- [ ] Examples demonstrate range of use cases
- [ ] Not too many examples (use progressive disclosure if >5)
