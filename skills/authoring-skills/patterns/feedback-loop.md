# Feedback Loop Pattern

Implement validation loops for quality-critical tasks. The pattern: create → validate → fix errors → repeat.

## Table of Contents

- [When to Use](#when-to-use)
- [Core Pattern](#core-pattern)
- [Key Elements](#key-elements)
- [Pattern Variations](#pattern-variations)
- [Feedback Loop with Workflow Pattern](#feedback-loop-with-workflow-pattern)
- [Validation Script Best Practices](#validation-script-best-practices)
- [Testing Feedback Loops](#testing-feedback-loops)
- [Common Mistakes](#common-mistakes)
- [Checklist](#checklist)

## When to Use

- Errors are costly or hard to undo
- Quality requirements are strict
- Validation can be automated
- Early error detection saves time
- Output must meet specific criteria

## Core Pattern

```markdown
1. Create/modify content
2. Validate immediately
3. If validation fails:
   - Review errors
   - Fix issues
   - Return to step 2
4. Only proceed when validation passes
```

## Example 1: Without Code (Style Guide Compliance)

```markdown
## Content Review Process

1. **Draft content** following guidelines in [STYLE_GUIDE.md](STYLE_GUIDE.md)

2. **Review against checklist**:
   - [ ] Terminology is consistent with style guide
   - [ ] Examples follow standard format
   - [ ] All required sections are present
   - [ ] Tone matches style guide
   - [ ] No prohibited phrases used

3. **If issues found**:
   - Note each issue with specific section reference
   - Revise the content
   - Return to step 2 (review again)

4. **Only proceed when all requirements met**

5. **Finalize and save** the document
```

## Example 2: With Code (Document Editing)

````markdown
## Document Editing Process

1. **Make your edits** to `word/document.xml`

2. **Validate immediately**:
   \```bash
   python ooxml/scripts/validate.py unpacked_dir/
   \```

3. **If validation fails**:
   - Review the error message carefully
   - Fix the issues in the XML
   - Run validation again (return to step 2)

4. **Only proceed when validation passes**

5. **Rebuild document**:
   \```bash
   python ooxml/scripts/pack.py unpacked_dir/ output.docx
   \```

6. **Test the output** - open and verify
````

## Key Elements

### 1. Immediate Validation

Validate right after the action, not at the end:

**Good**:

```markdown
1. Make changes to config.json
2. **Validate immediately**: `python validate_config.py`
3. Fix any errors
4. Continue to next step
```

**Bad**:

```markdown
1. Make changes to config.json
2. Make changes to other files
3. Make more changes
4. Finally validate everything # Too late!
```

### 2. Clear Error Feedback

Make validation errors actionable:

**Good**:

```bash
$ python validate.py
ERROR: Field 'email' has invalid format on line 45
ERROR: Missing required field 'user_id' in record 3
SUGGESTION: Use ISO8601 format for 'created_at' field
```

**Bad**:

```bash
$ python validate.py
Error: validation failed
```

### 3. Explicit Return Path

Make it clear to return to validation:

```markdown
3. **If validation fails**:
   - Review error message
   - Fix the issues
   - **Run validation again** ← explicit
```

### 4. Gate to Next Step

Only proceed when validation passes:

```markdown
4. **Only proceed when validation passes**

5. Next step (deployment, publishing, etc.)
```

## Pattern Variations

### Variation 1: Progressive Validation

Validate in stages:

````markdown
## Multi-Stage Validation

1. **Edit configuration**

2. **Syntax validation**:
   \```bash
   python validate_syntax.py config.json
   \```
   Fix syntax errors before proceeding.

3. **Semantic validation**:
   \```bash
   python validate_logic.py config.json
   \```
   Fix logical errors before proceeding.

4. **Integration test**:
   \```bash
   python test_integration.py config.json
   \```
   Fix integration issues before proceeding.

5. **Deploy configuration**
````

### Variation 2: Automated Fix Attempts

Try automatic fixes first:

````markdown
## Code Formatting Workflow

1. **Write code**

2. **Run linter**:
   \```bash
   npm run lint
   \```

3. **If linter finds issues**:
   - Try auto-fix: `npm run lint:fix`
   - Review changes made by auto-fix
   - Manually fix remaining issues
   - Run linter again

4. **Only proceed when linter passes**
````

### Variation 3: Validation with Metrics

Include quality metrics:

````markdown
## Test Coverage Workflow

1. **Write tests for new feature**

2. **Run tests and check coverage**:
   \```bash
   npm test
   npm run coverage
   \```

3. **If coverage < 80%**:
   - Identify uncovered lines (check coverage report)
   - Write tests for uncovered code
   - Run tests again

4. **Only proceed when coverage ≥ 80%**
````

## Feedback Loop with Workflow Pattern

Integrate into larger workflows:

````markdown
## Database Migration Workflow

\```
Migration Progress:

- [ ] Step 1: Write migration script
- [ ] Step 2: Validate syntax
- [ ] Step 3: Test on development database
- [ ] Step 4: Validate results
- [ ] Step 5: Run on staging
- [ ] Step 6: Validate staging
- [ ] Step 7: Run on production
- [ ] Step 8: Validate production
      \```

**Step 1: Write migration script**
Create migration in `migrations/` directory.

**Step 2: Validate syntax**
\```bash
python scripts/validate_migration.py migrations/001_new_migration.sql
\```

**If validation fails**: Fix errors and return to Step 2.

**Step 3: Test on development database**
\```bash
python scripts/run_migration.py --env dev --migration 001
\```

**Step 4: Validate results**
\```bash
python scripts/validate_schema.py --env dev
python scripts/validate_data.py --env dev
\```

**If validation fails**:

- Rollback: `python scripts/rollback.py --env dev --migration 001`
- Fix migration script
- Return to Step 2

**Only proceed to staging when dev validation passes.**
````

## Example: Plan-Validate-Execute Pattern

For complex, open-ended tasks:

````markdown
## Batch Update Workflow

**Use this pattern for updating multiple records/files:**

**Phase 1: Plan**

1. Create changes plan: `changes.json`
   \```json
   {
   "record_1": {"field": "new_value"},
   "record_2": {"field": "new_value"}
   }
   \```

**Phase 2: Validate Plan** 2. Validate the plan:
\```bash
python scripts/validate_changes.py changes.json
\```

Checks:

- All record IDs exist
- All fields are valid
- No conflicts
- Required fields present

3. **If validation fails**:
   - Review error messages
   - Fix `changes.json`
   - Return to step 2

**Phase 3: Execute** 4. **Only execute when plan validates**:
\```bash
python scripts/apply_changes.py changes.json
\```

**Phase 4: Verify** 5. Verify results:
\```bash
python scripts/verify_changes.py changes.json
\```

6. **If verification fails**:
   - Rollback: `python scripts/rollback.py`
   - Review issues
   - Return to Phase 1
````

## Validation Script Best Practices

When creating validation scripts for feedback loops:

### 1. Verbose Error Messages

**Good**:

```python
def validate_fields(data):
    errors = []

    if 'user_id' not in data:
        errors.append("Missing required field 'user_id'")

    if 'email' in data and not is_valid_email(data['email']):
        errors.append(
            f"Invalid email format: '{data['email']}'. "
            f"Expected format: user@domain.com"
        )

    if errors:
        print("Validation failed:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)
    else:
        print("Validation passed ✓")
```

**Bad**:

```python
def validate_fields(data):
    assert 'user_id' in data
    assert is_valid_email(data['email'])
    # No helpful error messages
```

### 2. Exit Codes

Use proper exit codes:

```python
# Validation passed
sys.exit(0)

# Validation failed
sys.exit(1)
```

### 3. List All Errors

Don't fail on first error - show all errors:

**Good**:

```python
errors = []
# Collect all errors
if condition1: errors.append("Error 1")
if condition2: errors.append("Error 2")
if condition3: errors.append("Error 3")

# Report all at once
if errors:
    for error in errors:
        print(f"ERROR: {error}")
    sys.exit(1)
```

**Bad**:

```python
# Fails on first error only
if condition1:
    print("Error 1")
    sys.exit(1)
# User never sees other errors
```

## Testing Feedback Loops

Verify your feedback loop by:

1. **Introduce an error** - Does validation catch it?
2. **Check error message** - Is it clear how to fix?
3. **Fix and revalidate** - Does it pass now?
4. **Try to skip validation** - Is it clear validation is mandatory?

## Common Mistakes

### Mistake 1: Validation Too Late

```markdown
❌ Bad:

1. Make 10 changes
2. Finally validate

# Hard to find which change caused error
```

**Fix**: Validate after each change

```markdown
✅ Good:

1. Make change 1 → Validate
2. Make change 2 → Validate
3. Make change 3 → Validate
```

### Mistake 2: No Clear Fix Path

```markdown
❌ Bad: 2. Validate 3. If fails, try to fix somehow 4. Move on
```

**Fix**: Explicit return to validation

```markdown
✅ Good: 2. Validate 3. If fails:

- Fix issues
- **Return to step 2 (validate again)**

4. Only proceed when validation passes
```

### Mistake 3: Weak Gate

```markdown
❌ Bad: 3. If validation fails, note the errors 4. Continue anyway
```

**Fix**: Strong gate

```markdown
✅ Good: 3. If validation fails, fix and revalidate 4. **Only proceed when validation passes**
```

### Mistake 4: Vague Validation

````markdown
❌ Bad:
\```bash
$ python validate.py
Failed
\```
````

**Fix**: Specific errors

````markdown
✅ Good:
\```bash
$ python validate.py
ERROR: Invalid email format on line 45: 'userexample.com'
ERROR: Missing required field 'created_at' in record 3
FAILED: 2 errors found
\```
````

## Checklist

- [ ] Validation happens immediately after creation/modification
- [ ] Validation errors are specific and actionable
- [ ] Clear path to return to validation after fixes
- [ ] Strong gate - must pass validation to proceed
- [ ] Validation script lists all errors, not just first
- [ ] Validation script has helpful error messages
- [ ] Validation script uses proper exit codes
- [ ] User knows what to do when validation fails
