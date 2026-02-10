# Workflow Technical Reference

Implementation reference. For design concepts, see [DESIGN.md](./DESIGN.md).

Source of truth is always the code in `src/workflow/`. This doc covers non-obvious patterns and tool APIs.

---

## MCP Tool Listing

The workflow MCP server exposes these tools to agents:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `channel_send` | `message: string` | Send message to channel (sender = agent identity) |
| `channel_read` | `since?: string, limit?: number` | Read channel entries |
| `my_inbox` | (none) | Get unread @mentions for this agent |
| `my_inbox_ack` | `until: string` | Acknowledge messages up to message ID |
| `my_status_set` | `task?: string, state?: 'idle'\|'running', metadata?: object` | Update your status and current task |
| `team_members` | `includeStatus?: boolean` | List all agents (optionally with status) |
| `team_doc_read` | `file?: string` | Read document (default: `notes.md`) |
| `team_doc_write` | `content: string, file?: string` | Write document (ownership enforced) |
| `team_doc_append` | `content: string, file?: string` | Append to document |
| `team_doc_list` | (none) | List all document files |
| `team_doc_create` | `file: string, content: string` | Create new document |
| `document_suggest` | `suggestion: string, file?: string` | Post suggestion @owner (non-owners) |
| `team_proposal_create` | `type, title, options[], resolution?, binding?, timeoutSeconds?` | Create proposal |
| `team_vote` | `proposal: string, choice: string, reason?: string` | Vote on proposal |
| `team_proposal_status` | `proposal?: string` | Check proposal status (or all active) |
| `team_proposal_cancel` | `proposal: string` | Cancel proposal (creator only) |
| `resource_create` | `content: string, type?: ResourceType` | Create resource for long content |
| `resource_read` | `id: string` | Read resource by ID |

Agent identity flows through `extra.sessionId` on every tool call — set by the MCP transport's `X-Agent-Id` header.

---

## Variable Interpolation

Variables use `${{ name }}` syntax in workflow YAML:

```yaml
setup:
  - shell: gh pr diff
    as: diff

kickoff: |
  ${{ diff }}                    # Setup output
  ${{ env.API_KEY }}             # Environment variable
  ${{ workflow.name }}           # Workflow metadata
  ${{ workflow.instance }}       # Instance name
```

Reserved: `env.*`, `workflow.name`, `workflow.instance`, `context.channel`, `context.document`

---

## Controller Loop

```
IDLE (polling every 5s, or wake() on @mention)
  │
  ▼ inbox has messages?
RUNNING
  │
  ├─ Build prompt: inbox + recent channel + document
  ├─ Run agent (backend-specific)
  │   ├─ Success → ack inbox → back to IDLE
  │   └─ Failure → retry (exponential backoff, max 3 attempts)
  │
  └─ After max retries → back to IDLE (messages stay unread for next cycle)
```

Key invariant: **inbox acknowledged only on successful run**. Failed runs keep messages unread.

---

## Idle Detection

Workflow exits (run mode) when ALL conditions are met:

1. All controllers idle (not running)
2. No unread inbox messages for any agent
3. No active proposals
4. Debounce elapsed (2s default — prevents premature exit during rapid @mention chains)

---

## Prompt Structure

Agent prompts built by `buildAgentPrompt()`:

```
## Inbox (N messages for you)
- From @alice [HIGH]: Please review the auth changes
- From @bob: FYI the tests pass now

## Recent Activity
[10:00:01] @alice: Starting code review
[10:05:32] @bob: Fixed the N+1 query

## Current Workspace
(contents of notes.md)

## Instructions
Process your inbox messages. Use MCP tools to collaborate.
```

---

## Proposal Types

| Type | Use Case | Example |
|------|----------|---------|
| `election` | Role selection | Document owner |
| `decision` | Design choices | "Use REST or GraphQL?" |
| `approval` | Sign-off | Merge approval |
| `assignment` | Task allocation | "Who handles auth?" |

Resolution: `plurality` (most votes) | `majority` (>50%) | `unanimous` (all agree)

Tie-breakers: `first` | `random` | `creator-decides`

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/workflow/parser.ts` | YAML parsing + validation |
| `src/workflow/runner.ts` | Workflow runtime init |
| `src/workflow/interpolate.ts` | Variable interpolation |
| `src/workflow/context/provider.ts` | ContextProvider interface |
| `src/workflow/context/file-provider.ts` | File-based storage |
| `src/workflow/context/memory-provider.ts` | In-memory storage (testing) |
| `src/workflow/context/mcp-server.ts` | MCP tool handlers |
| `src/workflow/context/http-transport.ts` | HTTP transport for MCP |
| `src/workflow/context/proposals.ts` | Voting system |
| `src/workflow/controller/controller.ts` | Agent polling loop |
| `src/workflow/controller/prompt.ts` | Prompt building |
| `src/workflow/controller/backend.ts` | Backend selection |
| `src/workflow/controller/send.ts` | Send target parsing |
