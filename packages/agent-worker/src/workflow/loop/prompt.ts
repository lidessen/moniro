/**
 * Agent Prompt Building
 *
 * Composable prompt assembly: each section is an independent function
 * that returns content or null. The assembler joins non-null sections.
 *
 * This design supports Phase 2/5 where new sections (soul, memory, todo)
 * will be added without touching existing ones.
 */

import type { Message, InboxMessage } from "../context/types.ts";
import type { AgentRunContext } from "./types.ts";
import { formatConversationMessages } from "../../agent/conversation.ts";

// ── Section Type ──────────────────────────────────────────────────

/**
 * A prompt section: receives context, returns content or null (skip).
 * Each section is independent and can be added/removed/reordered.
 */
export type PromptSection = (ctx: AgentRunContext) => string | null;

// ── Format Helpers ────────────────────────────────────────────────

/**
 * Format inbox messages for display
 */
export function formatInbox(inbox: InboxMessage[]): string {
  if (inbox.length === 0) return "(no messages)";

  return inbox
    .map((m) => {
      const priority = m.priority === "high" ? " [HIGH]" : "";
      const time = m.entry.timestamp.slice(11, 19);
      const dm = m.entry.to ? " [DM]" : "";
      return `- [${time}] From @${m.entry.from}${priority}${dm}: ${m.entry.content}`;
    })
    .join("\n");
}

/**
 * Format channel messages for display
 */
export function formatChannel(entries: Message[]): string {
  if (entries.length === 0) return "(no messages)";

  return entries
    .map((e) => {
      const dm = e.to ? ` [DM→@${e.to}]` : "";
      return `[${e.timestamp.slice(11, 19)}] @${e.from}${dm}: ${e.content}`;
    })
    .join("\n");
}

/**
 * Format conversation messages for display.
 * Delegates to the shared formatter in conversation.ts.
 */
export function formatConversation(
  messages: import("../../agent/conversation.ts").ConversationMessage[],
): string {
  if (messages.length === 0) return "(no conversation history)";
  return formatConversationMessages(messages);
}

// ── Built-in Sections ─────────────────────────────────────────────

/** Project context (what codebase to work on) */
export const projectSection: PromptSection = (ctx) => `## Project\nWorking on: ${ctx.projectDir}`;

/** Inbox (unread messages for this agent) */
export const inboxSection: PromptSection = (ctx) => {
  const count = ctx.inbox.length;
  const label = count === 1 ? "message" : "messages";
  return `## Inbox (${count} ${label} for you)\n${formatInbox(ctx.inbox)}`;
};

/** Conversation history (thin thread for continuity) */
export const thinThreadSection: PromptSection = (ctx) => {
  if (!ctx.thinThread || ctx.thinThread.length === 0) return null;
  return `## Conversation History\n${formatConversation(ctx.thinThread)}`;
};

/** Recent activity hint (use tool instead of injecting messages) */
export const activitySection: PromptSection = () =>
  "## Recent Activity\nUse channel_read tool to view recent channel messages and conversation context if needed.";

/** Shared document section */
export const documentSection: PromptSection = (ctx) =>
  ctx.documentContent ? `## Shared Document\n${ctx.documentContent}` : null;

/** Retry notice */
export const retrySection: PromptSection = (ctx) =>
  ctx.retryAttempt > 1
    ? `## Note\nThis is retry attempt ${ctx.retryAttempt}. Previous attempt failed.`
    : null;

/** MCP tool instructions */
export const instructionsSection: PromptSection = (ctx) => {
  const lines: string[] = [];
  lines.push("## Instructions");
  lines.push(
    "You are an agent in a multi-agent workflow. Communicate ONLY through the MCP tools below.",
  );
  lines.push(
    "Your text output is NOT seen by other agents — you MUST use channel_send to communicate.",
  );
  lines.push("");
  lines.push("### Channel Tools");
  lines.push(
    "- **channel_send**: Send a message to the shared channel. Use @agentname to mention/notify.",
  );
  lines.push(
    '  Use the "to" parameter for private DMs: channel_send({ message: "...", to: "bob" })',
  );
  lines.push("- **channel_read**: Read recent channel messages (DMs and logs are auto-filtered).");
  lines.push("");
  lines.push("### Team Tools");
  lines.push(
    "- **team_members**: List all agents you can @mention. Pass includeStatus=true to see their current state and tasks.",
  );
  lines.push("- **team_doc_read/write/append/list/create**: Shared team documents.");
  lines.push("");
  lines.push("### Personal Tools");
  lines.push("- **my_inbox**: Check your unread messages.");
  lines.push(
    "- **my_inbox_ack**: Acknowledge messages after processing (pass the latest message ID).",
  );
  lines.push(
    "- **my_status_set**: Update your status. Call when starting work (state='running', task='...') or when done (state='idle').",
  );
  lines.push("");
  lines.push("### Proposal & Voting Tools");
  lines.push(
    "- **team_proposal_create**: Create a proposal for team voting (types: election, decision, approval, assignment).",
  );
  lines.push(
    "- **team_vote**: Cast your vote on an active proposal. You can change your vote by voting again.",
  );
  lines.push(
    "- **team_proposal_status**: Check status of a proposal, or list all active proposals.",
  );
  lines.push("- **team_proposal_cancel**: Cancel a proposal you created.");
  lines.push("");
  lines.push("### Resource Tools");
  lines.push(
    "- **resource_create**: Store large content, get a reference (resource:id) for use anywhere.",
  );
  lines.push("- **resource_read**: Read resource content by ID.");

  // Feedback tool (opt-in)
  if (ctx.feedback) {
    lines.push("");
    lines.push("### Feedback Tool");
    lines.push(
      "- **feedback_submit**: Report workflow improvement needs — a missing tool, an awkward step, or a capability gap.",
    );
    lines.push("  Only use when you genuinely hit a pain point during your work.");
  }

  return lines.join("\n");
};

/** Workflow instructions (read → work → ack → exit) */
export const workflowSection: PromptSection = () => {
  const lines: string[] = [];
  lines.push("### Workflow");
  lines.push("1. Read your inbox messages above");
  lines.push("2. Do your assigned work using channel_send with @mentions");
  lines.push("3. Acknowledge your inbox with my_inbox_ack");
  lines.push("4. Exit when your task is complete");
  return lines.join("\n");
};

/** Exit guidance (when to stop) */
export const exitSection: PromptSection = () => {
  const lines: string[] = [];
  lines.push("### IMPORTANT: When to stop");
  lines.push(
    "- Once your assigned task is complete, acknowledge your inbox and exit. Do NOT keep chatting.",
  );
  lines.push(
    '- Do NOT send pleasantries ("you\'re welcome", "glad to help", "thanks again") — they trigger unnecessary cycles.',
  );
  lines.push(
    "- Do NOT @mention another agent in your final message unless you need them to do more work.",
  );
  lines.push(
    "- If you receive a thank-you or acknowledgment, just call my_inbox_ack and exit. Do not reply.",
  );
  return lines.join("\n");
};

// ── Default Section List ──────────────────────────────────────────

/**
 * Default prompt sections — produces the same output as the original
 * monolithic buildAgentPrompt. New sections (soul, memory, todo) can
 * be inserted at specific positions without touching these.
 */
export const DEFAULT_SECTIONS: PromptSection[] = [
  projectSection,
  inboxSection,
  thinThreadSection,
  activitySection,
  documentSection,
  retrySection,
  instructionsSection,
  workflowSection,
  exitSection,
];

// ── Assembler ─────────────────────────────────────────────────────

/**
 * Assemble prompt from sections. Joins non-null sections with blank lines.
 */
export function assemblePrompt(sections: PromptSection[], ctx: AgentRunContext): string {
  return sections
    .map((section) => section(ctx))
    .filter((content): content is string => content !== null)
    .join("\n\n");
}

/**
 * Build the complete agent prompt from run context.
 *
 * Uses the default section list. For custom section lists,
 * use assemblePrompt() directly.
 */
export function buildAgentPrompt(ctx: AgentRunContext): string {
  return assemblePrompt(DEFAULT_SECTIONS, ctx);
}
