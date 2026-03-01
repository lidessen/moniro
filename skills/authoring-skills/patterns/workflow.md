# Workflow Pattern

Break complex operations into clear, sequential steps. For particularly complex workflows, provide a checklist that Claude can copy and check off.

## Table of Contents

- [When to Use](#when-to-use)
- [Basic Workflow Structure](#basic-workflow-structure)
- [Workflow with Checklists](#workflow-with-checklists)
- [Workflow Elements](#workflow-elements)
- [Conditional Workflows](#conditional-workflows)
- [Workflows with Loops](#workflows-with-loops)
- [Workflows with Verification](#workflows-with-verification)
- [Parallel Steps](#parallel-steps)
- [Example: Complete Complex Workflow](#example-complete-complex-workflow)
- [Combining Workflows with Other Patterns](#combining-workflows-with-other-patterns)
- [Testing Workflows](#testing-workflows)
- [Common Mistakes](#common-mistakes)
- [Checklist](#checklist)

## When to Use

- Task has multiple sequential steps
- Order matters
- Steps depend on each other
- Easy to skip critical steps without guidance
- Progress tracking is helpful

## Basic Workflow Structure

```markdown
## [Workflow Name]

1. **Step 1 Name**: Brief description
2. **Step 2 Name**: Brief description
3. **Step 3 Name**: Brief description
4. **Step 4 Name**: Brief description
```

## Workflow with Checklists

For complex workflows, provide a copyable checklist:

````markdown
## [Workflow Name]

Copy this checklist and track your progress:

\```
Task Progress:

- [ ] Step 1: [Brief description]
- [ ] Step 2: [Brief description]
- [ ] Step 3: [Brief description]
- [ ] Step 4: [Brief description]
- [ ] Step 5: [Brief description]
      \```

**Step 1: [Name]**
[Detailed instructions for step 1]

**Step 2: [Name]**
[Detailed instructions for step 2]
````

## Example 1: Skills Without Code

**Research Synthesis Workflow**:

````markdown
## Research Synthesis Workflow

Copy this checklist and track your progress:

\```
Research Progress:

- [ ] Step 1: Read all source documents
- [ ] Step 2: Identify key themes
- [ ] Step 3: Cross-reference claims
- [ ] Step 4: Create structured summary
- [ ] Step 5: Verify citations
      \```

**Step 1: Read all source documents**

Review each document in the `sources/` directory. Note the main arguments and supporting evidence for each.

**Step 2: Identify key themes**

Look for patterns across sources:

- What themes appear repeatedly?
- Where do sources agree or disagree?
- What are the main areas of focus?

**Step 3: Cross-reference claims**

For each major claim:

- Verify it appears in the source material
- Note which source(s) support it
- Identify conflicting viewpoints if any

**Step 4: Create structured summary**

Organize findings by theme. For each theme include:

- Main claim
- Supporting evidence from sources (with citations)
- Conflicting viewpoints (if any)
- Your synthesis

**Step 5: Verify citations**

Check that:

- Every claim references the correct source
- Citation format is consistent
- No unsupported claims remain

If citations are incomplete, return to Step 3.
````

## Example 2: Skills With Code

**PDF Form Filling Workflow**:

````markdown
## PDF Form Filling Workflow

Copy this checklist and check off items as you complete them:

\```
Task Progress:

- [ ] Step 1: Analyze the form (run analyze_form.py)
- [ ] Step 2: Create field mapping (edit fields.json)
- [ ] Step 3: Validate mapping (run validate_fields.py)
- [ ] Step 4: Fill the form (run fill_form.py)
- [ ] Step 5: Verify output (run verify_output.py)
      \```

**Step 1: Analyze the form**

Run: `python scripts/analyze_form.py input.pdf`

This extracts form fields and their locations, saving to `fields.json`.

**Step 2: Create field mapping**

Edit `fields.json` to add values for each field:

\```json
{
"field_name": "value to insert",
"signature_date": "2025-01-30"
}
\```

**Step 3: Validate mapping**

Run: `python scripts/validate_fields.py fields.json`

This checks:

- All required fields have values
- Field types match expected types
- No unknown fields in mapping

Fix any validation errors before continuing.

**Step 4: Fill the form**

Run: `python scripts/fill_form.py input.pdf fields.json output.pdf`

**Step 5: Verify output**

Run: `python scripts/verify_output.py output.pdf`

This confirms all fields were filled correctly.

If verification fails, return to Step 2.
````

## Workflow Elements

### Clear Step Names

Use descriptive, action-oriented step names:

**Good**:

- "Analyze the form"
- "Create field mapping"
- "Validate mapping"

**Bad**:

- "Step 1"
- "Do stuff"
- "Process"

### Step Details

Each step should include:

- What to do
- How to do it (command, process, method)
- What the result should be
- What to do if it fails

**Example**:

```markdown
**Step 3: Validate configuration**

Run: `python scripts/validate_config.py config.json`

Expected output: "Configuration valid ✓"

If validation fails:

- Review error message
- Fix issues in config.json
- Run validation again
```

### Dependencies Between Steps

Make dependencies explicit:

```markdown
**Step 2: Process data**

**Prerequisites**: Step 1 must complete successfully

Process the extracted data...
```

Or use conditional flow:

```markdown
**Step 3: Error handling**

If Step 2 completed successfully:

- Proceed to Step 4

If Step 2 failed:

- Review logs at `logs/errors.log`
- Fix issues
- Return to Step 2
```

## Conditional Workflows

For workflows with branches:

```markdown
## Document Modification Workflow

1. **Determine the modification type**:

   **Creating new content?** → Follow "Creation workflow" below
   **Editing existing content?** → Follow "Editing workflow" below

2. **Creation workflow**:
   - Use docx-js library
   - Build document from scratch
   - Export to .docx format

3. **Editing workflow**:
   - Unpack existing document
   - Modify XML directly
   - Validate after each change
   - Repack when complete
```

## Workflows with Loops

For iterative workflows:

```markdown
## Data Processing Workflow

1. **Load data**: Read from input source
2. **Process batch**: Process current batch
3. **Validate results**: Run validation checks
4. **If validation fails**:
   - Log errors
   - Fix issues
   - Return to Step 2
5. **If validation passes**:
   - Save results
   - Load next batch
   - Return to Step 2
6. **Finalize**: Generate summary report
```

## Workflows with Verification

Include verification at critical points:

````markdown
## Deployment Workflow

\```
Deployment Progress:

- [ ] Step 1: Run tests locally
- [ ] Step 2: Build release package
- [ ] Step 3: Deploy to staging
- [ ] Step 4: Verify staging
- [ ] Step 5: Deploy to production
- [ ] Step 6: Verify production
      \```

**Step 1: Run tests locally**

\```bash
npm test
npm run lint
\```

**All tests must pass** before proceeding.

**Step 4: Verify staging**

Check:

- [ ] Application responds at staging URL
- [ ] Health check returns 200
- [ ] Key features work correctly
- [ ] No errors in logs

**Do not proceed to production if any checks fail.**
````

## Parallel Steps

Indicate when steps can run in parallel:

```markdown
## Data Collection Workflow

1. **Initialize**: Set up directories and configs

2. **Collect data** (can run in parallel):
   - Run: `python scripts/collect_api.py &`
   - Run: `python scripts/collect_db.py &`
   - Run: `python scripts/collect_files.py &`

3. **Wait for completion**: Check all processes finish

4. **Merge results**: Combine data from all sources
```

## Example: Complete Complex Workflow

````markdown
## Code Review Workflow

Copy this checklist:

\```
Review Progress:

- [ ] Step 1: Setup - Pull branch and run tests
- [ ] Step 2: Initial scan - Check file changes
- [ ] Step 3: Deep review - Examine code quality
- [ ] Step 4: Security check - Run security scan
- [ ] Step 5: Testing review - Verify test coverage
- [ ] Step 6: Documentation - Check documentation updates
- [ ] Step 7: Provide feedback - Write review comments
      \```

**Step 1: Setup**

Pull the branch and run tests:

\```bash
git fetch origin
git checkout feature-branch
npm install
npm test
\```

If tests fail, note for review comments.

**Step 2: Initial scan**

Check:

- Which files changed? `git diff main...HEAD --name-only`
- How many lines? `git diff main...HEAD --stat`
- Any generated files that shouldn't be committed?

**Step 3: Deep review**

For each changed file, check:

- [ ] Logic is correct and handles edge cases
- [ ] No security vulnerabilities
- [ ] Code follows project style
- [ ] Functions are appropriately sized
- [ ] Error handling is comprehensive

**Step 4: Security check**

Run: `npm run security-scan`

Note any security issues for feedback.

**Step 5: Testing review**

Check:

- [ ] New features have tests
- [ ] Tests cover edge cases
- [ ] Test names are descriptive
- [ ] No tests were removed without reason

Run: `npm run coverage` to check coverage percentage.

**Step 6: Documentation**

Check:

- [ ] Public APIs are documented
- [ ] README updated if needed
- [ ] Comments explain "why" not "what"
- [ ] No commented-out code

**Step 7: Provide feedback**

Use the code review template to provide feedback:

- Organize by priority (critical, suggestions, nice-to-have)
- Reference specific line numbers
- Explain why each issue matters
- Note positive aspects

Post review on GitHub/GitLab.
````

## Combining Workflows with Other Patterns

### Workflow + Feedback Loop

```markdown
## Document Editing Workflow

1. Make your edits
2. **Validate immediately**: `python validate.py`
3. If validation fails:
   - Review error message
   - Fix issues
   - Return to Step 2
4. **Only proceed when validation passes**
5. Save final document
```

### Workflow + Template

```markdown
## Report Generation Workflow

1. **Gather data**: Query all sources
2. **Analyze**: Identify patterns
3. **Draft report** using template from [template.md](template.md)
4. **Review**: Check quality criteria
5. **Finalize**: Save as `report-YYYY-MM-DD.md`
```

## Testing Workflows

Verify your workflow by:

1. **Walking through it yourself**: Does each step make sense?
2. **Checking dependencies**: Are prerequisites clear?
3. **Testing with Claude**: Does Claude follow steps correctly?
4. **Looking for skipped steps**: Are critical steps obvious and hard to skip?

## Common Mistakes

### Mistake 1: Steps Too Vague

```markdown
❌ Bad:

1. Prepare the data
2. Process everything
3. Generate output
```

**Fix**: Be specific

```markdown
✅ Good:

1. **Load data**: Read from `data/input.csv`
2. **Clean data**: Remove rows with missing values
3. **Transform**: Apply transformations from `config.json`
4. **Export**: Save to `data/output.csv`
```

### Mistake 2: Missing Verification

```markdown
❌ Bad:

1. Make changes
2. Deploy to production
```

**Fix**: Add verification

```markdown
✅ Good:

1. Make changes
2. Run tests: `npm test`
3. Deploy to staging
4. Verify staging works
5. Deploy to production
6. Verify production works
```

### Mistake 3: No Error Handling

```markdown
❌ Bad:

1. Run script A
2. Run script B
3. Run script C
```

**Fix**: Add error handling

```markdown
✅ Good:

1. Run script A
2. If script A fails, check logs and fix before continuing
3. Run script B
4. If script B fails, rollback script A changes
5. Run script C
```

## Checklist

- [ ] Steps are in logical order
- [ ] Each step has clear name
- [ ] Step details include what, how, and expected result
- [ ] Dependencies between steps are explicit
- [ ] Verification points at critical steps
- [ ] Error handling is included
- [ ] Checklist provided for complex workflows
- [ ] Conditional branches are clear
