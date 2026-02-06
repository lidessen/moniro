# Agent Worker Workflow Design

## Overview

This document defines the design for agent-worker workflows, enabling multi-agent orchestration with shared context and @mention-driven collaboration.

### Key Concepts

1. **Unified Agent Naming**: `agent-name` (standalone) or `agent-name@instance` (workflow)
2. **Shared Context**: Channel (communication) + Document (shared workspace)
3. **Kickoff Model**: Natural language workflow initiation with @mention triggers
4. **Two Modes**: `run` (one-shot) and `start` (persistent)

---

## Workflow File Format

### Basic Structure

```yaml
# review.yaml
name: code-review

# Context is enabled by default - no config needed

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

# Optional: shell commands for setup
setup:
  - shell: gh pr diff
    as: diff

# Kickoff message - triggers workflow via @mention
kickoff: |
  PR diff:
  ${{ diff }}

  @reviewer please review these changes.
  When issues found, @coder to fix them.
```

### Context Configuration

Context enables shared communication and workspace between agents. **Context is enabled by default** with the file provider.

```yaml
# Default: file provider enabled automatically (no context field needed)
agents:
  reviewer: ...

# Explicit file provider with defaults
context:
  provider: file

# File provider with custom config
context:
  provider: file
  config:
    dir: ./my-context/
    channel: discussion.md
    document: workspace.md

# Memory provider (for testing)
context:
  provider: memory

# Disable context entirely
context: false
```

**Default Values:**

```typescript
const CONTEXT_DEFAULTS = {
  dir: '.workflow/${{ instance }}/',
  channel: 'channel.md',           // Channel file (in dir)
  documentDir: 'documents/',       // Document directory (in dir)
  document: 'notes.md',            // Entry point (in documentDir)
}
```

### The Three Context Layers

Agents interact with three complementary context layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Context Model                          │
│                                                                   │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │    INBOX     │   │     CHANNEL      │   │    DOCUMENT     │  │
│  │              │   │                  │   │                 │  │
│  │  "What's     │   │  "What happened  │   │  "What are we   │  │
│  │   for me?"   │   │   so far?"       │   │   working on?"  │  │
│  │              │   │                  │   │                 │  │
│  │  - Unread    │   │  - Full history  │   │  - Goals        │  │
│  │    @mentions │   │  - Who said what │   │  - Todos        │  │
│  │  - Priority  │   │  - Timeline      │   │  - Methodology  │  │
│  │    signals   │   │  - Context       │   │  - Decisions    │  │
│  └──────────────┘   └──────────────────┘   └─────────────────┘  │
│         │                    │                      │            │
│         └────────────────────┼──────────────────────┘            │
│                              │                                   │
│                     Agent Work Loop                              │
│            ┌─────────────────┴─────────────────┐                 │
│            │  1. Check inbox (what's new?)     │                 │
│            │  2. Read channel (get context)    │                 │
│            │  3. Check document (goals/todos)  │                 │
│            │  4. Do work                       │                 │
│            │  5. Update document (if needed)   │                 │
│            │  6. Send to channel (ack + next)  │                 │
│            │  7. Repeat                        │                 │
│            └───────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

| Layer | Purpose | Data Model | Persistence |
|-------|---------|------------|-------------|
| **Inbox** | "What needs my attention?" | Derived from channel @mentions | Transient (read state) |
| **Channel** | "What's the full context?" | Append-only timeline | Permanent log |
| **Document** | "What are the goals/methodology?" | Structured workspace | Editable, versioned |

### Why Three Layers?

**Inbox alone is insufficient**: An agent waking up to 5 unread messages has no context. What's the project? What happened before? What's the methodology?

**Channel alone is overwhelming**: Scrolling through 100 messages to find "what's for me" is inefficient. The inbox filters the signal.

**Document alone is static**: Goals and methodology don't change often, but the work does. Channel captures the dynamic flow.

**Together they form a complete picture**:
- **Inbox** → immediate attention (what's urgent?)
- **Channel** → situational awareness (what's happening?)
- **Document** → strategic context (what's the mission?)

### Channel vs Document

| Aspect | Channel | Document |
|--------|---------|----------|
| Purpose | Communication log | Shared workspace |
| Format | Append-only timeline | Editable content |
| @mention | Triggers notifications | No triggers |
| Typical use | Discussions, handoffs | Notes, findings, decisions |

### Channel Management (Long Workflows)

For long-running workflows, channel can grow large. Best practices:

**1. Use `limit` parameter when reading:**
```typescript
// Read only recent messages (most agents don't need full history)
const recent = await tools.channel_read({ limit: 50 })
```

**2. Agent prompts should summarize, not preserve:**
```markdown
# Agent System Prompt Guidance
When you have many channel messages, focus on:
- Most recent 10-20 messages for immediate context
- @mentions directed at you
- Key decisions (look for [RESOLVED], [DECISION])

Don't try to remember everything - the channel is your external memory.
```

**3. Transfer key information to document:**
```markdown
# Workflow Best Practice
Important decisions, findings, and status should be recorded in document.
Channel is for communication; document is for persistent state.
```

**4. Channel rotation (future consideration):**
```yaml
# Potential future config (not yet implemented)
context:
  provider: file
  config:
    channel: channel.md
    channelRotation:
      maxEntries: 500      # Rotate after 500 entries
      archiveTo: archive/  # Move old to archive/channel-YYYY-MM-DD.md
```

For now, trust agents to use `limit` and rely on document for important state.

**channel.md** (append-only):
```markdown
### 10:00:00 [system]
Workflow started

### 10:00:05 [reviewer]
@coder found auth validation issue in line 42

### 10:01:00 [coder]
Fixed, @reviewer please verify
```

**notes.md** (editable):
```markdown
# Review Notes

## Issues Found
1. Auth validation missing (line 42)
2. N+1 query in user loader

## Decisions
- Use zod for validation
- Defer performance fix to next sprint
```

### File-Based Context Storage

When using `provider: file`, the context system stores data in the instance directory:

```
.workflow/instance/
├── _state/                 # Internal state (managed by system)
│   ├── inbox-state.json    # Per-agent read cursors
│   └── proposals.json      # Active proposals
├── channel.md              # Channel: communication log (append-only)
└── documents/              # Document: user workspace (separate system)
    └── ...
```

**Channel** and **Document** are two independent systems:
- Channel: append-only communication log (`channel.md`)
- Document: editable workspace (one or more files in `documents/`)

### Multi-File Document Structure

Documents can span multiple files with a single entry point. This keeps the workspace organized while maintaining agent orientation.

```
.workflow/instance/documents/
├── workspace.md        # Entry point document
├── goals.md            # Project goals and success criteria
├── todos.md            # Current tasks and status
├── methodology.md      # How we work (patterns, conventions)
├── decisions.md        # ADRs and key decisions
└── findings/           # Detailed findings by topic
    ├── auth-issues.md
    └── performance.md
```

**Entry Point Pattern**:

The entry point (`workspace.md`) serves as an index and orientation document:

```markdown
# PR #123 Review Workspace

## Quick Links
- [Goals](goals.md) - What success looks like
- [Todos](todos.md) - Current tasks
- [Decisions](decisions.md) - Key choices made

## Current Focus
@reviewer is investigating auth validation
@coder is on standby for fixes

## Methodology
See [methodology.md](methodology.md) for review patterns.
```

**Document Configuration**:

```yaml
context:
  provider: file
  config:
    dir: .workflow/${{ instance }}/
    channel: channel.md              # Channel file (separate from documents)
    documentDir: documents/          # Document directory
    document: workspace.md           # Entry point (relative to documentDir)
    documents:                       # Additional structured documents
      - goals.md
      - todos.md
      - methodology.md
      - decisions.md
```

**MCP Tools for Multi-File Documents**:

| Tool | Purpose |
|------|---------|
| `document_read` | Read entry point (default) or specific file |
| `document_write` | Write to entry point or specific file |
| `document_list` | List all document files |
| `document_create` | Create new document file |

```typescript
// Read entry point
await tools.document_read()

// Read specific document
await tools.document_read({ file: 'todos.md' })

// Update todos
await tools.document_write({
  file: 'todos.md',
  content: '# Todos\n- [x] Review auth\n- [ ] Check performance'
})

// Create new finding
await tools.document_create({
  file: 'findings/memory-leak.md',
  content: '# Memory Leak Investigation\n...'
})
```

### Document Ownership Model

To prevent concurrent write conflicts, documents have an optional **owner** who has exclusive write permission. Other agents can read and suggest changes.

**Configuration:**

`documentOwner` is a context-level config (cross-provider):

```yaml
context:
  provider: file
  documentOwner: scribe  # Only @scribe can write to documents
  config:
    document: workspace.md
```

**Default Behavior:**

| Scenario | Default Owner |
|----------|---------------|
| Single agent | Self (ownership disabled - no need) |
| Multiple agents, owner specified | Specified agent |
| Multiple agents, no owner | Agents vote via proposal system |

**How It Works:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Ownership                            │
│                                                                  │
│  Owner (@scribe):                 Non-owners:                   │
│   - document_read ✓                - document_read ✓            │
│   - document_write ✓               - document_write ✗           │
│   - document_create ✓              - document_create ✗          │
│   - document_append ✓              - document_append ✗          │
│   - document_list ✓                - document_list ✓            │
│   - document_suggest ✓             - document_suggest ✓ (new)   │
│                                                                  │
│  Non-owners use document_suggest to request changes:            │
│  → Message posted to channel: "@scribe [DOC_SUGGEST] ..."       │
│  → Scribe processes suggestion and updates document             │
└─────────────────────────────────────────────────────────────────┘
```

**MCP Tools with Ownership:**

```typescript
server.tool('document_write', {
  content: z.string(),
  file: z.string().optional(),
}, async ({ content, file }, extra) => {
  const agent = extra.sessionId
  const owner = config.documentOwner

  // Check ownership if configured
  if (owner && agent !== owner) {
    return {
      content: [{
        type: 'text',
        text: `Error: Only @${owner} can write to documents. Use document_suggest instead.`
      }]
    }
  }

  await provider.writeDocument(content, file)
  return { content: [{ type: 'text', text: 'written' }] }
})

server.tool('document_suggest', {
  suggestion: z.string().describe('What change to make'),
  file: z.string().optional().describe('Which file to change'),
  reason: z.string().optional().describe('Why this change is needed'),
}, async ({ suggestion, file, reason }, extra) => {
  const from = extra.sessionId
  const owner = config.documentOwner || 'system'
  const fileInfo = file ? ` in ${file}` : ''
  const reasonInfo = reason ? `\nReason: ${reason}` : ''

  // Post suggestion to channel as @mention to owner
  const message = `@${owner} [DOC_SUGGEST]${fileInfo}\n${suggestion}${reasonInfo}`
  await provider.appendChannel(from, message)

  return { content: [{ type: 'text', text: `Suggestion sent to @${owner}` }] }
})
```

**Example Workflow:**

```yaml
name: code-review

context:
  provider: file
  documentOwner: scribe  # Dedicated document maintainer (context-level, not in config)

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You review code and report findings.
      Use document_suggest to request documentation updates.

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You fix code issues.
      Use document_suggest to record your changes.

  scribe:
    model: anthropic/claude-haiku-3-5  # Lightweight model for doc updates
    system_prompt: |
      You maintain the project documentation.
      Process [DOC_SUGGEST] messages and update documents accordingly.
      Consolidate duplicate suggestions. Keep docs concise.
```

**Benefits:**
- No concurrent write conflicts (single writer)
- Clear responsibility (scribe owns documentation quality)
- Suggestions are logged in channel (audit trail)
- Scribe can consolidate/prioritize suggestions

**When to Use:**
- Workflows with 3+ agents that might update documents
- When document consistency matters
- When you want an audit trail of document changes

**When NOT to Use:**
- Simple 2-agent workflows
- When speed matters more than consistency
- When agents rarely update documents

### Proposal & Voting System

A generic mechanism for collaborative decision-making: document ownership, design decisions, task assignment, etc.

**Core Concepts:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Proposal & Voting                             │
│                                                                  │
│  Proposal Types:                                                 │
│   - election: Choose one agent (document owner, task lead)      │
│   - decision: Choose one option (design choice, approach)       │
│   - approval: Yes/No on a single proposal                       │
│   - assignment: Distribute tasks among agents                   │
│                                                                  │
│  Resolution Rules:                                               │
│   - plurality: Most votes wins (default)                        │
│   - majority: >50% required                                     │
│   - unanimous: All must agree                                   │
│   - quorum: Minimum voters required                             │
│                                                                  │
│  Lifecycle:                                                      │
│   pending → active → resolved/expired                           │
│                                                                  │
│  Binding:                                                        │
│   - binding: System enforces result (e.g., document owner)      │
│   - advisory: Agents should respect but not enforced            │
└─────────────────────────────────────────────────────────────────┘
```

**Proposal Interface:**

```typescript
interface Proposal {
  id: string                    // Unique ID (e.g., 'doc-owner-001')
  type: 'election' | 'decision' | 'approval' | 'assignment'
  title: string                 // "Document Owner Election"
  description?: string          // Context for voters
  options: ProposalOption[]     // Available choices
  createdBy: string             // Agent or 'system'
  createdAt: string             // ISO timestamp
  expiresAt?: string            // Auto-resolve deadline
  resolution: ResolutionRule
  binding: boolean              // Enforced by system?
  status: 'active' | 'resolved' | 'expired' | 'cancelled'
  result?: ProposalResult
}

interface ProposalOption {
  id: string                    // 'opt-1', 'scribe', etc.
  label: string                 // Display text
  metadata?: Record<string, unknown>  // Type-specific data
}

interface ResolutionRule {
  type: 'plurality' | 'majority' | 'unanimous'
  quorum?: number               // Minimum voters (default: all agents)
  tieBreaker?: 'first' | 'random' | 'creator-decides'
}

interface ProposalResult {
  winner?: string               // Winning option ID
  votes: Map<string, string>    // voter → option
  counts: Map<string, number>   // option → count
  resolvedAt: string
  resolvedBy: 'votes' | 'timeout' | 'creator' | 'system'
}
```

**MCP Tools:**

```typescript
// Create a new proposal
server.tool('proposal_create', {
  type: z.enum(['election', 'decision', 'approval', 'assignment']),
  title: z.string(),
  description: z.string().optional(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
  })).optional(),  // Auto-generated for election (agents) / approval (yes/no)
  resolution: z.object({
    type: z.enum(['plurality', 'majority', 'unanimous']).default('plurality'),
    quorum: z.number().optional(),
  }).optional(),
  binding: z.boolean().default(false),
  timeoutSeconds: z.number().default(60),
}, async (params, extra) => {
  const creator = extra.sessionId
  const proposal = createProposal(creator, params)

  // Post to channel
  await provider.appendChannel('system',
    `[PROPOSAL:${proposal.id}] ${proposal.title}\n` +
    `Type: ${proposal.type} | Resolution: ${proposal.resolution.type}\n` +
    `Options: ${proposal.options.map(o => o.label).join(', ')}\n` +
    `Vote with: vote({ proposal: '${proposal.id}', choice: '<option-id>' })`
  )

  return { content: [{ type: 'text', text: JSON.stringify(proposal) }] }
})

// Vote on a proposal
server.tool('vote', {
  proposal: z.string().describe('Proposal ID'),
  choice: z.string().describe('Option ID to vote for'),
  reason: z.string().optional(),
}, async ({ proposal: proposalId, choice, reason }, extra) => {
  const voter = extra.sessionId
  const proposal = proposals.get(proposalId)

  if (!proposal) {
    return { content: [{ type: 'text', text: `Error: Proposal ${proposalId} not found` }] }
  }

  if (proposal.status !== 'active') {
    return { content: [{ type: 'text', text: `Error: Proposal is ${proposal.status}` }] }
  }

  if (!proposal.options.find(o => o.id === choice)) {
    return { content: [{ type: 'text', text: `Error: Invalid option. Valid: ${proposal.options.map(o => o.id).join(', ')}` }] }
  }

  // Check for duplicate vote (idempotency on retry)
  const existingVote = proposal.result!.votes.get(voter)
  if (existingVote) {
    if (existingVote === choice) {
      // Same vote - idempotent, just return success
      return {
        content: [{
          type: 'text',
          text: `Vote already recorded for "${proposal.options.find(o => o.id === choice)!.label}".`
        }]
      }
    } else {
      // Different vote - reject change (votes are final)
      return {
        content: [{
          type: 'text',
          text: `Error: You already voted for "${proposal.options.find(o => o.id === existingVote)!.label}". Votes cannot be changed.`
        }]
      }
    }
  }

  // Record vote
  proposal.result!.votes.set(voter, choice)

  // Post to channel
  const reasonInfo = reason ? ` (${reason})` : ''
  const optionLabel = proposal.options.find(o => o.id === choice)!.label
  await provider.appendChannel(voter,
    `[VOTE:${proposalId}] I vote for "${optionLabel}"${reasonInfo}`
  )

  // Check if should resolve
  const voteCount = proposal.result!.votes.size
  const quorum = proposal.resolution.quorum || validAgents.length

  if (voteCount >= quorum) {
    await resolveProposal(proposal)
  }

  return {
    content: [{
      type: 'text',
      text: `Vote recorded. ${voteCount}/${quorum} votes received.`
    }]
  }
})

// Check proposal status
server.tool('proposal_status', {
  proposal: z.string().optional().describe('Proposal ID (omit for all active)'),
}, async ({ proposal: proposalId }) => {
  if (proposalId) {
    const proposal = proposals.get(proposalId)
    return { content: [{ type: 'text', text: JSON.stringify(proposal) }] }
  }

  const active = Array.from(proposals.values()).filter(p => p.status === 'active')
  return { content: [{ type: 'text', text: JSON.stringify(active) }] }
})

// Cancel a proposal (creator only)
server.tool('proposal_cancel', {
  proposal: z.string(),
  reason: z.string().optional(),
}, async ({ proposal: proposalId, reason }, extra) => {
  const agent = extra.sessionId
  const proposal = proposals.get(proposalId)

  if (!proposal) {
    return { content: [{ type: 'text', text: `Error: Proposal ${proposalId} not found` }] }
  }

  if (proposal.createdBy !== agent && agent !== 'system') {
    return { content: [{ type: 'text', text: `Error: Only creator can cancel` }] }
  }

  proposal.status = 'cancelled'

  await provider.appendChannel('system',
    `[PROPOSAL:${proposalId}] Cancelled${reason ? `: ${reason}` : ''}`
  )

  return { content: [{ type: 'text', text: 'Proposal cancelled' }] }
})
```

**Resolution Logic:**

```typescript
async function resolveProposal(proposal: Proposal) {
  const votes = proposal.result!.votes
  const counts = new Map<string, number>()

  // Count votes
  for (const choice of votes.values()) {
    counts.set(choice, (counts.get(choice) || 0) + 1)
  }

  proposal.result!.counts = counts

  // Determine winner based on resolution rule
  let winner: string | undefined

  switch (proposal.resolution.type) {
    case 'plurality': {
      // Most votes wins
      let maxVotes = 0
      for (const [option, count] of counts) {
        if (count > maxVotes) {
          maxVotes = count
          winner = option
        }
      }
      break
    }
    case 'majority': {
      // >50% required
      const total = votes.size
      for (const [option, count] of counts) {
        if (count > total / 2) {
          winner = option
          break
        }
      }
      break
    }
    case 'unanimous': {
      // All same vote
      const choices = new Set(votes.values())
      if (choices.size === 1) {
        winner = [...choices][0]
      }
      break
    }
  }

  proposal.status = 'resolved'
  proposal.result!.winner = winner
  proposal.result!.resolvedAt = new Date().toISOString()
  proposal.result!.resolvedBy = 'votes'

  // Post result
  const winnerLabel = winner
    ? proposal.options.find(o => o.id === winner)!.label
    : 'No winner (tie/no majority)'

  await provider.appendChannel('system',
    `[RESOLVED:${proposal.id}] ${proposal.title}\n` +
    `Result: ${winnerLabel}\n` +
    `Votes: ${Array.from(counts.entries()).map(([o, c]) => `${o}=${c}`).join(', ')}`
  )

  // Apply binding result
  if (proposal.binding && winner) {
    await applyProposalResult(proposal, winner)
  }
}

async function applyProposalResult(proposal: Proposal, winner: string) {
  // Type-specific binding logic
  switch (proposal.type) {
    case 'election':
      // Check if this is a document owner election
      if (proposal.id.startsWith('doc-owner')) {
        config.documentOwner = winner
      }
      break
    case 'assignment':
      // Could update task assignments
      break
    // Other types are typically advisory
  }
}
```

**Proposal Persistence & Archiving:**

Proposals have two storage locations with different purposes:

```
.workflow/instance/
├── _state/                 # Internal state
│   ├── inbox-state.json    # Per-agent read cursors
│   └── proposals.json      # Active proposals only (runtime)
├── channel.md              # Channel: communication log
└── documents/              # Document: user workspace
    ├── notes.md            # Entry point
    └── decisions.md        # Decision archive (permanent)
```

| Storage | Purpose | Lifecycle |
|---------|---------|-----------|
| `_state/proposals.json` | Active proposal state | Short-term (deleted on resolve) |
| `channel.md` | Event timeline ([VOTE] messages) | Append-only |
| `documents/decisions.md` | Decision archive | Permanent (queryable record) |

```typescript
// proposals.json - only active proposals
interface ProposalsState {
  proposals: Record<string, Proposal>  // Only status === 'active'
  version: number
}

// Load active proposals on startup
async function loadProposals(contextDir: string): Promise<Map<string, Proposal>> {
  const path = join(contextDir, '_state', 'proposals.json')
  try {
    const data = JSON.parse(await fs.readFile(path, 'utf-8'))
    return new Map(Object.entries(data.proposals))
  } catch {
    return new Map()
  }
}

// Save after mutation (only active proposals)
async function saveProposals(contextDir: string, proposals: Map<string, Proposal>): Promise<void> {
  const activeOnly = [...proposals.entries()].filter(([_, p]) => p.status === 'active')
  const data: ProposalsState = {
    proposals: Object.fromEntries(activeOnly),
    version: Date.now(),
  }
  await fs.writeFile(join(contextDir, '_state', 'proposals.json'), JSON.stringify(data, null, 2))
}
```

**Decision Archiving:**

When a proposal resolves, it's archived to `decisions.md` for permanent record:

```typescript
async function resolveProposal(proposal: Proposal) {
  // ... existing resolution logic ...

  proposal.status = 'resolved'
  proposal.result!.resolvedAt = new Date().toISOString()

  // 1. Post to channel (event log)
  await provider.appendChannel('system', `[RESOLVED:${proposal.id}] ...`)

  // 2. Archive to decisions.md (permanent record)
  await archiveDecision(proposal)

  // 3. Remove from proposals.json (cleanup)
  proposals.delete(proposal.id)
  await saveProposals(contextDir, proposals)

  // 4. Apply binding result
  if (proposal.binding && proposal.result!.winner) {
    await applyProposalResult(proposal, proposal.result!.winner)
  }
}

async function archiveDecision(proposal: Proposal) {
  const winner = proposal.options.find(o => o.id === proposal.result!.winner)
  const votes = [...proposal.result!.votes.entries()]
    .map(([voter, choice]) => `${voter}→${choice}`)
    .join(', ')

  const archive = `
### ${proposal.title}
- **ID**: ${proposal.id}
- **Type**: ${proposal.type}
- **Resolved**: ${proposal.result!.resolvedAt}
- **Result**: ${winner?.label || 'No winner'}
- **Votes**: ${votes || 'None'}
${proposal.binding ? '- **Binding**: Yes (applied to system)' : '- **Binding**: No (advisory)'}
---
`
  await provider.appendDocument(archive, 'decisions.md')
}
```

**decisions.md Example:**

```markdown
# Decisions Log

### Document Owner Election
- **ID**: doc-owner-001
- **Type**: election
- **Resolved**: 2024-01-15T10:05:00Z
- **Result**: @scribe
- **Votes**: reviewer→scribe, coder→scribe, scribe→coder
- **Binding**: Yes (applied to system)
---

### Authentication Approach
- **ID**: decision-auth-001
- **Type**: decision
- **Resolved**: 2024-01-15T10:30:00Z
- **Result**: JWT tokens
- **Votes**: reviewer→jwt, coder→jwt
- **Binding**: No (advisory)
---
```

This ensures:
- Active proposals survive runner restarts (`_state/proposals.json`)
- All events are logged in timeline (`channel.md`)
- Decisions are permanently archived and queryable (`documents/decisions.md`)
- No state bloat (resolved proposals removed from runtime)

**Use Case Examples:**

```typescript
// 1. Document Owner Election (system-initiated)
await tools.proposal_create({
  type: 'election',
  title: 'Document Owner Election',
  description: 'Choose who maintains workflow documentation',
  // options auto-populated with agent names
  binding: true,
  timeoutSeconds: 30,
})

// 2. Design Decision (agent-initiated)
await tools.proposal_create({
  type: 'decision',
  title: 'Authentication Approach',
  description: 'How should we implement user auth?',
  options: [
    { id: 'jwt', label: 'JWT tokens' },
    { id: 'session', label: 'Server sessions' },
    { id: 'oauth', label: 'OAuth only' },
  ],
  resolution: { type: 'majority' },
  binding: false,  // Advisory - agents decide how to proceed
  timeoutSeconds: 120,
})

// 3. Task Assignment
await tools.proposal_create({
  type: 'assignment',
  title: 'Code Review Tasks',
  description: 'Who handles which part?',
  options: [
    { id: 'auth', label: 'Auth module → ?' },
    { id: 'api', label: 'API routes → ?' },
    { id: 'db', label: 'Database → ?' },
  ],
  // Agents vote for tasks they want
  binding: false,
  timeoutSeconds: 60,
})

// 4. Simple Approval
await tools.proposal_create({
  type: 'approval',
  title: 'Ready to merge?',
  description: 'All issues addressed, tests passing. Approve merge?',
  // options auto: [{ id: 'yes', label: 'Approve' }, { id: 'no', label: 'Reject' }]
  resolution: { type: 'unanimous' },
  binding: false,
  timeoutSeconds: 60,
})
```

**System Prompt Guidance:**

```markdown
## Proposals & Voting

When you see a [PROPOSAL] message, participate in the decision:

1. **Review the proposal** - understand what's being decided
2. **Vote** using: `vote({ proposal: '<id>', choice: '<option>', reason: '...' })`
3. **Check status** with: `proposal_status({ proposal: '<id>' })`

You can also create proposals:
- **Decision needed?** Create a decision proposal
- **Task distribution?** Create an assignment proposal
- **Need consensus?** Create an approval proposal

Binding proposals are enforced by the system. Advisory proposals rely on agent cooperation.
```

**Document Owner Election (Simplified):**

With the generic system, document owner election becomes:

```typescript
// System auto-creates this when multiple agents + no documentOwner
function startDocumentOwnerElection() {
  const options = validAgents.map(agent => ({
    id: agent,
    label: `@${agent}`,
  }))

  return tools.proposal_create({
    type: 'election',
    title: 'Document Owner Election',
    description: 'Elect an agent to maintain workflow documents. ' +
                 'The winner will have exclusive write access.',
    options,
    resolution: { type: 'plurality', tieBreaker: 'first' },
    binding: true,
    timeoutSeconds: 30,
  })
}
```

**Election Timing:**

Document owner election happens at workflow start, **before kickoff**:

```
┌────────────────────────────────────────────────────────────────┐
│                    Workflow Startup Sequence                    │
│                                                                 │
│  1. Parse workflow, create providers                           │
│  2. Start MCP server                                           │
│  3. Check document owner config:                               │
│     - Single agent → owner = self (no election)                │
│     - Multiple + specified → use config                        │
│     - Multiple + unspecified → START ELECTION                  │
│                                                                 │
│  4. If election needed:                                        │
│     a. Post [PROPOSAL] to channel (includes @mentions to all)  │
│     b. Start all agent controllers                             │
│     c. Wait for election to resolve (timeout: 30s)             │
│     d. Apply result (set documentOwner)                        │
│                                                                 │
│  5. Send kickoff message                                       │
│  6. Agents collaborate normally                                │
└────────────────────────────────────────────────────────────────┘
```

The election proposal @mentions all agents to wake them:

```typescript
// Election message includes @mentions to ensure agents wake
const electionMessage = `[PROPOSAL:${proposal.id}] Document Owner Election\n` +
  `${validAgents.map(a => `@${a}`).join(' ')}\n` +  // @mention all
  `Vote for who should maintain documents. Use: vote({ proposal: '${proposal.id}', choice: '<agent-name>' })`
```

**Timeout Fallback:**

If election times out without resolution:

```typescript
async function handleElectionTimeout(proposal: Proposal) {
  if (proposal.result!.votes.size === 0) {
    // No votes → disable ownership (no single writer)
    config.documentOwner = undefined
    await provider.appendChannel('system',
      `[EXPIRED:${proposal.id}] No votes received. Document ownership disabled.`
    )
  } else {
    // Partial votes → resolve with what we have
    await resolveProposal(proposal)
  }
}
```

**Document Write During Election:**

While election is pending, document writes are queued or rejected:

```typescript
server.tool('document_write', { ... }, async ({ content, file }, extra) => {
  // Check for pending election
  const pendingElection = proposals.values()
    .find(p => p.type === 'election' && p.id.startsWith('doc-owner') && p.status === 'active')

  if (pendingElection) {
    return {
      content: [{
        type: 'text',
        text: `Error: Document owner election in progress (${pendingElection.id}). ` +
              `Please vote and wait for resolution before writing.`
      }]
    }
  }

  // Normal ownership check...
})
```

### Inbox Design

The inbox is a **derived view** of channel @mentions, filtered to unread messages for a specific agent.

**Inbox State**:

```typescript
interface InboxState {
  /** Per-agent read cursor (timestamp of last read message) */
  readCursors: Map<string, string>
}

interface InboxMessage {
  /** Original channel entry */
  entry: ChannelEntry
  /** Is this message unread? */
  unread: boolean
  /** Priority (multiple @mentions, urgent keywords) */
  priority: 'normal' | 'high'
}
```

**Inbox Operations**:

| Operation | Effect |
|-----------|--------|
| `inbox_check` | Get unread messages for this agent (does NOT auto-acknowledge) |
| `inbox_ack` | Mark messages as read (up to timestamp) |

> **Note**: `inbox_check` does not acknowledge messages. Agents must explicitly call `inbox_ack` after processing. This allows agents to: (1) check inbox, (2) process messages, (3) acknowledge only after successful completion.

**Example Flow**:

```
1. @reviewer sends: "@coder please fix the auth issue"

2. Channel entry created:
   { from: 'reviewer', message: '@coder please fix...', mentions: ['coder'] }

3. Coder's inbox now shows 1 unread:
   inbox_check() → [{ entry: {...}, unread: true }]

4. Coder reads and acknowledges:
   inbox_ack({ until: '2024-01-15T10:05:00Z' })

5. Coder's inbox is now empty:
   inbox_check() → []
```

**Priority Detection**:

Messages with multiple @mentions or urgent keywords get elevated priority:

```typescript
function calculatePriority(entry: ChannelEntry): 'normal' | 'high' {
  // Multiple mentions = coordination needed
  if (entry.mentions.length > 1) return 'high'

  // Urgent keywords
  const urgentPatterns = /\b(urgent|asap|blocked|critical)\b/i
  if (urgentPatterns.test(entry.message)) return 'high'

  return 'normal'
}
```

### Agent Controller

The Runner manages each agent via an AgentController. Agents don't manage their own polling - the controller does.

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Runner                           │
│                                                              │
│  For each agent:                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Agent Controller                        │   │
│  │                                                      │   │
│  │  State: idle | running | stopped                    │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │                   IDLE                         │ │   │
│  │  │  - Polling inbox every N seconds               │ │   │
│  │  │  - Or: wake() called on @mention               │ │   │
│  │  └─────────────────────┬──────────────────────────┘ │   │
│  │                        │ unread messages?            │   │
│  │                        ▼                             │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │                  RUNNING                       │ │   │
│  │  │  - Spawn agent process (backend-specific)      │ │   │
│  │  │  - Agent reads inbox, channel, document        │ │   │
│  │  │  - Agent does work                            │ │   │
│  │  │  - Agent sends to channel, updates document   │ │   │
│  │  │  - Agent process exits                        │ │   │
│  │  └─────────────────────┬──────────────────────────┘ │   │
│  │                        │                             │   │
│  │                        ▼                             │   │
│  │                   back to IDLE                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  When @mention detected in channel_send():                  │
│    → agentControllers.get(target).wake()                   │
└─────────────────────────────────────────────────────────────┘
```

**AgentController Interface:**

```typescript
interface AgentController {
  /** Agent name */
  name: string

  /** Current state */
  state: 'idle' | 'running' | 'stopped'

  /** Start the controller (begin polling loop) */
  start(): Promise<void>

  /** Stop the controller */
  stop(): Promise<void>

  /** Interrupt: immediately check inbox (skip poll wait) */
  wake(): void
}

interface AgentControllerConfig {
  /** Agent name */
  name: string

  /** Resolved agent config */
  agent: ResolvedAgent

  /** Context provider */
  contextProvider: ContextProvider

  /** MCP socket path */
  mcpSocketPath: string

  /** Poll interval in ms (default: 5000) */
  pollInterval?: number

  /** Retry configuration */
  retry?: RetryConfig

  /** Run agent and return when done */
  runAgent: (context: AgentRunContext) => Promise<AgentRunResult>
}

interface RetryConfig {
  /** Max retry attempts on failure (default: 3) */
  maxAttempts?: number
  /** Initial backoff delay in ms (default: 1000) */
  backoffMs?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
}

**Controller Responsibilities:**

The controller handles lifecycle concerns that agents shouldn't manage:

1. **Inbox Acknowledgment**: Controller acknowledges inbox AFTER successful agent run
   - Success: `ackInbox(agent, latestInboxTimestamp)`
   - Failure: Don't acknowledge → messages redelivered on retry

2. **Retry on Failure**: Exponential backoff with configurable limits
   ```
   Attempt 1: Run agent
   Failure → wait 1000ms
   Attempt 2: Run agent
   Failure → wait 2000ms
   Attempt 3: Run agent
   Failure → log error, move to idle (messages stay unread)
   ```

3. **Error Isolation**: One agent's failure doesn't affect others

```typescript
// Simplified controller loop
async function controllerLoop(config: AgentControllerConfig) {
  const provider = config.contextProvider

  while (state !== 'stopped') {
    // Wait for wake() or poll interval
    await waitForWakeOrPoll()

    const inbox = await provider.getInbox(config.name)
    if (inbox.length === 0) continue

    // Get latest inbox timestamp for acknowledgment
    const latestTimestamp = inbox[inbox.length - 1].entry.timestamp

    // Run agent with retry
    let attempt = 0
    const maxAttempts = config.retry?.maxAttempts ?? 3

    while (attempt < maxAttempts) {
      attempt++
      state = 'running'

      const result = await config.runAgent({
        name: config.name,
        agent: config.agent,
        inbox,
        recentChannel: await provider.readChannel(undefined, 50),
        documentContent: await provider.readDocument(),
        mcpSocketPath: config.mcpSocketPath,
        retryAttempt: attempt,  // Let agent know if this is a retry
      })

      if (result.success) {
        // Acknowledge inbox ONLY on success
        await provider.ackInbox(config.name, latestTimestamp)
        break
      }

      // Retry with backoff
      if (attempt < maxAttempts) {
        const delay = (config.retry?.backoffMs ?? 1000) *
                      Math.pow(config.retry?.backoffMultiplier ?? 2, attempt - 1)
        await sleep(delay)
      }
    }

    state = 'idle'
  }
}
```

interface AgentRunContext {
  /** Agent name */
  name: string

  /** Agent config */
  agent: ResolvedAgent

  /** Unread inbox messages */
  inbox: InboxMessage[]

  /** Recent channel entries (for context) */
  recentChannel: ChannelEntry[]

  /** Current document content (entry point) */
  documentContent: string

  /** MCP socket path */
  mcpSocketPath: string

  /** Retry attempt number (1 = first try, 2+ = retry) */
  retryAttempt: number
}
```

**Wake on @mention:**

The MCP server calls `onMention` callback when agents are @mentioned. The runner uses this to wake idle controllers:

```typescript
// Runner creates MCP server with onMention callback
const agentControllers = new Map<string, AgentController>()

const { server } = createContextMCPServer({
  provider,
  validAgents,
  onMention: (from, target, entry) => {
    // Wake mentioned agent's controller if idle
    const controller = agentControllers.get(target)
    if (controller?.state === 'idle') {
      controller.wake()
    }
  }
})
```

This pattern decouples the MCP server from controller implementation, making testing easier.

### Context Management

**Key insight: Channel IS the conversation history.**

Agents don't need traditional message history because:
- Channel = collaborative history (who said what)
- Document = current state (goals, progress)
- Inbox = what needs attention

Each agent run gets fresh context built from these sources (see `AgentRunContext` above).

/** Build unified prompt from context */
function buildAgentPrompt(ctx: AgentRunContext): string {
  return `
## Inbox (${ctx.inbox.length} messages for you)
${formatInbox(ctx.inbox)}

## Recent Activity
${formatChannel(ctx.recentChannel)}

## Current Workspace
${ctx.documentContent}

## Instructions
Process your inbox messages. Use MCP tools to collaborate.
When done handling all messages, exit.
`
}

function formatInbox(inbox: InboxMessage[]): string {
  if (inbox.length === 0) return '(no messages)'

  return inbox.map(m => {
    const priority = m.priority === 'high' ? ' [HIGH]' : ''
    return `- From @${m.entry.from}${priority}: ${m.entry.message}`
  }).join('\n')
}

function formatChannel(entries: ChannelEntry[]): string {
  return entries.map(e =>
    `[${e.timestamp.slice(11, 19)}] @${e.from}: ${e.message}`
  ).join('\n')
}
```

### Backend Abstraction

Unified interface for all backends:

```typescript
interface AgentBackend {
  /** Backend name */
  name: string

  /** Run agent with context */
  run(ctx: AgentRunContext): Promise<AgentRunResult>
}

interface AgentRunResult {
  success: boolean
  error?: string
  duration: number
}

/**
 * Success Criteria for Different Backends
 *
 * SDK Backend:
 * - success = response.stop_reason === 'end_turn' (natural completion)
 * - failure = API error, rate limit, or tool error
 *
 * CLI Backends (Claude, Codex, Cursor):
 * - success = exit code 0 AND no error patterns in output
 * - failure = exit code non-zero OR known error patterns
 *
 * Error patterns to detect:
 * - "Error:", "error:", "ERROR"
 * - "Failed to", "failed to"
 * - "Exception:", "exception:"
 * - API rate limit messages
 */
const CLI_ERROR_PATTERNS = [
  /\bError:/i,
  /\bFailed to\b/i,
  /\bException:/i,
  /rate limit/i,
  /API error/i,
  /connection refused/i,
]

function detectCLIError(stdout: string, stderr: string, exitCode: number): string | undefined {
  if (exitCode !== 0) {
    return `Process exited with code ${exitCode}`
  }

  for (const pattern of CLI_ERROR_PATTERNS) {
    const match = stderr.match(pattern) || stdout.match(pattern)
    if (match) {
      return `Error detected: ${match[0]}`
    }
  }

  return undefined  // No error detected
}
```

**SDK Backend** (full control):

```typescript
class SDKBackend implements AgentBackend {
  name = 'sdk'

  constructor(private client: Anthropic) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()
    const messages: Message[] = [
      { role: 'user', content: buildAgentPrompt(ctx) }
    ]

    try {
      // Get MCP tools
      const tools = await getMCPTools(ctx.mcpSocketPath)

      // Agent loop
      while (true) {
        const response = await this.client.messages.create({
          model: parseModel(ctx.agent.model),  // 'anthropic/claude-sonnet-4-5' → 'claude-sonnet-4-5-20250514'
          system: ctx.agent.resolvedSystemPrompt,
          messages,
          tools,
          max_tokens: 4096,
        })

        // Check for completion
        if (response.stop_reason === 'end_turn') break

        // Handle tool calls
        const toolResults = await handleToolCalls(response, ctx.mcpSocketPath)
        messages.push({ role: 'assistant', content: response.content })
        messages.push({ role: 'user', content: toolResults })
      }

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }
}
```

**CLI Backend** (Claude CLI, Codex):

```typescript
class CLIBackend implements AgentBackend {
  constructor(
    public name: string,
    private command: string,
    private buildArgs: (ctx: AgentRunContext, mcpConfigPath: string) => string[]
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()

    try {
      // Generate MCP config file
      const mcpConfigPath = `/tmp/agent-${ctx.name}-mcp.json`
      const mcpConfig = generateMCPConfig(ctx.mcpSocketPath, ctx.name)
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig))

      // Write system prompt to file
      const systemPromptPath = `/tmp/agent-${ctx.name}-system.md`
      writeFileSync(systemPromptPath, ctx.agent.resolvedSystemPrompt)

      // Build and run command
      const prompt = buildAgentPrompt(ctx)
      const args = this.buildArgs(ctx, mcpConfigPath)

      await exec(`${this.command} ${args.join(' ')} "${escapePrompt(prompt)}"`)

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }
}

// Claude CLI backend
const claudeBackend = new CLIBackend(
  'claude',
  'claude',
  (ctx, mcpConfigPath) => [
    '-p',
    '--mcp-config', mcpConfigPath,
    '--system-prompt', `/tmp/agent-${ctx.name}-system.md`,
  ]
)

// Codex CLI backend
const codexBackend = new CLIBackend(
  'codex',
  'codex',
  (ctx, mcpConfigPath) => {
    // Codex uses project-level config, need to set up .codex/config.toml
    setupCodexConfig(mcpConfigPath)
    return []  // Codex auto-discovers config
  }
)
```

**Backend Selection by Model:**

```typescript
function getBackendForModel(model: string): AgentBackend {
  // Parse provider from model string: 'anthropic/claude-sonnet-4-5'
  const [provider] = model.split('/')

  switch (provider) {
    case 'anthropic':
      return new SDKBackend(anthropicClient)
    case 'openai':
      // OpenAI models might use Codex CLI or SDK
      return codexBackend
    default:
      // Default to Claude CLI for unknown
      return claudeBackend
  }
}
```

**Model String Parsing:**

Model strings support multiple formats for flexibility:

```typescript
/** Model aliases for convenience */
const MODEL_ALIASES: Record<string, string> = {
  // Anthropic shortcuts
  'sonnet': 'anthropic/claude-sonnet-4-5',
  'opus': 'anthropic/claude-opus-4',
  'haiku': 'anthropic/claude-haiku-3-5',

  // Full names without provider
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
  'claude-opus-4': 'anthropic/claude-opus-4',
  'claude-haiku-3-5': 'anthropic/claude-haiku-3-5',
}

/** Current model versions (may be updated) */
const MODEL_VERSIONS: Record<string, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-haiku-3-5': 'claude-haiku-3-5-20250620',
}

interface ParsedModel {
  provider: string    // 'anthropic', 'openai', etc.
  name: string        // 'claude-sonnet-4-5'
  apiModelId: string  // 'claude-sonnet-4-5-20250514' (for API calls)
}

function parseModel(model: string): ParsedModel {
  // 1. Resolve alias first
  const resolved = MODEL_ALIASES[model] || model

  // 2. Parse provider/name
  let provider: string
  let name: string

  if (resolved.includes('/')) {
    [provider, name] = resolved.split('/')
  } else {
    // Assume Anthropic if no provider specified
    provider = 'anthropic'
    name = resolved
  }

  // 3. Get versioned API model ID
  const apiModelId = MODEL_VERSIONS[name] || name

  return { provider, name, apiModelId }
}

// Usage examples:
parseModel('sonnet')
// → { provider: 'anthropic', name: 'claude-sonnet-4-5', apiModelId: 'claude-sonnet-4-5-20250514' }

parseModel('anthropic/claude-opus-4')
// → { provider: 'anthropic', name: 'claude-opus-4', apiModelId: 'claude-opus-4-20250514' }

parseModel('openai/gpt-4o')
// → { provider: 'openai', name: 'gpt-4o', apiModelId: 'gpt-4o' }
```

**Backend Comparison:**

| Aspect | SDK | Claude CLI | Codex |
|--------|-----|------------|-------|
| Context | messages[] | Prompt only | Prompt only |
| History | Maintained in-process | Rebuilt each run | Rebuilt each run |
| System prompt | API param | --system-prompt | Config file |
| MCP tools | SDK injection | --mcp-config | .codex/config.toml |
| Multi-turn | Natural | Within single run | Within single run |
| Control | Full | Limited | Limited |

Key design principle: **Agents are stateless processes**. Each run starts fresh with inbox + channel context. The controller manages lifecycle.

### Agent Work Loop

The recommended interaction pattern for agents:

```
┌─────────────────────────────────────────────────────────────────┐
│                       Agent Work Loop                            │
│                                                                   │
│  ┌─────────────┐                                                │
│  │   START     │                                                │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │  inbox_check()  │────▶│ Unread messages?                │   │
│  └─────────────────┘     └──────────────┬──────────────────┘   │
│                                         │                        │
│                          ┌──────────────┼──────────────┐        │
│                          │              │              │        │
│                          No            Yes            Yes       │
│                      (0 msgs)      (normal)        (high)       │
│                          │              │              │        │
│                          ▼              ▼              ▼        │
│                    ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│                    │  Wait/   │  │  Process  │  │  Process  │  │
│                    │  Idle    │  │  in order │  │  priority │  │
│                    └──────────┘  └─────┬─────┘  └─────┬─────┘  │
│                          │             │              │        │
│                          │             └──────┬───────┘        │
│                          │                    │                 │
│                          │                    ▼                 │
│                          │        ┌─────────────────────┐      │
│                          │        │ channel_read()      │      │
│                          │        │ (get full context)  │      │
│                          │        └──────────┬──────────┘      │
│                          │                   │                  │
│                          │                   ▼                  │
│                          │        ┌─────────────────────┐      │
│                          │        │ document_read()     │      │
│                          │        │ (check goals/todos) │      │
│                          │        └──────────┬──────────┘      │
│                          │                   │                  │
│                          │                   ▼                  │
│                          │        ┌─────────────────────┐      │
│                          │        │ DO WORK             │      │
│                          │        │ (actual task)       │      │
│                          │        └──────────┬──────────┘      │
│                          │                   │                  │
│                          │                   ▼                  │
│                          │        ┌─────────────────────┐      │
│                          │        │ document_write()    │      │
│                          │        │ (update findings)   │      │
│                          │        └──────────┬──────────┘      │
│                          │                   │                  │
│                          │                   ▼                  │
│                          │        ┌─────────────────────┐      │
│                          │        │ channel_send()      │      │
│                          │        │ (report + @mention) │      │
│                          │        └──────────┬──────────┘      │
│                          │                   │                  │
│                          │                   ▼                  │
│                          │        ┌─────────────────────┐      │
│                          │        │ inbox_ack()         │      │
│                          │        │ (mark as handled)   │      │
│                          │        └──────────┬──────────┘      │
│                          │                   │                  │
│                          └───────────────────┴─────────────────┘
│                                              │
│                                              ▼
│                                        (loop back)
└─────────────────────────────────────────────────────────────────┘
```

**System Prompt Guidance** (for agents):

```markdown
## Workflow Participation

You are part of a multi-agent workflow. Use these tools to collaborate:

### Starting Work
1. `inbox_check()` - See what messages are waiting for you
2. `channel_read()` - Understand the full context
3. `document_read()` - Check goals and current status

### During Work
- Update `document_write()` with findings as you go
- Use `channel_send()` to coordinate with others (@mention them)

### Completing Work
1. `channel_send()` - Report completion, @mention next agent if needed
2. `inbox_ack()` - Mark handled messages as read
3. Check inbox again for new messages

### Priority
- High priority (multiple @mentions, "urgent") - handle first
- Normal priority - handle in order received
```

---

## Schema Definition

```typescript
interface WorkflowFile {
  /** Workflow name (defaults to filename) */
  name?: string

  /**
   * Shared context configuration
   * - undefined/null: default file provider enabled
   * - false: explicitly disabled
   * - object: custom provider configuration
   */
  context?: ContextConfig

  /** Agent definitions */
  agents: Record<string, AgentDefinition>

  /** Setup commands (run before kickoff) */
  setup?: SetupTask[]

  /**
   * Kickoff message - initiates workflow via @mention
   * Optional: if omitted, agents start but wait for external trigger
   */
  kickoff?: string
}

/** Context configuration: false to disable, or provider config */
type ContextConfig = false | FileContextConfig | MemoryContextConfig

interface FileContextConfig {
  provider: 'file'
  /** Document owner (cross-provider config) */
  documentOwner?: string
  config?: {
    dir?: string           // default: .workflow/${{ instance }}/
    channel?: string       // default: channel.md (in dir)
    documentDir?: string   // default: documents/ (in dir)
    document?: string      // default: notes.md (in documentDir)
  }
}

interface MemoryContextConfig {
  provider: 'memory'
  /** Document owner (cross-provider config) */
  documentOwner?: string
}

// Note: documentOwner defaults:
// - Single agent: disabled (no ownership needed)
// - Multiple agents, not specified: trigger election
// - Specified: use that agent

interface AgentDefinition {
  /** Model identifier */
  model: string

  /** System prompt - inline string or file path */
  system_prompt: string

  /** Tool names to enable */
  tools?: string[]
}

interface SetupTask {
  /** Shell command to execute */
  shell: string

  /** Variable name to store output */
  as?: string
}

/** A single channel entry */
interface ChannelEntry {
  /** ISO timestamp */
  timestamp: string
  /** Author agent name or 'system' */
  from: string
  /** Message content */
  message: string
  /** Extracted @mentions */
  mentions: string[]
}

/** @mention notification */
interface MentionNotification {
  /** Who sent the message */
  from: string
  /** Who was mentioned */
  target: string
  /** The message content */
  message: string
  /** Entry timestamp */
  timestamp: string
}

/** Inbox message (derived from channel @mentions) */
interface InboxMessage {
  /** Original channel entry */
  entry: ChannelEntry
  /** Is this message unread? */
  unread: boolean
  /** Message priority */
  priority: 'normal' | 'high'
}

/** Per-agent inbox state */
interface InboxState {
  /** Last acknowledged timestamp per agent */
  readCursors: Map<string, string>
}
```

---

## @Mention System

### How It Works

1. Agent writes to channel with @mention
2. System detects @mention pattern
3. Mentioned agent receives notification
4. Agent can respond via channel

```
reviewer writes: "@coder please fix the auth issue"
                     │
                     ▼
              ┌──────────────┐
              │ System parses │
              │   @coder      │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐
              │ coder gets   │
              │ notification │
              └──────────────┘
```

### Mention Pattern

```typescript
const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)/g

function extractMentions(message: string, validAgents: string[]): string[] {
  const mentions: string[] = []
  let match: RegExpExecArray | null

  while ((match = MENTION_PATTERN.exec(message)) !== null) {
    const agent = match[1]
    if (validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent)
    }
  }

  return mentions
}
```

---

## Context MCP Server

Context is provided to agents via an MCP server, not direct file access.

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      Workflow Runner                           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │           Context MCP Server (Unix Socket)                │ │
│  │                                                           │ │
│  │  Channel:              Inbox:              Document:     │ │
│  │   - channel_send        - inbox_check       - document_read     │ │
│  │   - channel_read        - inbox_ack         - document_write    │ │
│  │                                              - document_append   │ │
│  │                                              - document_list     │ │
│  │                                              - document_create   │ │
│  │                                                           │ │
│  │  Provider: FileProvider | MemoryProvider                 │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │ MCP (Unix Socket / HTTP / stdio)
        ┌───────────────────┼───────────────────┐
        │         │         │         │         │
        ▼         ▼         ▼         ▼         ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Agent  │ │ Agent  │ │ Agent  │ │ Agent  │ │ Agent  │
   │ (SDK)  │ │(Claude)│ │(Codex) │ │(Cursor)│ │ (CLI)  │
   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

### Implementation

Using official MCP SDK (`@modelcontextprotocol/sdk`):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// Context Provider interface (storage abstraction)
interface ContextProvider {
  // Channel operations
  appendChannel(from: string, message: string): Promise<ChannelEntry>
  readChannel(since?: string, limit?: number): Promise<ChannelEntry[]>

  // Inbox operations (derived from channel @mentions)
  // NOTE: getInbox does NOT acknowledge - explicit ackInbox required
  getInbox(agent: string): Promise<InboxMessage[]>
  ackInbox(agent: string, until: string): Promise<void>

  // Document operations
  readDocument(file?: string): Promise<string>
  writeDocument(content: string, file?: string): Promise<void>
  appendDocument(content: string, file?: string): Promise<void>

  // Multi-file document operations
  listDocuments(): Promise<string[]>
  createDocument(file: string, content: string): Promise<void>
  deleteDocument(file: string): Promise<void>
}

/** Options for creating Context MCP Server */
interface ContextMCPServerOptions {
  provider: ContextProvider
  validAgents: string[]
  /** Called when an agent is @mentioned - used to wake idle controllers */
  onMention?: (from: string, target: string, entry: ChannelEntry) => void
}

// MCP Server for Context
function createContextMCPServer(options: ContextMCPServerOptions) {
  const { provider, validAgents, onMention } = options

  const server = new McpServer({
    name: 'workflow-context',
    version: '1.0.0',
  })

  // Track connected agents for notifications
  const agentConnections = new Map<string, McpConnection>()

  // Channel tools
  server.tool('channel_send', {
    message: z.string().describe('Message to send, can include @mentions'),
  }, async ({ message }, extra) => {
    // Agent identity from connection metadata (set during handshake)
    const from = extra.sessionId  // Agent ID from session
    const entry = await provider.appendChannel(from, message)

    // Notify mentioned agents via MCP notifications
    for (const target of entry.mentions) {
      const conn = agentConnections.get(target)
      if (conn) {
        await conn.notify('notifications/mention', {
          from,
          target,
          message,
          timestamp: entry.timestamp,
        })
      }

      // Call onMention callback to wake idle controllers
      // This decouples MCP server from controller implementation
      onMention?.(from, target, entry)
    }

    return { content: [{ type: 'text', text: 'sent' }] }
  })

  server.tool('channel_read', {
    since: z.string().optional().describe('Read entries after this timestamp'),
    limit: z.number().optional().describe('Max entries to return'),
  }, async ({ since, limit }) => {
    // NOTE: channel_read does NOT acknowledge mentions
    // Agents must explicitly call inbox_ack after processing
    const entries = await provider.readChannel(since, limit)
    return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
  })

  server.tool('channel_peek', {
    limit: z.number().optional().describe('Max entries to return'),
  }, async ({ limit }) => {
    // Peek doesn't acknowledge mentions
    const entries = await provider.readChannel(undefined, limit)
    return { content: [{ type: 'text', text: JSON.stringify(entries) }] }
  })

  // Inbox tools
  server.tool('inbox_check', {}, async (_, extra) => {
    const agent = extra.sessionId
    const messages = await provider.getInbox(agent)
    return { content: [{ type: 'text', text: JSON.stringify(messages) }] }
  })

  server.tool('inbox_ack', {
    until: z.string().describe('Acknowledge messages up to this timestamp'),
  }, async ({ until }, extra) => {
    const agent = extra.sessionId
    await provider.ackInbox(agent, until)
    return { content: [{ type: 'text', text: 'acknowledged' }] }
  })

  // NOTE: inbox_peek removed - inbox_check already doesn't acknowledge
  // If you need to check inbox without side effects, just use inbox_check

  // Document tools
  server.tool('document_read', {
    file: z.string().optional().describe('File to read (default: entry point)'),
  }, async ({ file }) => {
    const content = await provider.readDocument(file)
    return { content: [{ type: 'text', text: content }] }
  })

  server.tool('document_write', {
    content: z.string().describe('New document content (replaces existing)'),
    file: z.string().optional().describe('File to write (default: entry point)'),
  }, async ({ content, file }) => {
    await provider.writeDocument(content, file)
    return { content: [{ type: 'text', text: 'written' }] }
  })

  server.tool('document_append', {
    content: z.string().describe('Content to append to document'),
    file: z.string().optional().describe('File to append to (default: entry point)'),
  }, async ({ content, file }) => {
    await provider.appendDocument(content, file)
    return { content: [{ type: 'text', text: 'appended' }] }
  })

  server.tool('document_list', {}, async () => {
    const files = await provider.listDocuments()
    return { content: [{ type: 'text', text: JSON.stringify(files) }] }
  })

  server.tool('document_create', {
    file: z.string().describe('File path relative to context dir'),
    content: z.string().describe('Initial content'),
  }, async ({ file, content }) => {
    await provider.createDocument(file, content)
    return { content: [{ type: 'text', text: 'created' }] }
  })

  return { server, agentConnections }
}
```

### Provider Implementations

```typescript
// File-based provider (production)
class FileContextProvider implements ContextProvider {
  private mentionState: Map<string, string> = new Map()  // agent -> last ack timestamp

  constructor(
    private channelPath: string,
    private documentPath: string,
    private mentionStatePath: string,
    private validAgents: string[]
  ) {
    this.loadMentionState()
  }

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const timestamp = new Date().toISOString()
    const mentions = extractMentions(message, this.validAgents)
    const entry: ChannelEntry = { timestamp, from, message, mentions }

    // Append to markdown file
    const markdown = `\n### ${timestamp.slice(11, 19)} [${from}]\n${message}\n`
    await fs.appendFile(this.channelPath, markdown)

    return entry
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    const content = await fs.readFile(this.channelPath, 'utf-8')
    return parseChannelMarkdown(content, this.validAgents, since, limit)
  }

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const lastAck = this.mentionState.get(agent) || ''
    const entries = await this.readChannel(lastAck)
    return entries
      .filter(e => e.mentions.includes(agent))
      .map(e => ({
        entry: e,
        unread: true,
        priority: calculatePriority(e),
      }))
  }

  async ackInbox(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until)
    await this.saveMentionState()
  }

  async readDocument(): Promise<string> {
    try {
      return await fs.readFile(this.documentPath, 'utf-8')
    } catch {
      return ''
    }
  }

  async writeDocument(content: string): Promise<void> {
    await fs.writeFile(this.documentPath, content)
  }

  async appendDocument(content: string): Promise<void> {
    await fs.appendFile(this.documentPath, content)
  }

  private loadMentionState() {
    try {
      const data = JSON.parse(fs.readFileSync(this.mentionStatePath, 'utf-8'))
      this.mentionState = new Map(Object.entries(data))
    } catch {
      // No state file yet
    }
  }

  private async saveMentionState() {
    const data = Object.fromEntries(this.mentionState)
    await fs.writeFile(this.mentionStatePath, JSON.stringify(data))
  }
}

// Memory provider (testing)
class MemoryContextProvider implements ContextProvider {
  private channel: ChannelEntry[] = []
  private document: string = ''
  private mentionState: Map<string, string> = new Map()

  constructor(private validAgents: string[]) {}

  async appendChannel(from: string, message: string): Promise<ChannelEntry> {
    const entry: ChannelEntry = {
      timestamp: new Date().toISOString(),
      from,
      message,
      mentions: extractMentions(message, this.validAgents),
    }
    this.channel.push(entry)
    return entry
  }

  async readChannel(since?: string, limit?: number): Promise<ChannelEntry[]> {
    let entries = this.channel
    if (since) entries = entries.filter(e => e.timestamp > since)
    if (limit) entries = entries.slice(-limit)
    return entries
  }

  async getInbox(agent: string): Promise<InboxMessage[]> {
    const lastAck = this.mentionState.get(agent) || ''
    return this.channel
      .filter(e => e.timestamp > lastAck && e.mentions.includes(agent))
      .map(e => ({ entry: e, unread: true, priority: calculatePriority(e) }))
  }

  async ackInbox(agent: string, until: string): Promise<void> {
    this.mentionState.set(agent, until)
  }

  async readDocument(): Promise<string> { return this.document }
  async writeDocument(content: string): Promise<void> { this.document = content }
  async appendDocument(content: string): Promise<void> { this.document += content }
}
```

### Transport Options

**For multi-agent workflows, use Unix socket** (recommended):

```typescript
import { createServer } from 'node:net'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

// Unix socket avoids port conflicts and provides better isolation
const socketPath = `.workflow/${instance}/context.sock`

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: (req) => req.headers.get('x-agent-id') || 'anonymous',
})

const unixServer = createServer((socket) => {
  // Handle HTTP-over-Unix-socket
})
unixServer.listen(socketPath)

await server.connect(transport)
```

**Alternative: HTTP transport** (when Unix socket not suitable):

```typescript
import { Hono } from 'hono'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

const app = new Hono()
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: (req) => req.headers.get('x-agent-id') || 'anonymous',
})

app.all('/mcp/*', async (c) => {
  return transport.handleRequest(c.req.raw)
})

await server.connect(transport)

// Use dynamic port to avoid conflicts
const port = await findAvailablePort(3100, 3200)
export default { port, fetch: app.fetch }
```

**For single-agent or testing, stdio works**:

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// stdio is 1:1 - only one agent can connect
const transport = new StdioServerTransport()
await server.connect(transport)
```

### Agent Identity

Each agent identifies itself when connecting:

```typescript
// Via X-Agent-Id header (both Unix socket and HTTP)
const response = await fetch('unix://.workflow/pr-123/context.sock:/mcp', {
  headers: { 'X-Agent-Id': 'reviewer@pr-123' },
  // ... MCP request
})

// The sessionIdGenerator extracts this as the session ID
// All tool calls from this connection use this identity
```

### Agent Connection

Workflow runner passes MCP socket/URL to agents:

```typescript
// For SDK backend - MCP client with identity
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Unix socket connection (preferred)
const socketPath = '.workflow/pr-123/context.sock'
const transport = new StreamableHTTPClientTransport({
  socketPath,
  headers: { 'X-Agent-Id': agentId },
})
const client = new McpClient()
await client.connect(transport)

// For CLI backends - via MCP configuration (see below)

// For unsupported backends - CLI wrapper
agent-worker context send "message" --agent reviewer@pr-123
agent-worker context read --agent reviewer@pr-123
```

### CLI Backend MCP Configuration

Different CLI backends have different MCP configuration approaches:

| Backend | Config Method | Isolation |
|---------|--------------|-----------|
| Claude CLI | `--mcp-config` flag | ✓ Full runtime isolation |
| Codex CLI | `.codex/config.toml` | ✓ Project-level (trusted projects) |
| Cursor Agent | `.cursor/mcp.json` file | ✓ Project-level |

**MCP Config File Format** (generated per workflow instance):
```json
// .workflow/pr-123/mcp.json
{
  "mcpServers": {
    "workflow-context": {
      "type": "stdio",
      "command": "node",
      "args": [".workflow/pr-123/context-server.js"]
    }
  }
}
```

**Claude CLI** (runtime flags - recommended):
```bash
# Pass MCP config at runtime (temporary, no permanent changes)
claude -p --mcp-config .workflow/pr-123/mcp.json "your prompt"

# Use --strict-mcp-config to ONLY use this config, ignore user's other MCP servers
claude -p --strict-mcp-config --mcp-config .workflow/pr-123/mcp.json "your prompt"

# Can also pass JSON string directly
claude -p --mcp-config '{"mcpServers":{"context":{"type":"stdio","command":"node","args":["server.js"]}}}' "prompt"
```

**Codex CLI** (project-level config - trusted projects):
```bash
# Create project-level config (auto-discovered from project root)
# File: .codex/config.toml
[mcp_servers.workflow-context]
command = "node"
args = [".workflow/pr-123/context-server.js"]

# Run - config is auto-discovered
codex "your prompt"

# Cleanup: delete or restore .codex/config.toml
```

**Cursor Agent** (project-level file discovery):
```bash
# Create project-level config (auto-discovered)
# File: .cursor/mcp.json
{
  "mcpServers": {
    "workflow-context": {
      "command": "node",
      "args": [".workflow/pr-123/context-server.js"]
    }
  }
}

# Run - config is auto-discovered from project root
cursor-agent "your prompt"

# Cleanup: delete or restore .cursor/mcp.json
```

### CLI Backend Tool Support via MCP

With MCP support, CLI backends can now use custom tools that were previously only available to SDK backends:

| Feature | Before MCP | With MCP |
|---------|------------|----------|
| Custom tools | SDK only | All backends |
| Channel access | Wrapper CLI | Native tools |
| @mention notifications | Not possible | MCP notifications |
| Document read/write | Wrapper CLI | Native tools |

**Workflow runner configures MCP per backend**:
```typescript
// Claude CLI - best isolation via runtime flags
async function startClaudeAgent(agentId: string, mcpConfigPath: string, prompt: string) {
  await exec(`claude -p --strict-mcp-config --mcp-config ${mcpConfigPath} \
    --system-prompt "You are ${agentId}" "${prompt}"`)
}

// Codex CLI - project-level config file
async function startCodexAgent(agentId: string, serverCmd: string, prompt: string) {
  const configPath = '.codex/config.toml'
  const backup = existsSync(configPath) ? readFileSync(configPath) : null
  const toml = `[mcp_servers.workflow-context]\ncommand = "node"\nargs = ["${serverCmd}"]`
  mkdirSync('.codex', { recursive: true })
  writeFileSync(configPath, toml)
  try {
    await exec(`codex "${prompt}"`)
  } finally {
    backup ? writeFileSync(configPath, backup) : unlinkSync(configPath)  // Restore
  }
}

// Cursor Agent - project-level config file
async function startCursorAgent(agentId: string, mcpConfig: object, prompt: string) {
  const configPath = '.cursor/mcp.json'
  const backup = existsSync(configPath) ? readFileSync(configPath) : null
  writeFileSync(configPath, JSON.stringify(mcpConfig))
  try {
    await exec(`cursor-agent "${prompt}"`)
  } finally {
    backup ? writeFileSync(configPath, backup) : unlinkSync(configPath)  // Restore
  }
}
```

**Isolation comparison**:
| Backend | Isolation | Cleanup Required |
|---------|-----------|------------------|
| Claude CLI | ✓ Full (runtime flag) | None |
| Codex CLI | ✓ Project-level | Restore `.codex/config.toml` |
| Cursor Agent | ✓ Project-level | Restore `.cursor/mcp.json` |

### Workflow Startup Flow

```
1. Parse workflow file
2. Create ContextProvider (file or memory)
3. Start Context MCP Server
4. For each agent:
   a. Start agent process
   b. Connect agent to MCP server
5. Send kickoff message to channel
6. Agents collaborate via MCP tools
7. On completion/stop: cleanup
```

---

## CLI Commands

### Unified Agent Namespace

All agents (standalone or workflow) share the same namespace:

```
agent-name           # Standalone agent
agent-name@instance  # Workflow agent
@instance            # Instance group (for batch ops)
```

### Command Reference

```bash
# One-shot execution (exits when no agents working)
agent-worker run <file> [options]

# Persistent mode (keeps running until stopped)
agent-worker start <file> [options]

# Stop agents
agent-worker stop [target]

# List agents
agent-worker list
agent-worker ls              # alias

# Standalone agent management
agent-worker new <name>
agent-worker send <message>
agent-worker peek
```

### Command Details

#### `agent-worker run <file>`

Execute workflow and exit when complete.

```bash
agent-worker run review.yaml
agent-worker run review.yaml --instance pr-123
agent-worker run review.yaml --verbose
agent-worker run review.yaml --json
```

**Completion**: Exits when no agents are actively working.

**Behavior**:
1. Parse workflow file
2. Execute setup tasks
3. Send kickoff to channel (triggers @mentioned agents)
4. Agents collaborate via channel/@mention
5. Wait until all agents idle
6. Output results and exit

#### `agent-worker start <file>`

Start workflow in persistent mode.

```bash
agent-worker start review.yaml
agent-worker start review.yaml --instance pr-123
agent-worker start review.yaml --background
```

**Behavior**:
1. Parse workflow file
2. Execute setup tasks
3. Send kickoff to channel
4. Keep running until manually stopped
5. Agents can continue collaborating indefinitely

#### `agent-worker stop [target]`

Stop running agents.

```bash
agent-worker stop reviewer           # Stop standalone agent
agent-worker stop reviewer@pr-123    # Stop specific workflow agent
agent-worker stop @pr-123            # Stop all agents in instance
agent-worker stop --all              # Stop everything
```

#### `agent-worker list`

List all running agents.

```bash
$ agent-worker list

NAME                 SOURCE          STATUS
reviewer             (standalone)    running
coder                (standalone)    idle
reviewer@pr-123      review.yaml     running
coder@pr-123         review.yaml     running
helper@pr-456        review.yaml     idle
```

#### `agent-worker send <message>`

Send message to agent or channel. Three target patterns:

```bash
# Pattern 1: Standalone agent inbox
agent-worker send "hello"                    # To default/active standalone agent
agent-worker send "hello" --to reviewer      # To standalone agent "reviewer"

# Pattern 2: Workflow agent (via channel @mention)
agent-worker send "hello" --to coder@pr-123  # Posts to pr-123 channel: "[user] @coder hello"

# Pattern 3: Workflow channel (broadcast)
agent-worker send "@reviewer @coder please sync" --to @pr-123  # Posts to pr-123 channel
```

**Message Format in Channel:**

```markdown
### 10:05:00 [user]
@coder hello
```

User messages are marked with `[user]` as the sender, distinguishing from agent and system messages.

**Target Resolution:**

| Pattern | Target | Effect |
|---------|--------|--------|
| `--to agent` | Standalone agent | Direct to agent's inbox |
| `--to agent@instance` | Workflow agent | Channel post with @mention |
| `--to @instance` | Workflow channel | Channel post (parse @mentions from message) |

**Implementation:**

```typescript
async function handleSend(message: string, to?: string) {
  if (!to) {
    // Default standalone agent
    return sendToStandalone(getDefaultAgent(), message)
  }

  if (to.startsWith('@')) {
    // @instance → broadcast to channel
    const instance = to.slice(1)
    return sendToChannel(instance, 'user', message)
  }

  if (to.includes('@')) {
    // agent@instance → channel with @mention
    const [agent, instance] = to.split('@')
    const mentionMessage = `@${agent} ${message}`
    return sendToChannel(instance, 'user', mentionMessage)
  }

  // Standalone agent
  return sendToStandalone(to, message)
}
```

### Options Reference

| Option | Commands | Description |
|--------|----------|-------------|
| `--instance <name>` | run, start, new | Instance name (default: `default`) |
| `--to <target>` | send, peek | Target: `agent`, `agent@instance`, or `@instance` |
| `--background` | start | Run in background |
| `--verbose` | run, start | Show detailed progress |
| `--json` | run, list, send | JSON output |
| `--all` | stop | Stop all agents |

---

## Variable Interpolation

Variables use `${{ name }}` syntax:

```yaml
setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  Review this PR:
  ${{ diff }}

  @reviewer please analyze
```

**Reserved variables:**
- `${{ env.VAR_NAME }}` - Environment variables
- `${{ workflow.name }}` - Workflow name
- `${{ workflow.instance }}` - Instance name
- `${{ context.channel }}` - Channel file path
- `${{ context.document }}` - Document file path

---

## Execution Flow

### Run Mode

```
┌─────────────────────────────────────────────────────┐
│                    run command                       │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Execute setup tasks                     │
│         (shell commands, variable capture)           │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│            Send kickoff to channel                   │
│         (@mentioned agents get triggered)            │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│           Agents collaborate via channel             │
│      (read, write, @mention each other)              │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│            All agents idle? ──────────────────┐     │
│                    │                          │     │
│                   Yes                         No    │
│                    │                          │     │
│                    ▼                          │     │
│               Exit with results      (continue)     │
└─────────────────────────────────────────────────────┘
```

**Idle Detection (Run Mode Exit Condition):**

The workflow exits when **all** of the following are true:

```typescript
interface WorkflowIdleState {
  /** All controllers in 'idle' state (not 'running') */
  allControllersIdle: boolean

  /** No unread inbox messages for any agent */
  noUnreadMessages: boolean

  /** No active proposals requiring votes */
  noActivePendingProposals: boolean

  /** Debounce period elapsed (avoid premature exit) */
  idleDebounceElapsed: boolean
}

function isWorkflowComplete(state: WorkflowIdleState): boolean {
  return state.allControllersIdle &&
         state.noUnreadMessages &&
         state.noActivePendingProposals &&
         state.idleDebounceElapsed
}

// Idle check runs periodically
async function checkWorkflowIdle(
  controllers: Map<string, AgentController>,
  provider: ContextProvider,
  proposals: Map<string, Proposal>,
  debounceMs: number = 2000
): Promise<boolean> {
  // 1. Check controller states
  const allIdle = [...controllers.values()].every(c => c.state === 'idle')
  if (!allIdle) return false

  // 2. Check inbox for all agents
  for (const [name] of controllers) {
    const inbox = await provider.getInbox(name)
    if (inbox.length > 0) return false
  }

  // 3. Check active proposals
  const activeProposals = [...proposals.values()].filter(p => p.status === 'active')
  if (activeProposals.length > 0) return false

  // 4. Debounce - wait to ensure no new activity
  await sleep(debounceMs)

  // Re-check after debounce
  const stillIdle = [...controllers.values()].every(c => c.state === 'idle')
  return stillIdle
}
```

This prevents premature exit:
- Agents might take time to process
- New @mentions might arrive during processing
- Proposals need time to resolve

### Start Mode

```
┌─────────────────────────────────────────────────────┐
│                   start command                      │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│     Execute setup + Send kickoff (same as run)      │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              Keep running indefinitely               │
│                                                      │
│   - Agents collaborate via channel                  │
│   - External messages can be sent via CLI           │
│   - New @mentions trigger agents                    │
│                                                      │
│               (until `stop` command)                 │
└─────────────────────────────────────────────────────┘
```

---

## Examples

### Simple Review Workflow

```yaml
name: review
context:

agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: |
      You review code for quality and issues.
      Use the channel tool to communicate.
      Use the document tool to record findings.

setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  Please review this PR:

  ${{ diff }}

  @reviewer
```

### Multi-Agent Collaboration

```yaml
name: code-review
context:

agents:
  coordinator:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coordinator.md

  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/reviewer.md

  coder:
    model: anthropic/claude-sonnet-4-5
    system_prompt: prompts/coder.md

setup:
  - shell: gh pr view --json title,body,files
    as: pr_info

kickoff: |
  New PR to review:
  ${{ pr_info }}

  @coordinator please orchestrate the review.
  - Use @reviewer for code review
  - Use @coder for any fixes needed
```

### Standalone Agent + Channel

```bash
# Create standalone agent with context access
agent-worker new helper --context

# It can now use channel/document tools
agent-worker send "Check the notes in the document"
```

---

## Design Decisions

### 1. Why Kickoff Model?

The kickoff model is declarative - describe the goal and let agents coordinate:
- Natural language work description
- @mention for automatic coordination
- Agents decide their own actions

This is preferable to procedural task sequences because it allows autonomous agent collaboration without rigid execution order.

### 2. Why Separate Channel and Document?

- **Channel** = communication (who said what, when)
- **Document** = workspace (current state, findings)

Combining them would mix transient messages with persistent content.

### 3. Why Default Context Enabled?

Most workflows benefit from shared context. The minimal config:

```yaml
context:
```

Enables both channel and document with sensible defaults. Explicit opt-out:

```yaml
# No context - agents can't communicate
# (omit context field entirely)
```

### 4. Run vs Start Completion

- **Run**: Complete when no agents actively working (auto-detect idle)
- **Start**: Never complete until manual `stop`

No need for explicit `completion:` config - the command choice determines behavior.

---

## Implementation Guide

### Current State vs Design

The current implementation (Phase 1-6) provides a working foundation. Phase 7-8 extends it with inbox and multi-file documents.

**ContextProvider Interface Changes:**

| Current Method | Phase 7-8 Change |
|----------------|------------------|
| `getUnreadMentions(agent)` | → `getInbox(agent): InboxMessage[]` (add priority) |
| `getAllMentions(agent)` | → Remove (not needed) |
| `acknowledgeMentions(agent, until)` | → `ackInbox(agent, until)` |
| `readDocument()` | → `readDocument(file?)` (add optional file) |
| `writeDocument(content)` | → `writeDocument(content, file?)` |
| `appendDocument(content)` | → `appendDocument(content, file?)` |
| - | → `listDocuments(): string[]` (new) |
| - | → `createDocument(file, content)` (new) |
| - | → `deleteDocument(file)` (new) |

**MCP Tool Changes:**

| Current Tool | Phase 7-8 Change |
|--------------|------------------|
| `channel_mentions` | → Replace with `inbox_check` |
| `channel_read` | → Remove auto-acknowledge behavior |
| - | → `inbox_ack` (new) |
| `document_read` | → Add `file` parameter |
| `document_write` | → Add `file` parameter, add ownership check |
| `document_append` | → Add `file` parameter, add ownership check |
| - | → `document_list` (new) |
| - | → `document_create` (new, with ownership check) |
| - | → `document_suggest` (new, for non-owners) |

**Key Design Changes:**

1. **`inbox_check` does NOT acknowledge** - explicit `inbox_ack` required
2. **`channel_read` does NOT acknowledge** - decoupled from inbox
3. **Controller acknowledges on success** - not the agent
4. **Document ownership** - optional single-writer model with `document_suggest`

**New Types:**

```typescript
// Add to context/types.ts
interface InboxMessage {
  entry: ChannelEntry
  unread: boolean
  priority: 'normal' | 'high'
}

// Priority calculation
function calculatePriority(entry: ChannelEntry): 'normal' | 'high' {
  if (entry.mentions.length > 1) return 'high'
  if (/\b(urgent|asap|blocked|critical)\b/i.test(entry.message)) return 'high'
  return 'normal'
}

// Retry configuration
interface RetryConfig {
  maxAttempts?: number      // default: 3
  backoffMs?: number        // default: 1000
  backoffMultiplier?: number // default: 2
}
```

### Implementation Order

**Phase 7: Inbox Model**
1. Add `InboxMessage` type to `context/types.ts`
2. Rename mention methods to inbox methods in `ContextProvider`
3. Add priority calculation
4. Implement in both providers
5. Replace `channel_mentions` with `inbox_check`, add `inbox_ack`
6. **Remove auto-acknowledge from `channel_read`**

**Phase 8: Agent Controller**
1. Add `AgentController` interface and types
2. Add `RetryConfig` interface
3. Implement `createAgentController()` with polling loop
4. Add `wake()` interrupt mechanism
5. **Add `onMention` callback to MCP server options**
6. **Controller acknowledges inbox on successful agent run**
7. Implement retry with exponential backoff
8. Implement backend runners (SDK, Claude CLI, Codex)
9. Add model parsing (`parseModel()` with aliases and versions)
10. Update `runWorkflow()` to use controllers

**Phase 9: Multi-File Documents**
1. Add `file` parameter to document methods
2. Add `listDocuments`, `createDocument`, `deleteDocument`
3. Add MCP tools
4. Support nested directories

**Phase 10: Document Ownership** (optional)
1. Move `documentOwner` to context level (cross-provider)
2. Default behavior: single agent = disabled, multiple + unspecified = election (Phase 11)
3. Add ownership check to write/create/append tools
4. Add `document_suggest` tool for non-owners

**Phase 11: Proposal & Voting System**
1. Define `Proposal`, `ProposalOption`, `ResolutionRule`, `ProposalResult` types
2. Implement `proposal_create`, `vote`, `proposal_status`, `proposal_cancel` tools
3. Resolution rules: plurality, majority, unanimous
4. Binding vs advisory proposals
5. Auto-create document owner election when needed
6. Timeout resolution with tie-breaker

---

## References

- [Docker Compose](https://docs.docker.com/compose/) - Service orchestration inspiration
- [Slack API](https://api.slack.com/) - Channel/mention model
- [GitHub Actions](https://docs.github.com/en/actions) - Variable syntax
- [TODO.md](./TODO.md) - Implementation plan and progress tracking
