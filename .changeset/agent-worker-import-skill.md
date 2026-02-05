---
"agent-worker": minor
---

Add `--import-skill` for temporary Git repository imports

This release adds support for importing agent skills directly from Git repositories during session creation. Skills are cloned to a session-specific temporary directory and automatically cleaned up when the session ends.

**New Features:**

- `--import-skill` CLI option for importing skills from Git repositories
- Import spec format: `[provider:]owner/repo[@ref]:{skill1,skill2,...}`
- Brace expansion support for importing multiple skills: `{a,b,c}`
- Multi-provider support: GitHub (default), GitLab, Gitee
- Session-scoped temporary directory with automatic cleanup on shutdown
- `SkillImporter` class for programmatic skill imports
- New exports: `SkillImporter`, `parseImportSpec`, `buildGitUrl`, `getSpecDisplayName`

**Examples:**

```bash
# CLI usage
agent-worker session new --import-skill vercel-labs/agent-skills:dive
agent-worker session new --import-skill lidessen/skills:{memory,orientation}
agent-worker session new --import-skill gitlab:myorg/skills@v1.0.0:custom
```

```typescript
// SDK usage
import { SkillImporter, SkillsProvider, createSkillsTool } from 'agent-worker'

const importer = new SkillImporter(sessionId)
await importer.import('vercel-labs/agent-skills:dive')
await skillsProvider.addImportedSkills(importer)

// Cleanup when done
await importer.cleanup()
```

**Note:** For permanent skill installation, use the Vercel skills CLI (`npx skills add`). This feature is designed for temporary, session-scoped skill imports.
