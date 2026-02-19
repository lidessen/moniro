/**
 * Prompt builder — constructs the LLM prompt from raw context data.
 *
 * The worker pulls context via Daemon MCP, then builds the prompt locally.
 * This is a worker concern — daemon provides data, worker decides presentation.
 *
 * NOTE: Types here reflect the MCP wire format (flattened), not internal types.
 */

/** Inbox message as returned by the my_inbox MCP tool */
export interface WireInboxMessage {
  id: string;
  sender: string;
  content: string;
  priority: string;
  createdAt: number;
}

/** Channel message as returned by the channel_read MCP tool */
export interface WireChannelMessage {
  id: string;
  sender: string;
  content: string;
  recipients: string[];
  createdAt: number;
}

export interface PromptInput {
  /** Agent's system prompt */
  system?: string;
  /** Unread inbox messages (MCP wire format) */
  inbox: WireInboxMessage[];
  /** Recent channel messages (MCP wire format) */
  channel: WireChannelMessage[];
  /** Document content (optional) */
  document?: string;
  /** Team members for context */
  teamMembers?: Array<{ name: string; model: string; state: string }>;
}

/**
 * Build the user prompt for a worker execution.
 * System prompt is separate (goes in system field).
 */
export function buildPrompt(input: PromptInput): string {
  const sections: string[] = [];

  // Inbox
  if (input.inbox.length > 0) {
    const lines = input.inbox.map((m) => {
      const priority = m.priority === "high" ? " [HIGH]" : "";
      return `- From @${m.sender}${priority}: ${m.content}`;
    });
    sections.push(`## Inbox (${input.inbox.length} messages for you)\n${lines.join("\n")}`);
  } else {
    sections.push("## Inbox\nNo unread messages.");
  }

  // Recent channel activity
  if (input.channel.length > 0) {
    const lines = input.channel.map((m) => {
      const time = new Date(m.createdAt).toISOString().slice(11, 19);
      return `[${time}] @${m.sender}: ${m.content}`;
    });
    sections.push(`## Recent Activity\n${lines.join("\n")}`);
  }

  // Document
  if (input.document) {
    sections.push(`## Current Workspace\n${input.document}`);
  }

  // Team members
  if (input.teamMembers && input.teamMembers.length > 0) {
    const lines = input.teamMembers.map((m) => `- @${m.name} (${m.model}) [${m.state}]`);
    sections.push(`## Team\n${lines.join("\n")}`);
  }

  // Instructions
  sections.push(
    "## Instructions\nProcess your inbox messages. Use MCP tools to collaborate with your team. Call channel_send to share your work. Call my_inbox_ack when done processing messages.",
  );

  return sections.join("\n\n");
}
