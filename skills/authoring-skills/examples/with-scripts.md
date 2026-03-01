# Example: Skill with Scripts

This example shows a skill that includes utility scripts for validation and automation.

## Table of Contents

- [Use Case](#use-case)
- [Directory Structure](#directory-structure)
- [SKILL.md](#skillmd)
- [Scripts](#scripts)
  - [scripts/validate.py](#scriptsvalidatepy)
  - [scripts/unpack.py](#scriptsunpackpy)
  - [scripts/pack.py](#scriptspackpy)
- [Why Include Scripts](#why-include-scripts)
- [Token Efficiency](#token-efficiency)
- [How Claude Uses This Skill](#how-claude-uses-this-skill)
- [Feedback Loop Demonstration](#feedback-loop-demonstration)
- [When to Include Scripts](#when-to-include-scripts)

## Use Case

A skill for editing DOCX files with validation to catch errors early.

## Directory Structure

```
docx-editing/
├── SKILL.md
├── reference/
│   ├── ooxml-structure.md
│   └── common-elements.md
└── scripts/
    ├── validate.py
    ├── unpack.py
    └── pack.py
```

## SKILL.md

````markdown
---
name: docx-editing
description: Edit DOCX files by modifying OOXML structure, with validation. Use when editing Word documents, modifying .docx files, or when the user mentions document editing with specific requirements.
---

# DOCX Editing

## Quick Start

Edit DOCX files in 5 steps:

1. **Unpack** DOCX to XML
2. **Edit** XML files
3. **Validate** immediately
4. **Pack** back to DOCX
5. **Test** the output

## Workflow

\```
Edit Progress:

- [ ] Step 1: Unpack DOCX
- [ ] Step 2: Make edits to XML
- [ ] Step 3: Validate changes
- [ ] Step 4: Pack to DOCX
- [ ] Step 5: Verify output
      \```

### Step 1: Unpack DOCX

\```bash
python scripts/unpack.py input.docx output_dir/
\```

This extracts DOCX contents into directory structure:
\```
output_dir/
├── word/
│ ├── document.xml # Main document content
│ ├── styles.xml # Styles
│ └── ...
├── \_rels/
└── [Content_Types].xml
\```

### Step 2: Make Edits

Edit `output_dir/word/document.xml` for content changes.

See [reference/ooxml-structure.md](reference/ooxml-structure.md) for XML structure details.

**Common edits**:

- Text content: Modify `<w:t>` elements
- Paragraphs: Edit `<w:p>` elements
- Tables: Modify `<w:tbl>` elements

### Step 3: Validate Immediately

**Critical**: Validate after each edit:

\```bash
python scripts/validate.py output_dir/
\```

The validator checks:

- XML is well-formed
- Required elements present
- Relationships are valid
- No broken references

**If validation fails**:

- Review error message carefully
- Fix the issues in XML
- **Run validation again**
- Do not proceed until validation passes

### Step 4: Pack to DOCX

**Only after validation passes**:

\```bash
python scripts/pack.py output_dir/ output.docx
\```

### Step 5: Verify Output

Open `output.docx` and verify:

- Document opens without errors
- Edits appear correctly
- Formatting is preserved

## Common Editing Patterns

### Add Paragraph

\```xml
<w:p>
<w:r>
<w:t>Your text here</w:t>
</w:r>
</w:p>
\```

### Add Bold Text

\```xml
<w:p>
<w:r>
<w:rPr>
<w:b/>
</w:rPr>
<w:t>Bold text</w:t>
</w:r>
</w:p>
\```

### Add Table

\```xml
<w:tbl>
<w:tr>
<w:tc>
<w:p>
<w:r>
<w:t>Cell 1</w:t>
</w:r>
</w:p>
</w:tc>
<w:tc>
<w:p>
<w:r>
<w:t>Cell 2</w:t>
</w:r>
</w:p>
</w:tc>
</w:tr>
</w:tbl>
\```

## Reference

**OOXML Structure**: [reference/ooxml-structure.md](reference/ooxml-structure.md)
**Common Elements**: [reference/common-elements.md](reference/common-elements.md)

## Important Rules

1. **Always validate** after editing
2. **Don't skip validation** - it catches errors early
3. **Fix errors immediately** - don't accumulate issues
4. **Test output** - open the file and verify

## Troubleshooting

### Validation Fails with "Invalid XML"

- Check XML is well-formed
- Ensure all tags are properly closed
- Verify no special characters need escaping

### Document Won't Open

- Run validation again
- Check for broken relationship references
- Verify Content_Types.xml is correct

### Changes Don't Appear

- Check you edited the right file (document.xml)
- Verify XML structure is correct
- Make sure validation passed
````

## scripts/validate.py

```python
#!/usr/bin/env python3
"""
Validate unpacked DOCX directory structure and XML content.
"""

import sys
import os
import xml.etree.ElementTree as ET
from pathlib import Path

def validate_directory_structure(base_path):
    """Validate required directories and files exist."""
    errors = []

    required_files = [
        'word/document.xml',
        '[Content_Types].xml',
        '_rels/.rels'
    ]

    for file_path in required_files:
        full_path = base_path / file_path
        if not full_path.exists():
            errors.append(f"Missing required file: {file_path}")

    return errors

def validate_xml_files(base_path):
    """Validate XML files are well-formed."""
    errors = []

    xml_files = list(base_path.rglob('*.xml')) + list(base_path.rglob('*.rels'))

    for xml_file in xml_files:
        try:
            ET.parse(xml_file)
        except ET.ParseError as e:
            errors.append(f"Invalid XML in {xml_file.relative_to(base_path)}: {e}")

    return errors

def validate_relationships(base_path):
    """Validate relationship references are valid."""
    errors = []

    # Check main document relationships
    rels_file = base_path / 'word' / '_rels' / 'document.xml.rels'
    if rels_file.exists():
        try:
            tree = ET.parse(rels_file)
            root = tree.getroot()

            for rel in root.findall('.//{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'):
                target = rel.get('Target')
                if target and not target.startswith('http'):
                    # Internal reference - check file exists
                    target_path = base_path / 'word' / target
                    if not target_path.exists():
                        errors.append(f"Broken relationship: {target} not found")
        except ET.ParseError:
            # Already caught in validate_xml_files
            pass

    return errors

def main():
    if len(sys.argv) != 2:
        print("Usage: python validate.py <unpacked_docx_dir>")
        sys.exit(1)

    base_path = Path(sys.argv[1])

    if not base_path.exists():
        print(f"ERROR: Directory not found: {base_path}")
        sys.exit(1)

    print(f"Validating {base_path}...")

    all_errors = []

    # Check directory structure
    errors = validate_directory_structure(base_path)
    all_errors.extend(errors)

    # Check XML validity
    errors = validate_xml_files(base_path)
    all_errors.extend(errors)

    # Check relationships
    errors = validate_relationships(base_path)
    all_errors.extend(errors)

    if all_errors:
        print("\n❌ VALIDATION FAILED\n")
        print(f"Found {len(all_errors)} error(s):\n")
        for i, error in enumerate(all_errors, 1):
            print(f"{i}. {error}")
        print("\nFix these issues and run validation again.")
        sys.exit(1)
    else:
        print("\n✅ VALIDATION PASSED")
        print("All checks completed successfully.")
        sys.exit(0)

if __name__ == '__main__':
    main()
```

## scripts/unpack.py

```python
#!/usr/bin/env python3
"""
Unpack DOCX file to directory structure.
"""

import sys
import zipfile
from pathlib import Path

def unpack_docx(docx_path, output_dir):
    """Extract DOCX contents to directory."""
    docx_path = Path(docx_path)
    output_dir = Path(output_dir)

    if not docx_path.exists():
        print(f"ERROR: File not found: {docx_path}")
        sys.exit(1)

    if output_dir.exists():
        print(f"ERROR: Output directory already exists: {output_dir}")
        print("Remove it first or choose different output directory.")
        sys.exit(1)

    print(f"Unpacking {docx_path} to {output_dir}...")

    try:
        with zipfile.ZipFile(docx_path, 'r') as zip_ref:
            zip_ref.extractall(output_dir)
        print(f"✅ Successfully unpacked to {output_dir}")
    except zipfile.BadZipFile:
        print(f"ERROR: {docx_path} is not a valid DOCX file")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to unpack: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) != 3:
        print("Usage: python unpack.py <input.docx> <output_dir>")
        sys.exit(1)

    unpack_docx(sys.argv[1], sys.argv[2])

if __name__ == '__main__':
    main()
```

## scripts/pack.py

```python
#!/usr/bin/env python3
"""
Pack directory structure back to DOCX file.
"""

import sys
import zipfile
from pathlib import Path

def pack_docx(input_dir, output_docx):
    """Pack directory contents to DOCX file."""
    input_dir = Path(input_dir)
    output_docx = Path(output_docx)

    if not input_dir.exists():
        print(f"ERROR: Directory not found: {input_dir}")
        sys.exit(1)

    if output_docx.exists():
        print(f"WARNING: {output_docx} already exists, it will be overwritten.")

    print(f"Packing {input_dir} to {output_docx}...")

    try:
        with zipfile.ZipFile(output_docx, 'w', zipfile.ZIP_DEFLATED) as docx:
            # Add all files maintaining directory structure
            for file_path in input_dir.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(input_dir)
                    docx.write(file_path, arcname)

        print(f"✅ Successfully created {output_docx}")
        print(f"File size: {output_docx.stat().st_size / 1024:.1f} KB")
    except Exception as e:
        print(f"ERROR: Failed to pack: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) != 3:
        print("Usage: python pack.py <input_dir> <output.docx>")
        sys.exit(1)

    pack_docx(sys.argv[1], sys.argv[2])

if __name__ == '__main__':
    main()
```

## Why Include Scripts

### Benefits of Utility Scripts

1. **Reliability**: Pre-tested code is more reliable than generated code
2. **Consistency**: Same validation logic every time
3. **Token efficiency**: Execute scripts without loading content into context
4. **Error handling**: Comprehensive error messages guide fixes
5. **Feedback loops**: Validation script enables immediate error detection

### Script Design Principles

**validate.py demonstrates**:

- ✅ Verbose error messages with specific details
- ✅ Lists all errors, not just first one
- ✅ Proper exit codes (0 for success, 1 for failure)
- ✅ Clear success/failure indication with ✅/❌
- ✅ Actionable guidance ("Fix these issues and run validation again")

**unpack.py and pack.py demonstrate**:

- ✅ Input validation (file exists, proper format)
- ✅ Error handling for common issues
- ✅ Clear usage instructions
- ✅ Progress feedback

## Token Efficiency

### Without Scripts (Generated Code)

If Claude generates validation code each time:

- Generate validation logic: ~200 tokens
- Generate XML parsing code: ~150 tokens
- Generate relationship checking: ~150 tokens
- Total per use: ~500 tokens in context

### With Scripts (Execution)

Using pre-made scripts:

- Execute: `python scripts/validate.py output_dir/`
- Only output loaded into context: ~50 tokens
- Total per use: ~50 tokens

**Savings**: ~450 tokens per validation

## How Claude Uses This Skill

1. **User**: "Edit this DOCX file to change the header"
2. **Claude loads SKILL.md**: Sees the workflow
3. **Step 1**: Executes `python scripts/unpack.py input.docx output/`
4. **Step 2**: Edits `output/word/document.xml`
5. **Step 3**: Executes `python scripts/validate.py output/`
6. **If validation fails**: Reads error messages, fixes XML, runs validation again
7. **Step 4**: Executes `python scripts/pack.py output/ result.docx`
8. **Step 5**: Advises user to test the file

**Key**: Scripts execute without loading their contents, saving tokens and ensuring reliability.

## Feedback Loop Pattern

This skill demonstrates the feedback loop pattern:

```
1. Edit XML
2. Validate immediately ← validation script
3. If fails:
   - Read errors
   - Fix issues
   - Return to step 2 ← loop back
4. Only proceed when validation passes ← gate
5. Pack to DOCX
```

**Why it works**:

- Catches errors immediately
- Prevents accumulation of issues
- Machine-verifiable (not subjective)
- Clear fix path with error messages

## What Makes This Skill Effective

1. **Clear workflow**: 5-step process with checklist
2. **Validation emphasis**: "Validate immediately" prominently placed
3. **Utility scripts**: Reliable, reusable, token-efficient
4. **Feedback loop**: Catches errors before they compound
5. **Progressive disclosure**: OOXML details in reference files
6. **Common patterns**: Basic editing examples in SKILL.md
7. **Troubleshooting**: Common issues and fixes documented

## Metadata Analysis

### Name

```yaml
name: docx-editing
```

✓ Clear purpose
✓ 12 characters

### Description

```yaml
description: Edit DOCX files by modifying OOXML structure, with validation. Use when editing Word documents, modifying .docx files, or when the user mentions document editing with specific requirements.
```

✓ Specific capability: "edit DOCX", "modifying OOXML"
✓ Key feature: "with validation"
✓ Clear triggers: "Word documents", ".docx files", "document editing"
✓ 218 characters

## When to Include Scripts

Include scripts when:

- Operation is fragile or error-prone
- Validation can be automated
- Same logic used repeatedly
- Error handling is complex
- Consistency is critical

Don't include scripts when:

- Task is simple enough for Claude to handle
- Logic varies significantly per use
- Only needed once
