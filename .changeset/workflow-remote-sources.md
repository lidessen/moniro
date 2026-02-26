---
"agent-worker": minor
---

Add remote GitHub workflow sources and workflow params support

- Support `github:owner/repo@ref/path/file.yml` and shorthand `github:owner/repo@ref#name` syntax for remote workflows
- Clone remote repos to `~/.cache/agent-worker/sources/` with shallow fetch and cache invalidation
- Expose `${{ source.dir }}` for referencing files relative to the workflow source
- Add `params` block in workflow YAML with type validation and default values
- Extract reusable workflow definitions (`workflows/review.yml`, `workflows/changeset.yml`)
