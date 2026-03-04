# Degrees of Freedom: Setting Appropriate Specificity

Match the level of specificity to your task's fragility and variability.

**The analogy**: Think of Claude as a robot exploring a path:

- **Narrow bridge with cliffs** → Low freedom (specific instructions)
- **Open field with no hazards** → High freedom (general guidance)

## Table of Contents

- [The Spectrum](#the-spectrum)
- [High Freedom: Text-Based Instructions](#high-freedom-text-based-instructions)
- [Medium Freedom: Pseudocode or Templates](#medium-freedom-pseudocode-or-templates)
- [Low Freedom: Specific Scripts](#low-freedom-specific-scripts)
- [Choosing the Right Level](#choosing-the-right-level)
- [Mixing Freedom Levels](#mixing-freedom-levels)
- [Examples by Task Type](#examples-by-task-type)
- [Red Flags](#red-flags)
- [Testing Your Freedom Level](#testing-your-freedom-level)
- [The Trade-Off](#the-trade-off)

## The Spectrum

| Freedom    | Format               | When to Use                                  | Example Tasks                      |
| ---------- | -------------------- | -------------------------------------------- | ---------------------------------- |
| **High**   | Text instructions    | Multiple valid approaches, context-dependent | Code reviews, analysis             |
| **Medium** | Pseudocode/templates | Preferred pattern, some variation OK         | Report generation, data processing |
| **Low**    | Specific scripts     | Fragile operations, consistency critical     | Database migrations, deployments   |

## High Freedom: Text-Based Instructions

**When to use**:

- Multiple approaches are valid
- Decisions depend on context
- Heuristics guide the approach
- Creativity is valuable

**Example: Code Review**

```markdown
## Code Review Process

1. Analyze code structure and organization
2. Check for potential bugs or edge cases
3. Suggest improvements for readability and maintainability
4. Verify adherence to project conventions
5. Assess test coverage and quality
```

**Why high freedom**:

- Code quality is contextual
- Multiple improvements might be valid
- Trade-offs depend on the specific code
- Reviews benefit from Claude's judgment

**Example: Content Analysis**

```markdown
## Research Synthesis

1. Read all source documents
2. Identify key themes across sources
3. Note where sources agree or disagree
4. Synthesize findings into coherent narrative
5. Cite sources for major claims
```

## Medium Freedom: Pseudocode or Templates

**When to use**:

- A preferred pattern exists
- Some variation is acceptable
- Configuration affects behavior
- Structure is helpful but not rigid

**Example: Report Generation**

````markdown
## Generate Report

Use this template and customize as needed:

\```python
def generate_report(data, format="markdown", include_charts=True): # Process data
summary = analyze_data(data)

    # Generate output in specified format
    if format == "markdown":
        output = create_markdown_report(summary)
    elif format == "html":
        output = create_html_report(summary)

    # Optionally include visualizations
    if include_charts:
        output = add_charts(output, data)

    return output

\```

Adjust parameters and processing logic based on requirements.
````

**Example: API Client**

````markdown
## API Client Usage

Standard pattern:

\```python
client = APIClient(
base_url="https://api.example.com",
auth_token=token,
timeout=30, # Adjust for slow endpoints
retry_count=3 # Adjust for reliability needs
)

response = client.get("/endpoint", params={...})
\```

Adjust timeout and retry_count based on endpoint behavior.
````

## Low Freedom: Specific Scripts

**When to use**:

- Operations are fragile and error-prone
- Consistency is critical
- A specific sequence must be followed
- Errors have serious consequences

**Example: Database Migration**

````markdown
## Database Migration

Run exactly this script:

\```bash
python scripts/migrate.py --verify --backup
\```

**Do not**:

- Modify the command
- Add additional flags
- Skip the --verify flag
- Skip the --backup flag

The script handles all verification and rollback logic.
````

**Why low freedom**:

- Database migrations are fragile
- Order of operations is critical
- Backup is mandatory
- Wrong approach causes data loss

**Example: Production Deployment**

````markdown
## Deploy to Production

Execute this exact sequence:

\```bash

# 1. Verify all tests pass

./scripts/run_tests.sh

# 2. Create deployment package

./scripts/build_release.sh v1.2.3

# 3. Deploy to blue environment

./scripts/deploy.sh --env blue --version v1.2.3

# 4. Run smoke tests

./scripts/smoke_tests.sh --env blue

# 5. Switch traffic

./scripts/switch_traffic.sh --to blue --gradual
\```

**Do not**:

- Skip steps
- Change the order
- Modify parameters
- Deploy directly to production
````

## Choosing the Right Level

Ask these questions:

### Is there one clearly correct approach?

- **Yes** → Low freedom (specific script/commands)
- **No** → High freedom (text guidance)
- **Mostly, with variations** → Medium freedom (template)

### What happens if Claude makes a mistake?

- **Serious consequences** → Low freedom
- **Minor, easily fixable** → High freedom
- **Moderate impact** → Medium freedom

### How much context is needed for good decisions?

- **Lots of context** → High freedom (let Claude analyze)
- **Fixed rules** → Low freedom (remove decisions)
- **Some context** → Medium freedom (guided decisions)

### Will the approach vary significantly?

- **Rarely** → Low freedom (standardize it)
- **Always** → High freedom (provide principles)
- **Sometimes** → Medium freedom (provide template with parameters)

## Mixing Freedom Levels

Often skills need multiple levels for different operations:

````markdown
# Code Review

## Review Process (High Freedom)

1. Analyze code structure
2. Check for bugs
3. Suggest improvements
4. Verify conventions

## Running Checks (Low Freedom)

Run exactly:
\```bash
./scripts/lint.sh
./scripts/test.sh
./scripts/security_scan.sh
\```

## Writing Feedback (Medium Freedom)

Use this template:

**Critical Issues**: [Issues that must be fixed]
**Suggestions**: [Nice-to-have improvements]
**Positive Notes**: [What was done well]
````

## Examples by Task Type

### High Freedom Tasks

- Code reviews
- Research synthesis
- Content analysis
- Architecture design
- Problem debugging
- Requirements analysis

### Medium Freedom Tasks

- Report generation
- Data processing scripts
- API client usage
- Test writing
- Documentation structure
- Configuration files

### Low Freedom Tasks

- Database migrations
- Production deployments
- Security operations
- Data deletion
- System configuration
- Critical file operations

## Red Flags

### Too Much Freedom

```markdown
## Deploy to Production

Deploy the application to production when ready.
```

**Problem**: No guidance for critical operation. Needs low freedom with specific steps.

### Too Little Freedom

````markdown
## Write Code

\```python
def process_data(data):
result = []
for item in data:
result.append(item \* 2)
return result
\```

Use exactly this code.
````

**Problem**: Over-specified for a simple, flexible task. Needs high freedom with general guidance.

## Testing Your Freedom Level

1. **Give the skill to Claude** on a representative task
2. **Observe the results**:
   - Does Claude make good decisions? → Freedom level might be appropriate
   - Does Claude make errors you could prevent? → Need lower freedom
   - Does Claude ask for more flexibility? → Need higher freedom
3. **Iterate based on real usage**

## The Trade-Off

**Lower freedom** = More consistency, less flexibility
**Higher freedom** = More flexibility, requires more Claude judgment

Choose based on:

- Task fragility
- Consequence of errors
- Need for consistency
- Availability of good heuristics
