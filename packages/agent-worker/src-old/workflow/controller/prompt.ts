/**
 * Agent Prompt Building
 * Helpers for building agent prompts from context
 */

import type { Message, InboxMessage } from "../context/types.ts";
import type { AgentRunContext } from "./types.ts";

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
 * Build the complete agent prompt from run context
 */
export function buildAgentPrompt(ctx: AgentRunContext): string {
  const sections: string[] = [];

  // Project context (what codebase to work on)
  sections.push("## Project");
  sections.push(`Working on: ${ctx.projectDir}`);

  // Inbox section (most important)
  sections.push("");
  sections.push(
    `## Inbox (${ctx.inbox.length} message${ctx.inbox.length === 1 ? "" : "s"} for you)`,
  );
  sections.push(formatInbox(ctx.inbox));

  // Recent activity hint (use tool instead of injecting messages)
  sections.push("");
  sections.push("## Recent Activity");
  sections.push(
    "Use channel_read tool to view recent channel messages and conversation context if needed.",
  );

  // Shared document section
  if (ctx.documentContent) {
    sections.push("");
    sections.push("## Shared Document");
    sections.push(ctx.documentContent);
  }

  // Retry notice
  if (ctx.retryAttempt > 1) {
    sections.push("");
    sections.push(`## Note`);
    sections.push(`This is retry attempt ${ctx.retryAttempt}. Previous attempt failed.`);
  }

  // Instructions section
  sections.push("");
  sections.push("## Instructions");
  sections.push(
    "You are an agent in a multi-agent workflow. Communicate ONLY through the MCP tools below.",
  );
  sections.push(
    "Your text output is NOT seen by other agents — you MUST use channel_send to communicate.",
  );
  sections.push("");
  sections.push("### Channel Tools");
  sections.push(
    "- **channel_send**: Send a message to the shared channel. Use @agentname to mention/notify.",
  );
  sections.push(
    '  Use the "to" parameter for private DMs: channel_send({ message: "...", to: "bob" })',
  );
  sections.push(
    "- **channel_read**: Read recent channel messages (DMs and logs are auto-filtered).",
  );
  sections.push("");
  sections.push("### Team Tools");
  sections.push(
    "- **team_members**: List all agents you can @mention. Pass includeStatus=true to see their current state and tasks.",
  );
  sections.push("- **team_doc_read/write/append/list/create**: Shared team documents.");
  sections.push("");
  sections.push("### Personal Tools");
  sections.push("- **my_inbox**: Check your unread messages.");
  sections.push(
    "- **my_inbox_ack**: Acknowledge messages after processing (pass the latest message ID).",
  );
  sections.push(
    "- **my_status_set**: Update your status. Call when starting work (state='running', task='...') or when done (state='idle').",
  );
  sections.push("");
  sections.push("### Proposal & Voting Tools");
  sections.push(
    "- **team_proposal_create**: Create a proposal for team voting (types: election, decision, approval, assignment).",
  );
  sections.push(
    "- **team_vote**: Cast your vote on an active proposal. You can change your vote by voting again.",
  );
  sections.push(
    "- **team_proposal_status**: Check status of a proposal, or list all active proposals.",
  );
  sections.push("- **team_proposal_cancel**: Cancel a proposal you created.");
  sections.push("");
  sections.push("### Resource Tools");
  sections.push(
    "- **resource_create**: Store large content, get a reference (resource:id) for use anywhere.",
  );
  sections.push("- **resource_read**: Read resource content by ID.");

  // Feedback tool (opt-in)
  if (ctx.feedback) {
    sections.push("");
    sections.push("### Feedback Tool");
    sections.push(
      "- **feedback_submit**: Report workflow improvement needs — a missing tool, an awkward step, or a capability gap.",
    );
    sections.push("  Only use when you genuinely hit a pain point during your work.");
  }

  sections.push("");
  sections.push("### Workflow");
  sections.push("1. Read your inbox messages above");
  sections.push("2. Do your assigned work using channel_send with @mentions");
  sections.push("3. Acknowledge your inbox with my_inbox_ack");
  sections.push("4. Exit when your task is complete");
  sections.push("");
  sections.push("### IMPORTANT: When to stop");
  sections.push(
    "- Once your assigned task is complete, acknowledge your inbox and exit. Do NOT keep chatting.",
  );
  sections.push(
    '- Do NOT send pleasantries ("you\'re welcome", "glad to help", "thanks again") — they trigger unnecessary cycles.',
  );
  sections.push(
    "- Do NOT @mention another agent in your final message unless you need them to do more work.",
  );
  sections.push(
    "- If you receive a thank-you or acknowledgment, just call my_inbox_ack and exit. Do not reply.",
  );

  return sections.join("\n");
}
