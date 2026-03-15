/**
 * Context MCP Server — thin orchestrator.
 *
 * Creates an McpServer and registers tools from each category.
 * The actual tool implementations live in their own files:
 *   channel.ts, resource.ts, inbox.ts, team.ts, proposal.ts,
 *   feedback.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextProvider } from "../provider.ts";
import { EventLog } from "../event-log.ts";
import type { Message } from "../types.ts";
import type { ProposalManager } from "../proposals.ts";
import type { FeedbackEntry } from "../../tools/feedback.ts";
import type { MCPToolContext } from "./types.ts";
import { getAgentId, createLogTool } from "./helpers.ts";
import { registerChannelTools } from "./channel.ts";
import { registerResourceTools } from "./resource.ts";
import { registerInboxTools } from "./inbox.ts";
import { registerTeamTools } from "./team.ts";
import { registerProposalTools } from "./proposal.ts";
import { registerFeedbackTool } from "./feedback.ts";
import { registerPersonalContextTools } from "./personal.ts";
import type { AgentHandleRef } from "../../types.ts";

// ── Options ──────────────────────────────────────────────────────

export interface ContextMCPServerOptions {
  /** Context provider for storage */
  provider: ContextProvider;
  /** Valid agent names for @mention validation */
  validAgents: string[];
  /** Server name (default: 'workflow-context') */
  name?: string;
  /** Server version (default: '1.0.0') */
  version?: string;
  /** Callback when an agent is @mentioned in channel_send */
  onMention?: (from: string, target: string, msg: Message) => void;
  /** Proposal manager for voting tools (optional) */
  proposalManager?: ProposalManager;
  /** Enable feedback tool (optional) */
  feedback?: boolean;
  /** Debug log function for tool calls (optional) */
  debugLog?: (message: string) => void;
  /** Resolve agent handle by name for personal context tools (optional) */
  resolveHandle?: (agentName: string) => AgentHandleRef | undefined;
}

// ── Factory ──────────────────────────────────────────────────────

export function createContextMCPServer(options: ContextMCPServerOptions) {
  const {
    provider,
    validAgents,
    name = "workflow-context",
    version = "1.0.0",
    onMention,
    proposalManager,
    feedback: feedbackEnabled,
    debugLog,
    resolveHandle,
  } = options;

  const server = new McpServer({ name, version });
  const eventLog = new EventLog(provider);

  // Build shared context for all tool categories
  const ctx: MCPToolContext = {
    provider,
    eventLog,
    validAgents,
    getAgentId,
    logTool: createLogTool(eventLog),
  };

  // Track connected agents (placeholder for future MCP notification support)
  const agentConnections = new Map<string, unknown>();

  // Collect all registered MCP tool names (for runtime stream parser dedup)
  const mcpToolNames = new Set<string>([
    // channel
    "channel_send",
    "channel_read",
    // resource
    "resource_create",
    "resource_read",
    // inbox
    "my_inbox",
    "my_inbox_ack",
    "my_status_set",
    // team
    "team_members",
    "team_doc_read",
    "team_doc_write",
    "team_doc_append",
    "team_doc_list",
    "team_doc_create",
  ]);

  // Register tool categories
  registerChannelTools(server, ctx, { onMention });
  registerResourceTools(server, ctx);
  registerInboxTools(server, ctx, { debugLog });
  registerTeamTools(server, ctx);

  if (proposalManager) {
    registerProposalTools(server, ctx, proposalManager);
    mcpToolNames.add("team_proposal_create");
    mcpToolNames.add("team_vote");
    mcpToolNames.add("team_proposal_status");
    mcpToolNames.add("team_proposal_cancel");
  }

  let getFeedback: () => FeedbackEntry[] = () => [];
  if (feedbackEnabled) {
    const fb = registerFeedbackTool(server, ctx);
    getFeedback = fb.getFeedback;
    mcpToolNames.add("feedback_submit");
  }

  if (resolveHandle) {
    registerPersonalContextTools(server, ctx, resolveHandle);
    mcpToolNames.add("my_memory_read");
    mcpToolNames.add("my_memory_write");
    mcpToolNames.add("my_notes_read");
    mcpToolNames.add("my_notes_write");
    mcpToolNames.add("my_todos_read");
    mcpToolNames.add("my_todos_write");
  }

  return {
    server,
    agentConnections,
    validAgents,
    proposalManager,
    getFeedback,
    /** MCP tool names — pass to stream parser for dedup */
    mcpToolNames,
    /** EventLog instance — for SDK runner and other event sources */
    eventLog,
  };
}

export type ContextMCPServer = ReturnType<typeof createContextMCPServer>;
