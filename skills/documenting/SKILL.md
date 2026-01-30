# Documenting

---
name: documenting
description: Manages project documentation with directory structure design, classification strategies (internal/public/agent-facing), lifecycle handling (temporary docs, archival, deletion), and best practices like RFC. Creates layered, multi-level documentation systems that remain useful and accessible. Use when setting up documentation, organizing docs, writing AGENTS.md/CLAUDE.md, implementing RFC processes, or auditing documentation structure.
---

Manages living documentation systems for code repositories. Ensures documents are properly placed, classified, and remain useful over time through structured organization and lifecycle management.

## Quick Start

### Common Tasks

**Setting Up Documentation for a New Project**
1. Design directory structure based on project needs → [organization-strategies.md](reference/organization-strategies.md)
2. Set up classification system for document types
3. Create index files (AGENTS.md, CLAUDE.md)
4. Establish RFC process if needed → [rfc-process.md](reference/rfc-process.md)

**Organizing Existing Documentation**
1. Audit current documentation
2. Classify documents by type and audience
3. Move to appropriate locations
4. Clean up temporary/outdated documents → [lifecycle.md](reference/lifecycle.md)
5. Update index files

**Writing Agent-Facing Documentation**
1. Follow "Assume Claude is smart" principle → [agent-docs.md](reference/agent-docs.md)
2. Use progressive disclosure
3. Focus on what, when, and why (not how)
4. Update AGENTS.md or CLAUDE.md index

**Managing Temporary Documents**
1. Create in designated temporary location
2. Tag with creation date and purpose
3. Schedule review/cleanup → [lifecycle.md](reference/lifecycle.md)

## Documentation Layers

### Layer 1: Repository Root (Discovery & Navigation)
Essential files that help both humans and agents understand the project:

- **README.md** - Project overview, quick start
- **AGENTS.md** - Agent-specific instructions and navigation (see [agent-docs.md](reference/agent-docs.md))
- **CLAUDE.md** - Claude-specific context and guidelines (see [agent-docs.md](reference/agent-docs.md))
- **CONTRIBUTING.md** - How to contribute
- **LICENSE** - Legal information

### Layer 2: docs/ Directory (Structured Documentation)
Organized by audience and purpose:

```
docs/
├── internal/          # Team-facing documentation
│   ├── architecture/  # System design, technical decisions
│   ├── processes/     # Team workflows, policies
│   └── notes/         # Meeting notes, temporary docs
├── public/            # User/external documentation
│   ├── guides/        # How-to guides
│   ├── api/           # API documentation
│   └── examples/      # Code examples
└── rfcs/              # Request for Comments (design proposals)
    ├── README.md      # RFC process guide
    ├── template.md    # RFC template
    └── NNNN-title.md  # Individual RFCs (numbered)
```

### Layer 3: Code-Adjacent Documentation
Documentation that lives with the code:

- Inline comments (sparingly, only when non-obvious)
- Docstrings/JSDoc (public APIs only)
- README.md in component directories (when needed)

## Classification Strategies

### By Audience

**Internal Documentation** (`docs/internal/`)
- Architecture decisions
- Development processes
- Team knowledge
- Temporary notes and drafts

**Public Documentation** (`docs/public/`)
- User guides
- API documentation
- Tutorials and examples
- Public website content

**Agent Documentation** (Root + `AGENTS.md`/`CLAUDE.md`)
- Project context and structure
- Task-specific instructions
- Tool and workflow guidance
- Navigation to other docs

### By Lifecycle

**Permanent** - Core documentation that evolves with the project
- Architecture docs
- API references
- User guides
- RFCs (as historical record)

**Temporary** - Time-bounded or draft documents (see [lifecycle.md](reference/lifecycle.md))
- Meeting notes
- Brainstorming docs
- Draft RFCs
- Investigation notes

**Archived** - Historical documentation no longer active
- Superseded RFCs
- Legacy process docs
- Old architecture decisions

### By Purpose

**Process Documentation** - How the team works
- Contributing guidelines
- RFC process
- Code review standards
- Release procedures

**Technical Documentation** - How the system works
- Architecture overviews
- Design decisions
- API specifications
- Database schemas

**Knowledge Base** - Captured learnings
- Common issues and solutions
- Investigation notes
- Post-mortems
- Best practices

## Best Practices

### Keep Documentation "Alive"

**Bad (Dead Documentation)**
- Written once, never updated
- Buried in nested folders
- No links or navigation
- Unclear ownership
- Outdated information persists

**Good (Living Documentation)**
- Updated with code changes
- Easy to discover (indexed in AGENTS.md/README)
- Clear maintenance owners
- Regular audits and cleanup
- Integrated into workflows (e.g., RFC for big changes)

### Progressive Disclosure for Agents

Follow the same principles as the skills system:
1. **Metadata** - AGENTS.md/CLAUDE.md provide overview and navigation
2. **Core docs** - High-level workflows and decisions
3. **Reference** - Detailed technical specs loaded on-demand
4. **Code** - Ultimate source of truth, read when needed

See [agent-docs.md](reference/agent-docs.md) for detailed guidelines.

### Documentation Minimalism

**Only document what needs documenting:**
- Non-obvious design decisions → Document
- Self-explanatory code → Don't document
- Complex workflows → Document
- Standard patterns → Don't document
- Public APIs → Document
- Internal utilities → Don't document (unless complex)

### Version Control Integration

- Commit documentation with related code changes
- Use meaningful commit messages for doc updates
- Link to commits/PRs in architectural decision docs
- Use git history as documentation (for "why" questions)

## Workflows

### Workflow 1: New Project Documentation Setup

1. **Create base structure**
   ```bash
   mkdir -p docs/{internal,public,rfcs}
   mkdir -p docs/internal/{architecture,processes,notes}
   mkdir -p docs/public/{guides,api,examples}
   ```

2. **Create index files**
   - README.md (project overview)
   - AGENTS.md (agent navigation) → [agent-docs.md](reference/agent-docs.md)
   - CONTRIBUTING.md (contribution guide)
   - docs/rfcs/README.md (RFC process) → [rfc-process.md](reference/rfc-process.md)

3. **Set up lifecycle management**
   - Create docs/internal/notes/README.md with cleanup policy
   - Add calendar reminder for quarterly doc audits

4. **Document the documentation system**
   - Add section to README explaining doc structure
   - Update AGENTS.md with navigation to key docs

### Workflow 2: Documentation Audit

1. **Inventory existing docs**
   - List all markdown files: `find . -name "*.md"`
   - Identify purpose and audience for each
   - Check last modified date

2. **Classify and organize**
   - Move to appropriate layer/directory
   - Update links and references
   - Add to index files (AGENTS.md/README)

3. **Clean up temporary docs** (see [lifecycle.md](reference/lifecycle.md))
   - Review docs/internal/notes/
   - Archive or delete outdated content
   - Consolidate valuable information

4. **Update navigation**
   - Ensure AGENTS.md reflects current structure
   - Fix broken links
   - Add missing index entries

### Workflow 3: Writing an RFC

See [rfc-process.md](reference/rfc-process.md) for detailed workflow.

1. Copy RFC template
2. Fill in proposal details
3. Share for feedback
4. Revise based on comments
5. Reach consensus and implement
6. Update RFC status (draft → accepted → implemented)

### Workflow 4: Creating Agent Documentation

See [agent-docs.md](reference/agent-docs.md) for detailed guidelines.

1. **Identify agent needs**
   - What tasks will agents perform?
   - What context do they need?
   - What can they discover themselves?

2. **Create/update AGENTS.md**
   - Project overview (1-2 paragraphs)
   - Key workflows and entry points
   - Important constraints or requirements
   - Links to detailed docs

3. **Apply "Assume Claude is smart" principle**
   - Don't explain basic concepts
   - Focus on project-specific context
   - Provide navigation, not tutorials
   - Use progressive disclosure

4. **Test with agent**
   - Ask agent to perform typical tasks
   - Note what information it seeks
   - Refine documentation based on actual needs

## Navigation

### Quick Reference
- [Documentation Organization Strategies](reference/organization-strategies.md)
- [Document Lifecycle Management](reference/lifecycle.md)
- [Agent Documentation Guidelines](reference/agent-docs.md)
- [RFC Process](reference/rfc-process.md)

### Examples
- [New Project Setup](examples/new-project-setup.md)
- [Documentation Audit](examples/documentation-audit.md)

## Common Questions

**Q: Where should I put temporary investigation notes?**
A: `docs/internal/notes/` - See [lifecycle.md](reference/lifecycle.md) for cleanup policies.

**Q: Do I need both AGENTS.md and CLAUDE.md?**
A: Start with one (AGENTS.md recommended). Create Claude-specific file only if needed for Claude-specific context. See [agent-docs.md](reference/agent-docs.md).

**Q: When should I write an RFC?**
A: For significant technical decisions, architecture changes, or new processes that affect multiple people/systems. See [rfc-process.md](reference/rfc-process.md).

**Q: How do I prevent documentation from becoming outdated?**
A: Link docs to code (commit with changes), regular audits, clear ownership, and keep it minimal (less to maintain). See [lifecycle.md](reference/lifecycle.md).

**Q: Should I document every function?**
A: No. Only document public APIs and non-obvious behavior. Follow "Assume Claude is smart" for agent-facing docs. See best practices section above.
