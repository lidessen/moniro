# The Conciseness Principle

**Core idea**: Assume Claude is already very smart. Only add context Claude doesn't already have.

Every token in your skill competes with conversation history and other context. Once Claude loads SKILL.md, every word matters.

## Table of Contents

- [The Challenge Test](#the-challenge-test)
- [Good vs Bad Examples](#good-vs-bad-examples)
- [What to Assume Claude Knows](#what-to-assume-claude-knows)
- [Patterns for Conciseness](#patterns-for-conciseness)
- [Progressive Disclosure for Conciseness](#progressive-disclosure-for-conciseness)
- [Red Flags: Signs You're Being Too Verbose](#red-flags-signs-youre-being-too-verbose)
- [The 50% Rule](#the-50-rule)
- [Testing Conciseness](#testing-conciseness)
- [When Verbosity Is OK](#when-verbosity-is-ok)
- [Checklist](#checklist)

## The Challenge Test

Before including any explanation, ask:

1. "Does Claude really need this explanation?"
2. "Can I assume Claude knows this?"
3. "Does this paragraph justify its token cost?"

## Good vs Bad Examples

### Example 1: PDF Extraction

**Good - Concise** (~50 tokens):

````markdown
## Extract PDF text

Use pdfplumber for text extraction:

\```python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
text = pdf.pages[0].extract_text()
\```
````

**Bad - Verbose** (~150 tokens):

```markdown
## Extract PDF text

PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need to
use a library. There are many libraries available for PDF processing, but we
recommend pdfplumber because it's easy to use and handles most cases well.
First, you'll need to install it using pip. Then you can use the code below...
```

**Why good is better**:

- Assumes Claude knows what PDFs are
- Assumes Claude knows how Python imports work
- Assumes Claude knows how to install packages
- Gets straight to the essential information

### Example 2: Database Queries

**Good - Concise**:

```markdown
## Query Finance Data

Revenue tables: `revenue_daily`, `revenue_monthly`
Key fields: `amount`, `date`, `region`, `customer_id`

Always filter: `WHERE is_test = false`
```

**Bad - Verbose**:

```markdown
## Query Finance Data

Our company uses BigQuery to store financial data. The finance dataset contains
several tables that track different aspects of our revenue. The main table for
daily revenue tracking is called revenue_daily, and we also have a monthly
aggregation table called revenue_monthly. When you query these tables, you'll
find that they contain various fields, including amount (which is the revenue
in USD), date (when the revenue was recorded), region (geographic region), and
customer_id (unique identifier for customers). It's important to note that our
database contains test data, so you should always remember to filter it out by
adding WHERE is_test = false to your queries.
```

**Why good is better**:

- Presents facts directly without preamble
- Lists over explains
- Gets to the critical rule (filter test data) immediately
- Saves ~150 tokens

### Example 3: Code Review Standards

**Good - Concise**:

```markdown
## Review Checklist

- Functions max 50 lines
- Max cyclomatic complexity: 10
- All public functions documented
- No hardcoded credentials
- Test coverage >80%
```

**Bad - Verbose**:

```markdown
## Review Checklist

When reviewing code, you should check several important things. First, look at
function length. Functions should generally be kept short for readability and
maintainability. Our team standard is a maximum of 50 lines per function.
Second, check cyclomatic complexity, which measures code complexity through
the number of paths. We limit this to 10. Third, make sure all public-facing
functions have documentation...
```

**Why good is better**:

- Assumes Claude knows what function length/complexity mean
- Presents standards as facts, not educational content
- Saves ~100 tokens

## What to Assume Claude Knows

### Technical Concepts ✓

- Common file formats (PDF, JSON, CSV, etc.)
- Programming concepts (functions, variables, loops)
- Standard tools (git, npm, pip)
- Common patterns (CRUD, REST, authentication)
- Industry terms (API, database, deployment)

### Your Domain ✗

- Your specific table schemas
- Your team's coding standards
- Your custom workflows
- Your business rules
- Your internal tool names

## Patterns for Conciseness

### Pattern 1: Lists Over Paragraphs

**Verbose**:

```markdown
When analyzing data, you should first check the data quality, then clean any
missing values, after that normalize the formats, and finally run validation.
```

**Concise**:

```markdown
## Data Analysis Steps

1. Check data quality
2. Clean missing values
3. Normalize formats
4. Run validation
```

### Pattern 2: Code Over Explanation

**Verbose**:

```markdown
To create a new document, you'll need to import the library, then create a
document object by instantiating the Document class, then add content using
the add_paragraph method, and finally save it with the save method.
```

**Concise**:

````markdown
## Create Document

\```python
from docx import Document

doc = Document()
doc.add_paragraph("Content")
doc.save("output.docx")
\```
````

### Pattern 3: Direct Rules

**Verbose**:

```markdown
It's important to remember that when you're working with our production
database, you should always make sure to exclude test accounts. We identify
test accounts with the is_test field, which is set to true for test accounts.
```

**Concise**:

```markdown
**Production queries**: Always filter `WHERE is_test = false`
```

### Pattern 4: Examples Without Preamble

**Verbose**:

```markdown
Here's an example of how you might write a good commit message following
our conventions:
```

**Concise**:

```markdown
**Example commit**:
```

## Progressive Disclosure for Conciseness

Don't repeat information. Use references:

**Bad - Repetitive**:

```markdown
# API Usage

## Authentication

[200 lines of authentication details]

## Endpoints

[300 lines of endpoint documentation]

## Error Handling

[200 lines of error handling]
```

**Good - Progressive**:

````markdown
# API Usage

## Quick Start

\```python
api = API(token=TOKEN)
result = api.get("/users")
\```

## Details

- **Authentication**: See [auth.md](auth.md)
- **All endpoints**: See [endpoints.md](endpoints.md)
- **Error handling**: See [errors.md](errors.md)
````

## Red Flags: Signs You're Being Too Verbose

Watch for these phrases that often signal unnecessary verbosity:

- "It's important to note that..."
- "You should remember to..."
- "First, you'll need to..."
- "As you can see..."
- "This is because..."
- "In order to..."
- "You may want to..."
- "Please note..."

**Often these can be deleted entirely or replaced with direct statements.**

### Example Transformations

❌ "It's important to note that all queries must filter test data"
✅ "Filter: `WHERE is_test = false`"

❌ "You should remember to validate the form before submitting"
✅ "Validate before submit: `python validate.py`"

❌ "First, you'll need to install the dependencies"
✅ "Install: `npm install`"

## The 50% Rule

After writing your skill, try to cut it by 50%. This forces you to:

- Remove obvious explanations
- Replace paragraphs with lists
- Replace explanations with code
- Move detailed content to reference files

## Testing Conciseness

1. **Read your skill to a knowledgeable colleague** - Do they roll their eyes at obvious explanations?
2. **Count your tokens** - Can you convey the same information in fewer tokens?
3. **Check for repeated context** - Are you explaining the same concept multiple times?

## When Verbosity Is OK

Sometimes more words are necessary:

### 1. Novel or Complex Workflows

If your workflow is unusual, explain it:

```markdown
## Deployment Process

Our deployment requires a unique sequence:

1. Deploy to blue environment
2. Run smoke tests
3. Gradual traffic shift (10%, 50%, 100%)
4. Monitor for 1 hour at each step
5. Auto-rollback if error rate >0.1%

This differs from standard deployments because [brief explanation of why].
```

### 2. Critical Rules with Context

When a rule is critical and non-obvious, provide context:

````markdown
## Database Queries

**ALWAYS join with the `accounts` table** to filter for active customers:

\```sql
FROM orders o
JOIN accounts a ON o.account_id = a.id
WHERE a.status = 'active'
\```

**Why**: Soft-deleted customers remain in `orders` table for compliance.
````

### 3. Disambiguation

When terms could be confused:

```markdown
## Document Fields

**field**: Form field in PDF (e.g., text input, checkbox)
**attribute**: XML attribute in document structure

Don't confuse these - they're used differently.
```

## Checklist

Before finalizing your skill:

- [ ] Removed explanations of common concepts
- [ ] Used lists instead of paragraphs where possible
- [ ] Replaced explanations with code examples
- [ ] Removed filler phrases ("it's important to note", etc.)
- [ ] Checked for repeated information
- [ ] Used progressive disclosure for detailed content
- [ ] Assumed Claude is smart and knowledgeable
- [ ] Every sentence serves a clear purpose
