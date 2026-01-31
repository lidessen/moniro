# Skills for AI Agents

A collection of reusable capabilities for AI agents. Skills provide procedural knowledge that helps agents accomplish specific tasks more effectively.

## What are skills?

Skills are like plugins or extensions that enhance what your AI agent can do. Each skill is a self-contained capability with clear instructions, workflows, and best practices that help AI agents perform specialized tasks.

## Installation

To install these skills, use the `skills` CLI:

```bash
npx skills add lidessen/skills
```

This will install all available skills and make them available to your AI agent.

## Available Skills

### ✨ refining

Refines code changes for better reviewability. Unified workflow for committing, reviewing, and creating PRs/MRs.

**Three Modes:**
- **Commit** - Validate staged changes, generate commit message
- **Review** - Systematic code review with risk analysis
- **Create PR/MR** - Generate reviewer-focused descriptions with ASCII diagrams

**Features:**
- Reviewability gate: cohesion check (no mixed concerns), size assessment
- Pre-commit validation for debug code and breaking changes
- Risk-based review prioritization (security, data integrity, APIs)
- PR/MR descriptions with ASCII diagrams for complex changes
- Project-aware review strategy (conservative/balanced/best-practice)
- Progress tracking for large reviews

**Use when:** Committing, reviewing code, creating PR/MR, or mention "commit", "review", "PR", "MR", "refine".

### 📝 authoring-skills

Guide for authoring effective Agent Skills using a principle-based approach inspired by Claude's constitutional AI.

**Philosophy:**
- Understanding *why* patterns matter, not just *what* rules to follow
- Three core principles: Progressive Disclosure, Respect Intelligence, Enable Discovery
- Focus on judgment and trade-offs over mechanical compliance

**Features:**
- Principle-based design framework for creating and improving skills
- Deep understanding of anti-patterns and their underlying causes
- Progressive disclosure patterns and best practices
- Comprehensive examples and templates

**Use when:** Creating new skills, improving existing ones, refactoring skill structure, reviewing skill quality, or asking about skill design, best practices, anti-patterns, or organization.

### 🔍 dive

Dives deep into your project to investigate any question using layered search strategies for evidence-based answers.

**Features:**
- Layered investigation (documentation → code → deep analysis)
- Evidence-based answers with file:line citations
- Never guesses - all answers backed by documentation or code
- Multi-source verification for accuracy
- Handles uncertainty transparently

**Use when:** You want to investigate "how does X work", "what is Y", "where is Z", or dive into features, APIs, configuration, architecture, or any technical implementation details.

### 🏗️ engineering

Guides technical decisions, architecture, and implementation for building robust software systems.

**Features:**
- Technical decision frameworks (evaluate options, weigh trade-offs)
- Architecture patterns (layered, modular, event-driven)
- Module boundary design and data flow planning
- API design principles (REST, error handling, versioning)
- Refactoring strategies (when, how, safely)
- Performance optimization guidance

**Use when:** Making tech choices, designing systems, evaluating trade-offs, planning refactoring, optimizing performance, or asking "how should I build this?"

### 🧹 housekeeping

Manages project housekeeping including documentation organization, dependency management, directory structure, code cleanup, technical debt tracking, and infrastructure configuration.

**Features:**
- Documentation management (AGENTS.md, RFC processes, organization strategies)
- Dependency cleanup (remove unused, update outdated, fix vulnerabilities)
- Directory structure organization and naming conventions
- Code cleanup (dead code removal, duplicate consolidation, file splitting)
- Technical debt tracking and prioritization
- Infrastructure and config file maintenance

**Use when:** Organizing documentation, cleaning up dependencies (package.json, requirements.txt), reorganizing folders, removing dead code, addressing tech debt, or maintaining project structure and configuration.

### 🧭 orientation

Orients agents in new projects by scanning entry documents and discovering available skills.

**Features:**
- Scans CLAUDE.md, AGENTS.md, README for project context
- Discovers skills at project and user level
- Assesses project type and tech stack
- Diagnoses documentation health
- Generates orientation report with suggested starting points

**Use when:** Starting a new session, entering unfamiliar projects, asking "what can you do", "where do I start", or needing a project overview.

### 🧠 memory

Manages project-level memory using local filesystem with optional GitHub/GitLab Issues sync.

**Features:**
- Store notes, decisions, todos, session summaries in `.memory/`
- Cross-device sync via GitHub/GitLab Issues (MCP or CLI)
- Hook integration for auto-init on session start
- context.md as sync anchor with Issue references

**Use when:** Need to remember context across sessions, track decisions, manage todos, build project knowledge base, or mention "remember", "recall", "save this".

### 🚀 frontend-init

Initialize frontend projects with opinionated modern toolchain.

**Features:**
- Bun as package manager
- Oxlint for linting, Oxfmt for formatting
- tsdown for npm bundler
- tsgo for type checking
- Minimal, fast, modern defaults

**Use when:** Creating new frontend/TypeScript projects, setting up project tooling, or mentions "init project", "new frontend", "setup tooling".

## Skill Structure

Each skill follows a consistent structure:

```
skills/
├── skill-name/
│   ├── SKILL.md           # Main skill file with metadata and workflow
│   ├── patterns/          # Common patterns and templates
│   ├── examples/          # Example implementations
│   ├── best-practices/    # Best practice guides
│   └── reference/         # Detailed reference documentation
```

## Creating Your Own Skills

Want to create a new skill? Use the `authoring-skills` skill to guide you through the process:

1. Understand the goal and core principles
2. Draft clear metadata (name and description with triggers)
3. Design structure with progressive disclosure
4. Write concisely (respect Claude's intelligence)
5. Review against principle-based checklist

See [`skills/authoring-skills/SKILL.md`](skills/authoring-skills/SKILL.md) for detailed guidance.

## Contributing

Contributions are welcome! Please ensure:

- Skills follow the progressive disclosure pattern
- SKILL.md files include proper YAML frontmatter
- Names use lowercase-with-hyphens format
- Descriptions are specific and actionable
- Workflows are clear and well-structured

## License

See [LICENSE](LICENSE) for details.

## Learn More

- [Skills.sh Documentation](https://skills.sh/docs) - Official skills documentation
- [Skills Leaderboard](https://skills.sh/) - Browse popular skills in the ecosystem
