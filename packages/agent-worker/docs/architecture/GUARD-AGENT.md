# Architecture: Guard Agent (看守者)

**Date**: 2026-02-24
**Status**: Proposed
**Depends on**: [AGENT-TOP-LEVEL.md](./AGENT-TOP-LEVEL.md) (Agent as Top-Level Entity)

---

## Problem

The AGENT-TOP-LEVEL design gives agents persistent context (soul, memory, notes, todo). But it leaves several critical questions unanswered:

1. **Who assembles the context prompt?** Currently the loop does naive concatenation: soul + memory + todos + workflow append. As context grows, this becomes a prompt engineering problem — what's relevant? What fits? What should be compressed?

2. **Who manages soul evolution?** The soul is defined statically in YAML. But agents learn, grow, and change. Should they modify their own identity? Unchecked self-modification risks identity drift.

3. **Who mediates memory access?** If agent A wants to know what agent B learned in another workflow, how does that work? Direct file access has no access control, no filtering, no audit trail. Research shows memory poisoning attacks (MINJA, ACL 2025) have >95% success rate against unmediated memory stores.

4. **How does context size stay manageable?** Memory/notes grow unboundedly. Without active curation, context windows overflow with stale, redundant, or irrelevant information.

## Decision

**Introduce the Guard Agent (看守者) — a meta-agent that mediates context, memory, and identity for other agents.**

The Guard is not a security firewall (though it enables security). It's a **context curator** — responsible for assembling the right context at the right time, managing what agents remember, and governing how identity evolves.

### Design Principles

These emerged from studying OpenClaw, Nanobot (HKUDS), Letta/MemGPT, and academic research on multi-agent memory:

| Principle | Source | Application |
|-----------|--------|-------------|
| Files are source of truth, indexes are derived | OpenClaw | Markdown/YAML are authoritative; SQLite is acceleration |
| LLM-as-memory-curator | HKUDS/nanobot | The Guard uses LLM reasoning to decide what to remember |
| Per-agent isolation by default | Letta, Collaborative Memory | Agents own their memory; sharing is explicit |
| Progressive context assembly | HKUDS ContextBuilder | Load identity first, then memory, then task context |
| Layered mediation | Microsoft, Google ADK | Guard operates at multiple interception points |
| Behavioral identity over aspirational | Nobody Agents, OpenClaw | Soul describes what agent does, not what it "is" |

---

## Architecture

### The Guard Agent's Role

```
                    ┌─────────────────────────────────┐
                    │         GUARD AGENT (看守者)       │
                    │                                   │
                    │  1. Context Assembly              │
                    │     - Select relevant memory      │
                    │     - Compress if needed           │
                    │     - Inject soul + active todos   │
                    │                                   │
                    │  2. Memory Mediation              │
                    │     - Write: validate + store      │
                    │     - Read: filter + deliver       │
                    │     - Cross-agent: ask protocol    │
                    │                                   │
                    │  3. Identity Governance            │
                    │     - Observe behavior patterns    │
                    │     - Propose soul updates         │
                    │     - Version control identity     │
                    │                                   │
                    │  4. Audit                          │
                    │     - Log all operations           │
                    │     - Query-able history           │
                    └─────────┬───────────┬─────────────┘
                              │           │
                    ┌─────────▼───┐ ┌─────▼─────────┐
                    │  Agent A    │ │  Agent B       │
                    │  (isolated  │ │  (isolated     │
                    │   context)  │ │   context)     │
                    └─────────────┘ └───────────────┘
```

### Three Responsibilities

#### 1. Context Assembly (Prompt Engineering)

The Guard replaces naive prompt concatenation with **intelligent context assembly**:

```
AgentLoop requests context for alice
         │
         ▼
Guard.assembleContext(alice, workflow, task)
         │
         ├── 1. Load soul (always, full)
         │
         ├── 2. Select relevant memory
         │      - Hybrid search: semantic + keyword
         │      - Recency bias (temporal decay)
         │      - Task relevance scoring
         │      - Token budget allocation
         │
         ├── 3. Active todos (always, compact)
         │
         ├── 4. Workflow-specific context
         │      - Recent channel (last N messages)
         │      - Inbox messages
         │      - Workspace documents
         │
         ├── 5. Compress if needed
         │      - Summarize older memory entries
         │      - Truncate low-relevance items
         │
         └── 6. Return assembled system prompt
              (fits within token budget)
```

**Key insight from OpenClaw**: Before compression, flush valuable context to durable memory. The Guard performs a "memory flush" step — asking the LLM what's worth remembering before summarizing away details.

**Key insight from HKUDS/nanobot**: Two-tier memory works. "What I know" (always loaded) vs "what happened" (searched on demand). The Guard maintains this distinction:

| Tier | Contents | Loading Strategy |
|------|----------|-----------------|
| Core memory | Soul, key facts, active patterns | Always in context |
| Working memory | Recent learnings, task-specific notes | Selected by relevance |
| Archive | Historical notes, past decisions | Searched on demand via query |

#### 2. Memory Mediation

**Agents never directly read/write memory stores.** All memory operations go through the Guard.

##### Write Path

```
Agent alice: "I learned that the auth module uses JWT with RSA-256"
         │
         ▼
Guard.writeMemory(alice, content)
         │
         ├── Validate: Is this worth remembering?
         │   (deduplicate, check relevance, filter noise)
         │
         ├── Classify: Core fact? Working note? Archive?
         │
         ├── Store: Write to alice's memory store
         │   (markdown file + SQLite index)
         │
         └── Log: Record the write operation
```

##### Read Path (Own Memory)

```
Agent alice: memory_recall("auth module patterns")
         │
         ▼
Guard.readMemory(alice, query)
         │
         ├── Search: Hybrid (vector + keyword) over alice's memory
         │
         ├── Rank: Relevance × recency × importance
         │
         ├── Filter: Token budget, dedup, relevance threshold
         │
         └── Return: Relevant memory entries
```

##### Cross-Agent Ask Protocol

**Agents cannot directly read each other's memory.** They can only _ask_.

```
Agent alice: "What does bob know about the deploy pipeline?"
         │
         ▼
Guard.askAbout(from: alice, about: bob, query: "deploy pipeline")
         │
         ├── Permission check: Can alice ask about bob's knowledge?
         │
         ├── Search bob's memory for "deploy pipeline"
         │
         ├── Filter: Remove bob-private entries
         │   (bob can mark memories as private/shareable)
         │
         ├── Summarize: Return a summary, not raw memory
         │   (prevents context leakage of bob's full state)
         │
         └── Log: Record the cross-agent query
```

**Why "ask" not "access"?**

1. **Privacy**: Bob may have memories he doesn't want shared (personal patterns, failed experiments).
2. **Security**: The MINJA attack (ACL 2025) showed >95% success in poisoning unmediated memory stores. The Guard can validate and filter.
3. **Context efficiency**: Raw memory dumps waste tokens. Summarized answers are more useful.
4. **Audit trail**: Every cross-agent query is logged. You can trace who learned what from whom.

##### Memory Visibility Levels

```yaml
# In agent's memory store
- key: auth-patterns
  content: "JWT with RSA-256, tokens expire in 1h, refresh via /auth/refresh"
  visibility: shareable    # Other agents can ask about this

- key: my-review-approach
  content: "I tend to miss concurrency bugs, so I now check for race conditions first"
  visibility: private      # Only this agent and the Guard can see this

- key: team-convention
  content: "We use conventional commits with scope prefix"
  visibility: public       # Automatically shared to workspace documents
```

#### 3. Identity Governance

The Guard manages soul evolution. Agents cannot modify their own soul directly.

##### Observation-Driven Evolution

```
Guard observes alice's behavior across sessions
         │
         ├── Pattern: Alice consistently explains trade-offs before making decisions
         │   Current soul doesn't mention this
         │
         ├── Proposal: Add to soul.principles:
         │   "Always explain trade-offs before recommending"
         │
         └── Resolution:
              ├── Auto-apply (low risk, behavioral observation)
              └── OR require user approval (significant identity change)
```

**Key insight from Nobody Agents**: "When the behavior doesn't match the file, update the file." The Guard observes actual behavior and proposes soul updates that reflect reality, not aspirations.

##### Soul Versioning

```
.agents/alice/
├── soul.yaml            # Current soul (Guard-managed)
├── soul.history/        # Previous versions
│   ├── v1.yaml
│   ├── v2.yaml          # + diff + reason for change
│   └── v3.yaml
└── soul.proposals/      # Pending proposals
    └── 2026-02-24-add-tradeoff-principle.yaml
```

Every soul change is:
- Versioned (can be diffed, rolled back)
- Annotated (why the change was proposed)
- Logged (who proposed it, when, based on what evidence)

---

## Storage: SQLite + Files Hybrid

### Why Not Pure Files?

File-based storage (current) works for simple cases but fails at:
- **Querying**: "What did alice learn about auth in the last week?" requires scanning all files
- **Concurrency**: Multiple agents writing to the same directory risks race conditions
- **Search**: Semantic search over markdown requires external indexing anyway
- **Audit**: Append-only logs in JSONL work but are hard to query

### Why Not Pure SQLite?

Pure database loses:
- **Human readability**: Can't browse agent memory in an editor
- **Git-friendliness**: Binary SQLite files don't diff well
- **LLM compatibility**: Models are trained on files, not SQL

### Hybrid: Files + SQLite Index

**OpenClaw's pattern**: Files are the source of truth. SQLite is a derived, rebuildable index.

```
.agents/alice/
├── memory/                    # Source of truth (human-readable, git-friendly)
│   ├── core.yaml              # Core facts (always loaded)
│   ├── patterns.yaml          # Learned patterns
│   └── notes/                 # Freeform notes
│       ├── 2026-02-24.md
│       └── 2026-02-25.md
│
├── soul.yaml                  # Identity (Guard-managed)
├── todo/                      # Task tracking
│
└── .index/                    # Derived (rebuildable, gitignored)
    └── memory.sqlite          # SQLite index over memory/
```

### SQLite Schema

```sql
-- Memory chunks (indexed from markdown/yaml files)
CREATE TABLE chunks (
    id          INTEGER PRIMARY KEY,
    agent       TEXT NOT NULL,          -- agent name
    source_file TEXT NOT NULL,          -- relative path to source file
    line_start  INTEGER,               -- line range in source
    line_end    INTEGER,
    content     TEXT NOT NULL,          -- chunk text
    visibility  TEXT DEFAULT 'private', -- private | shareable | public
    tier        TEXT DEFAULT 'working', -- core | working | archive
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    embedding   BLOB                   -- vector embedding (via sqlite-vec)
);

-- Full-text search index
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content,
    content='chunks',
    content_rowid='id'
);

-- Vector similarity index (via sqlite-vec extension)
CREATE VIRTUAL TABLE chunks_vec USING vec0(
    embedding float[384]               -- dimension matches embedding model
);

-- Audit log (append-only)
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    timestamp   TEXT NOT NULL,
    actor       TEXT NOT NULL,          -- who performed the action
    action      TEXT NOT NULL,          -- write | read | ask | soul_update | ...
    target      TEXT NOT NULL,          -- target agent or resource
    query       TEXT,                   -- search query (for reads)
    result_ids  TEXT,                   -- JSON array of chunk IDs returned
    metadata    TEXT                    -- JSON blob for extra context
);

-- Soul versions
CREATE TABLE soul_versions (
    id          INTEGER PRIMARY KEY,
    agent       TEXT NOT NULL,
    version     INTEGER NOT NULL,
    content     TEXT NOT NULL,          -- full soul YAML
    diff        TEXT,                   -- diff from previous version
    reason      TEXT,                   -- why the change was made
    proposed_by TEXT NOT NULL,          -- 'guard' | 'user' | agent name
    approved_by TEXT,                   -- 'auto' | 'user'
    created_at  TEXT NOT NULL
);

-- File tracking (for incremental reindexing)
CREATE TABLE files (
    path        TEXT PRIMARY KEY,
    mtime       INTEGER NOT NULL,
    size        INTEGER NOT NULL,
    content_hash TEXT NOT NULL
);
```

### Search: Hybrid (Vector + Keyword)

Following OpenClaw's proven approach:

```
finalScore = vectorWeight * cosineSimilarity + textWeight * bm25Score
```

Default weights: 70% vector, 30% BM25.

Post-processing:
- **MMR** (Maximal Marginal Relevance): Reduce redundant near-duplicate results
- **Temporal decay**: `score * e^(-lambda * ageInDays)` with 30-day half-life
- **Tier boost**: Core memory gets 2x multiplier, archive gets 0.5x

### Embedding Strategy

Start simple, upgrade as needed:
1. **Phase 1**: BM25 only (FTS5, zero dependencies)
2. **Phase 2**: Add vector search when accuracy matters (local GGUF model or API)
3. **Phase 3**: Hybrid search with tunable weights

---

## Guard Agent Implementation

### Is the Guard an LLM Agent or Deterministic Code?

**Hybrid.** Most operations are deterministic (search, filter, store, log). LLM reasoning is used only when judgment is needed:

| Operation | Implementation |
|-----------|---------------|
| Memory search (query → results) | Deterministic (SQLite FTS5 + vec) |
| Memory write (validate, classify) | LLM (is this worth remembering? what tier?) |
| Context assembly (select, compress) | LLM (what's relevant to this task?) |
| Cross-agent ask (filter, summarize) | LLM (summarize bob's knowledge for alice) |
| Soul observation (detect patterns) | LLM (what patterns do I see in behavior?) |
| Soul proposal (suggest updates) | LLM (how should soul evolve?) |
| Audit logging | Deterministic |
| Permission checks | Deterministic |

### The Guard's Own Identity

The Guard has a minimal, fixed identity (not a full agent with soul/memory):

```yaml
# Internal to the system, not user-configurable
name: guard
role: context-curator
principles:
  - Agents own their memory; I curate access
  - Files are truth; indexes are derived
  - Log everything; trust nothing
  - Propose, don't impose (for soul changes)
  - Relevance over recency over completeness
```

### Guard as MCP Tools

The Guard exposes its operations as MCP tools that agents can call:

```typescript
// Memory operations (replace direct file access)
memory_store(content: string, opts?: { tier?: Tier; visibility?: Visibility })
memory_recall(query: string, opts?: { limit?: number; tier?: Tier })
memory_forget(id: string)  // Soft delete — moves to archive

// Cross-agent operations
ask_agent(agent: string, query: string)  // Mediated query
share_with(agent: string, memoryIds: string[])  // Explicit sharing

// Identity operations (agent can request, Guard decides)
soul_reflect()  // "Who am I?" — returns current soul
soul_suggest(observation: string)  // "I notice I tend to..." — Guard evaluates

// Introspection
memory_stats()  // How much memory? What tiers? Last update?
```

### Guard Lifecycle

```
Workflow starts
     │
     ▼
Guard initializes
     ├── Load agent definitions
     ├── Open/create SQLite indexes
     ├── Verify index freshness (reindex stale files)
     └── Ready
     │
     ▼
Agent loop requests context
     │
     ▼
Guard.assembleContext(agent, workflow, task)
     ├── Soul (full, always)
     ├── Memory (selected by relevance + budget)
     ├── Todos (active, compact)
     ├── Workflow context (inbox, channel, docs)
     └── Returns assembled prompt
     │
     ▼
Agent runs, may call Guard MCP tools
     ├── memory_store("learned X")
     ├── memory_recall("how does Y work")
     ├── ask_agent("bob", "deploy pipeline")
     └── soul_suggest("I should check for race conditions")
     │
     ▼
Agent finishes
     │
     ▼
Guard post-run
     ├── Analyze agent's session for memory-worthy content
     ├── Propose memory writes (agent confirms or Guard auto-stores)
     ├── Update soul if behavioral patterns detected
     └── Log session summary to audit
```

---

## Integration with AGENT-TOP-LEVEL

### Updated Agent Definition

```yaml
# .agents/alice.yaml
name: alice
model: anthropic/claude-sonnet-4-5

prompt:
  system_file: ./prompts/alice.md

soul:
  role: code-reviewer
  expertise: [typescript, architecture, testing]
  style: thorough but constructive
  principles:
    - Explain the why, not just the what
    - Suggest, don't demand

context:
  dir: .agents/alice/

# NEW: Memory configuration
memory:
  # How much token budget for memory in context?
  budget: 2000          # tokens allocated to memory in prompt
  # What tiers to auto-load vs search?
  auto_load: [core]     # Always include core memory
  search: [working]     # Search working memory by relevance
  archive: on_demand    # Archive only via explicit recall
```

### Updated Workflow Definition

```yaml
# .workflows/review.yaml
name: review

agents:
  alice: { ref: alice }
  bob: { ref: bob }

# NEW: Guard configuration (optional — defaults are sensible)
guard:
  # Use LLM for memory curation? (false = deterministic only)
  llm_curation: true
  # Model for Guard's LLM operations (use cheap/fast model)
  model: anthropic/claude-haiku-4-5
  # Auto-store after each agent run?
  auto_store: true
  # Soul evolution mode
  soul_evolution: propose  # propose | auto | disabled
```

### Updated Runtime Architecture

```
Daemon
├── agents: AgentRegistry
│   ├── alice: AgentHandle (definition + context)
│   └── bob: AgentHandle
│
├── guard: GuardAgent                     # NEW
│   ├── indexes: Map<agent, SQLiteIndex>  # Per-agent search indexes
│   ├── auditLog: SQLiteAuditLog          # Shared audit log
│   └── assembleContext(agent, workflow, task): Promise<string>
│
├── workspaces: WorkspaceRegistry
│   └── review:main: Workspace
│
└── workflows: WorkflowRegistry
    └── review:main: WorkflowHandle
        ├── workspace: Workspace (ref)
        ├── guard: GuardAgent (ref)       # Shared guard
        ├── agents: [alice, bob]
        └── loops: Map<name, AgentLoop>
```

---

## Types

```typescript
/** Memory entry stored by the Guard */
interface MemoryEntry {
  id: string;
  agent: string;
  content: string;
  tier: 'core' | 'working' | 'archive';
  visibility: 'private' | 'shareable' | 'public';
  sourceFile: string;
  lineRange?: { start: number; end: number };
  embedding?: Float32Array;
  createdAt: string;
  updatedAt: string;
}

/** Search result from memory query */
interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;           // Combined relevance score
  vectorScore?: number;    // Semantic similarity
  textScore?: number;      // BM25 keyword match
  decayedScore: number;    // After temporal decay
}

/** Guard Agent interface */
interface GuardAgent {
  /** Assemble context prompt for an agent */
  assembleContext(
    agent: AgentHandle,
    workflow?: WorkflowInstance,
    task?: string,
  ): Promise<AssembledContext>;

  /** Store a memory entry */
  storeMemory(
    agent: string,
    content: string,
    opts?: { tier?: Tier; visibility?: Visibility },
  ): Promise<MemoryEntry>;

  /** Search an agent's memory */
  searchMemory(
    agent: string,
    query: string,
    opts?: { limit?: number; tier?: Tier; budget?: number },
  ): Promise<MemorySearchResult[]>;

  /** Cross-agent ask (mediated) */
  askAbout(
    from: string,
    about: string,
    query: string,
  ): Promise<string>;

  /** Get current soul for an agent */
  getSoul(agent: string): Promise<AgentSoul>;

  /** Propose a soul update */
  proposeSoulUpdate(
    agent: string,
    observation: string,
    proposedChanges: Partial<AgentSoul>,
  ): Promise<SoulProposal>;

  /** Reindex an agent's memory files */
  reindex(agent: string): Promise<void>;

  /** Get audit log entries */
  getAuditLog(opts?: {
    agent?: string;
    action?: string;
    since?: string;
    limit?: number;
  }): Promise<AuditEntry[]>;
}

/** Assembled context ready for prompt injection */
interface AssembledContext {
  /** The full system prompt (soul + memory + todos + workflow) */
  systemPrompt: string;
  /** Token count of assembled context */
  tokenCount: number;
  /** What was included (for debugging) */
  manifest: {
    soul: boolean;
    memoryEntries: number;
    todoItems: number;
    workflowContext: boolean;
    compressed: boolean;
  };
}

/** Soul evolution proposal */
interface SoulProposal {
  id: string;
  agent: string;
  observation: string;       // What behavior was observed
  currentSoul: AgentSoul;
  proposedSoul: AgentSoul;
  diff: string;              // Human-readable diff
  confidence: number;        // 0-1, how confident the Guard is
  status: 'pending' | 'approved' | 'rejected' | 'auto-applied';
  createdAt: string;
}

/** Audit log entry */
interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;             // Who performed the action
  action: 'memory_write' | 'memory_read' | 'memory_ask' | 'soul_read'
        | 'soul_propose' | 'soul_apply' | 'context_assemble';
  target: string;            // Target agent
  query?: string;            // For search operations
  resultCount?: number;      // How many results returned
  metadata?: Record<string, unknown>;
}
```

---

## Implementation Phases

### Phase 1: Deterministic Guard + SQLite Index

**Goal**: Replace naive prompt concatenation with structured context assembly. No LLM in the Guard yet.

- [ ] `StorageBackend` implementation for SQLite (implements existing interface)
- [ ] SQLite schema: chunks, chunks_fts, files, audit_log
- [ ] File watcher: detect changes in `.agents/*/memory/`, reindex
- [ ] `GuardAgent` with deterministic context assembly
- [ ] FTS5 keyword search for `memory_recall`
- [ ] Basic audit logging
- [ ] MCP tools: `memory_store`, `memory_recall`, `memory_stats`

### Phase 2: Cross-Agent Ask Protocol

**Goal**: Agents can query each other's knowledge through the Guard.

- [ ] Visibility levels on memory entries (private/shareable/public)
- [ ] `askAbout()` — search target agent's shareable memory, return summary
- [ ] Permission checks (which agents can ask about whom)
- [ ] MCP tools: `ask_agent`, `share_with`
- [ ] Audit logging for cross-agent queries

### Phase 3: LLM-Powered Curation

**Goal**: Use LLM judgment for memory classification and context selection.

- [ ] LLM-based memory classification (tier assignment, dedup detection)
- [ ] Relevance-based context selection (vs current "load all")
- [ ] Pre-compression memory flush (OpenClaw pattern)
- [ ] Context compression when exceeding token budget
- [ ] Auto-store: analyze session output for memory-worthy content

### Phase 4: Identity Governance

**Goal**: Guard manages soul evolution.

- [ ] Soul versioning (history, diff, rollback)
- [ ] Behavioral observation: detect patterns across sessions
- [ ] Soul proposal generation and approval workflow
- [ ] MCP tools: `soul_reflect`, `soul_suggest`
- [ ] Soul evolution modes: propose / auto / disabled

### Phase 5: Vector Search

**Goal**: Semantic search for better memory retrieval.

- [ ] Embedding generation (local model or API)
- [ ] sqlite-vec integration for cosine similarity
- [ ] Hybrid scoring: vector + BM25 with tunable weights
- [ ] MMR for diversity in results
- [ ] Temporal decay on scores

---

## Comparison with External Systems

| Feature | Our Guard | OpenClaw | HKUDS/nanobot | Letta/MemGPT |
|---------|-----------|----------|---------------|-------------|
| Context assembly | Guard agent | Context Window Guard | ContextBuilder | Memory manager |
| Memory storage | Files + SQLite | Files + SQLite | Markdown only | SQLite/Postgres |
| Memory search | FTS5 → hybrid | Hybrid (vec+BM25) | grep | Vector + keyword |
| Cross-agent memory | Ask protocol | Agent-to-agent messaging | No shared memory | Shared blocks |
| Identity management | Soul versioning | SOUL.md + IDENTITY.md | SOUL.md | Persona blocks |
| Identity evolution | Guard proposes | Manual / hook-based | Manual | Manual |
| Audit trail | SQLite log | JSONL | None | None |
| LLM in mediation | Yes (curation) | Yes (compaction) | Yes (consolidation) | Yes (memory mgmt) |

**Our differentiators:**
1. **Guard as explicit agent** — not a library function but an entity with its own (minimal) identity
2. **Ask protocol** — agents never see each other's raw memory; always mediated + summarized
3. **Soul versioning** — identity changes are tracked, diffable, reversible
4. **Hybrid Guard** — deterministic where possible, LLM only where judgment is needed

---

## Open Questions

1. **Guard scalability** — One Guard per workflow? Per daemon? Per project? If all agents share one Guard, it becomes a bottleneck. If each has its own, cross-agent operations are harder.
   - **Proposal**: One Guard per daemon instance. It's a service, not an agent-per-agent resource.

2. **Embedding model choice** — Local (zero cost, slower) vs API (fast, cost per query)?
   - **Proposal**: Start with FTS5 only. Add embeddings when retrieval quality demands it.

3. **Memory consolidation trigger** — When does working memory get consolidated into core? Time-based? Size-based? Agent request?
   - **Proposal**: After N sessions (configurable), Guard proposes consolidation of working → core.

4. **Guard failure mode** — If the Guard's LLM call fails, what happens to context assembly?
   - **Proposal**: Deterministic fallback. Always have a non-LLM path that assembles context from tier priorities alone.

5. **SQLite as dependency** — Adding SQLite (via better-sqlite3 or bun:sqlite) is a new dependency. Worth it?
   - **Proposal**: Yes. `better-sqlite3` is battle-tested, zero-config, and the only alternative is reimplementing search/indexing on top of files.

---

## References

- **OpenClaw** — Files as truth, SQLite as index. Pre-compaction memory flush. Hybrid search (70/30 vector/BM25). Temporal decay on memory scores.
- **HKUDS/nanobot** — LLM-as-memory-curator. Two-tier memory (MEMORY.md + HISTORY.md). Progressive context assembly.
- **Letta/MemGPT** — Per-agent memory blocks with read-only sharing. Concurrency-aware memory tools (insert/replace/rethink).
- **Collaborative Memory (May 2025)** — Dynamic bipartite access graphs for fine-grained memory permissions.
- **MINJA Attack (ACL 2025)** — >95% success in poisoning unmediated agent memory. Security case for mediated access.
- **Nobody Agents** — "When behavior doesn't match the file, update the file." Behavioral identity over aspirational.
- **Geneclaw** — 5-layer gating (path allowlist, denylist, size, secrets, code patterns). Progressive trust expansion.
