# Breaking Changes in Agent Worker

## MCP Tool Renames (v0.7.0)

The workflow MCP tools have been reorganized with consistent naming conventions:

### Personal Namespace (`my_*`)
Tools for managing your own agent's state:

- `inbox_check` → `my_inbox`
- `inbox_ack` → `my_inbox_ack`
- **NEW**: `my_status_set` - Update your agent's status (state, task, metadata)

### Team Namespace (`team_*`)
Tools for team-wide operations:

- `document_read` → `team_doc_read`
- `document_write` → `team_doc_write`
- `document_append` → `team_doc_append`
- `document_list` → `team_doc_list`
- `document_create` → `team_doc_create`
- `workflow_agents` → `team_members` (also adds `includeStatus` parameter)
- `proposal_create` → `team_proposal_create`
- `proposal_status` → `team_proposal_status`
- `proposal_cancel` → `team_proposal_cancel`
- `vote` → `team_vote`

### Migration Guide

Update your workflow prompts and tool calls:

```diff
- Use inbox_check tool
+ Use my_inbox tool

- Use document_read tool
+ Use team_doc_read tool

- Use workflow_agents tool
+ Use team_members tool
```

## New Features

### Agent Status Management
- Agents can now track and share their current state (`idle`, `running`, `stopped`)
- View team member statuses with `team_members(includeStatus: true)`
- Automatic status updates by the controller during workflow execution

### Resource System
- `resource_create` - Store large content (>1200 chars) as addressable resources
- `resource_read` - Read resource content by ID
- Automatic conversion of long channel messages to resources

## Configuration Changes

### Idle Timeout
- Default idle timeout increased from 5 minutes (300000ms) to 10 minutes (600000ms)
- Affects all CLI backends: Claude, Cursor, Codex
- Timeout resets on any stdout activity (still an inactivity threshold, not total timeout)

## Implementation Notes

### Constants
- New `DEFAULT_IDLE_TIMEOUT` constant in `backends/types.ts`
- Prevents maintenance issues from duplicated timeout values

### State Consistency
- Task field always cleared when agent transitions to idle state
- Ensures idle agents don't show stale task descriptions
