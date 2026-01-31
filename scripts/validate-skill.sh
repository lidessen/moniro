#!/bin/bash
# Validate skill structure and format
# Usage: ./scripts/validate-skill.sh [skill-name]

set -e

SKILLS_DIR="skills"
ERRORS=0

validate_skill() {
    local skill_dir="$1"
    local skill_name=$(basename "$skill_dir")

    echo "Validating: $skill_name"

    # Check SKILL.md exists
    if [[ ! -f "$skill_dir/SKILL.md" ]]; then
        echo "  ❌ Missing SKILL.md"
        ((ERRORS++))
        return
    fi

    # Check YAML frontmatter
    if ! head -1 "$skill_dir/SKILL.md" | grep -q "^---$"; then
        echo "  ❌ Missing YAML frontmatter"
        ((ERRORS++))
    fi

    # Check name field
    if ! grep -q "^name:" "$skill_dir/SKILL.md"; then
        echo "  ❌ Missing 'name' in frontmatter"
        ((ERRORS++))
    fi

    # Check description field
    if ! grep -q "^description:" "$skill_dir/SKILL.md"; then
        echo "  ❌ Missing 'description' in frontmatter"
        ((ERRORS++))
    fi

    # Check line count (warning only)
    local lines=$(wc -l < "$skill_dir/SKILL.md")
    if [[ $lines -gt 500 ]]; then
        echo "  ⚠️  SKILL.md has $lines lines (recommend <500)"
    fi

    # Check reference files are one level deep
    if [[ -d "$skill_dir/reference" ]]; then
        local nested=$(find "$skill_dir/reference" -mindepth 2 -type f -name "*.md" 2>/dev/null | wc -l)
        if [[ $nested -gt 0 ]]; then
            echo "  ⚠️  Nested reference files found (recommend one level deep)"
        fi
    fi

    echo "  ✅ Valid"
}

# Main
if [[ -n "$1" ]]; then
    # Validate specific skill
    if [[ -d "$SKILLS_DIR/$1" ]]; then
        validate_skill "$SKILLS_DIR/$1"
    else
        echo "Skill not found: $1"
        exit 1
    fi
else
    # Validate all skills
    for skill_dir in "$SKILLS_DIR"/*/; do
        validate_skill "$skill_dir"
    done
fi

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo "Found $ERRORS error(s)"
    exit 1
else
    echo ""
    echo "All skills valid"
fi
