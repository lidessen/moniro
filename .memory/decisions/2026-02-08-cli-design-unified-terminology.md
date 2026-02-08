# ADR: CLI Design - Unified Terminology and Target Syntax

**Date**: 2026-02-08
**Status**: Accepted
**Context**: CLI design review based on user feedback and evaluation

---

## Problem

The CLI had several inconsistencies that increased cognitive load and reduced usability:

1. **Terminology confusion**: Mixed use of "instance" in code vs "workflow" in parameters
2. **Default naming ambiguity**: `default` as the global workspace name was unclear
3. **Inconsistent target syntax**: `schedule` commands used different parameter styles
   - `schedule get [target]` - positional
   - `schedule clear [target]` - positional
   - `schedule set <wakeup> --to <target>` - option flag
4. **Unclear target semantics**: How to reference agents across workflows

## Decision

### 1. Unified Terminology

**All user-facing interfaces use `workflow`**:
- CLI parameter: `--tag <tag>` for workflow run/start commands
- Code constants: `DEFAULT_WORKFLOW = "global"`, `DEFAULT_TAG = "main"`
- Documentation: "workflow" throughout

Rationale: "workflow" better describes both use cases:
- Agent scenario: workflow = namespace/context
- Multi-agent scenario: workflow = the orchestrated task itself

### 2. Workflow:Tag Model

Workflows support multiple instances using a **`workflow:tag`** syntax (inspired by Docker's `image:tag`).

**Concept hierarchy**:
- **Workflow**: A defined set of agents and their collaboration pattern (YAML definition)
- **Tag**: A specific instance/version of that workflow (runtime instance)

**Default naming**:
- Default workflow: `global` (for standalone agents)
- Default tag: `main` (for default instance)

Rationale:
- **Tag vs branch**: "tag" implies versioned instances (like Docker), not evolving branches
- **`global` for default**: Avoids `main:main` redundancy; clearly indicates "not part of a specific task"
- **Familiar pattern**: `nginx:1.21` → `review:pr-123`

### 3. Target Syntax

Full syntax: `agent@workflow:tag`

With defaults and abbreviations:
```
alice                    # alice@global:main (display: alice)
alice@review             # alice@review:main (display: alice@review)
alice@review:pr-123      # Full specification

@review                  # @review:main
@review:pr-123           # Full workflow:tag reference
```

**Display rules**:
- Omit `@global` in display (show `alice`, not `alice@global`)
- Omit `:main` tag in display when it's the default

**Distinction from message mentions**:
- **In message content**: `@agent` is mention syntax (triggers notification)
- **As command target**: `agent@workflow:tag` (routing/identification)

### 4. Schedule Command Redesign

**New syntax** (target-first):
```bash
schedule <target> get
schedule <target> set <wakeup> [options]
schedule <target> clear
```

Examples:
```bash
schedule alice set 30s                      # alice@global:main
schedule alice@review set 5m                # alice@review:main
schedule alice@review:pr-123 set 30s        # Full specification
schedule @review:pr-123 set 1h              # Workflow-level default
```

Rationale:
- **Consistency**: Target position unified across all subcommands
- **Natural ordering**: "Who" (target) before "what" (action/value)
- **No special flags**: No need to remember `--to` for `set`
- **Supports defaults**: `@workflow` for workflow-level operations without specifying agent

## Consequences

### Positive
- ✅ **Lower cognitive load**: One term, one syntax
- ✅ **Better discoverability**: Consistent patterns across commands
- ✅ **Clear semantics**: `main` clearly indicates primary workspace
- ✅ **Future-proof**: Target syntax supports complex scenarios

### Breaking Changes
- ⚠️ Code using `DEFAULT_INSTANCE` needs migration to `DEFAULT_WORKFLOW = "global"` and `DEFAULT_TAG = "main"`
- ⚠️ Target syntax extended: `agent@workflow` → `agent@workflow:tag` (with defaults)
- ⚠️ `schedule set` command signature changes (target position shift)
- ⚠️ Variable interpolation: `workflow.instance` → `workflow.tag`

### Migration Path
1. **Phase 1**: Update constants (`DEFAULT_WORKFLOW = "global"`, `DEFAULT_TAG = "main"`)
2. **Phase 2**: Implement workflow:tag parsing and routing
3. **Phase 3**: Update variable interpolation (`workflow.tag` instead of `workflow.instance`)
4. **Phase 4**: Update file paths to `.workflow/<workflow>/<tag>/` (avoiding colons for OS compatibility)

## Related Issues

This addresses problems identified in CLI evaluation (2026-02-08):
- P0: Inconsistent target parameter conventions
- P0: Terminology confusion (instance vs workflow)
- P2: Command namespace organization

## References

- Evaluation document: User feedback on CLI design
- Related: `packages/agent-worker/src/cli/instance.ts` (to be renamed)
- Related: `packages/agent-worker/docs/workflow/DESIGN.md`

---

**Decision made by**: User (lidessen) + Agent discussion
**Supersedes**: Implicit naming conventions in original implementation
