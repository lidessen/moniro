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
- CLI parameter: `-w, --workflow <name>`
- Code constant: `DEFAULT_WORKFLOW = "main"`
- Documentation: "workflow" throughout

Rationale: "workflow" better describes both use cases:
- Agent scenario: workflow = namespace/context
- Multi-agent scenario: workflow = the orchestrated task itself

### 2. Default Workflow Name: `main`

The global/default workflow is named **`main`** (not `default`).

Rationale:
- Clearer semantics: "main workflow" (primary) vs "default workflow" (fallback)
- Familiar to developers (git `main` branch)
- Short and unambiguous

### 3. Target Syntax

Agents and workflows are referenced using:

```
agent              # Equivalent to agent@main
agent@workflow     # Agent in specific workflow
@workflow          # Workflow itself (or default behavior)
```

Examples:
```bash
alice              # alice@main
alice@task1        # alice in task1 workflow
@main              # main workflow
@task1             # task1 workflow
```

Distinction from message mentions:
- **In message content**: `@agent` is mention syntax
- **As command target**: `agent` or `agent@workflow` (no @ prefix for agent names)

### 4. Schedule Command Redesign

**New syntax** (target-first):
```bash
schedule <target> get
schedule <target> set <wakeup> [options]
schedule <target> clear
```

Examples:
```bash
schedule alice set 30s
schedule alice@task1 set 5m --prompt "check status"
schedule @main set 1h
schedule @task1 clear
```

Rationale:
- **Consistency**: Target position unified across all subcommands
- **Natural ordering**: "Who" (target) before "what" (action/value)
- **No special flags**: No need to remember `--to` for `set`
- **Supports defaults**: `@main` and `@workflow` for default behaviors

## Consequences

### Positive
- ✅ **Lower cognitive load**: One term, one syntax
- ✅ **Better discoverability**: Consistent patterns across commands
- ✅ **Clear semantics**: `main` clearly indicates primary workspace
- ✅ **Future-proof**: Target syntax supports complex scenarios

### Breaking Changes
- ⚠️ Code using `DEFAULT_INSTANCE` needs migration to `DEFAULT_WORKFLOW = "main"`
- ⚠️ CLI users with `--workflow default` need to update to `--workflow main`
- ⚠️ `schedule set` command signature changes (target position shift)

### Migration Path
1. **Phase 1**: Update constants and internal naming
2. **Phase 2**: Support both `default` and `main` with deprecation warning
3. **Phase 3**: Remove `default` support in next major version

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
