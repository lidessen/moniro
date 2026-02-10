/**
 * Feedback tool — lets agents surface workflow improvement needs
 *
 * When enabled, agents can report what's missing or inconvenient during work:
 * a tool they wished they had, a step that felt unnecessarily slow, or a
 * capability gap. The purpose is workflow improvement, not bug reporting.
 *
 * @example
 * ```typescript
 * const { tool, getFeedback } = createFeedbackTool();
 *
 * const session = new AgentWorker({
 *   model: 'anthropic/claude-sonnet-4-5',
 *   system: FEEDBACK_PROMPT + '\nYou are a coding assistant.',
 *   tools: { feedback: tool, bash: bashTool },
 * });
 *
 * await session.send('...');
 * console.log(getFeedback()); // review what the agent reported
 * ```
 */

import { tool, jsonSchema } from "ai";

// ── Types ──────────────────────────────────────────────────────────

export interface FeedbackEntry {
  /** ISO timestamp */
  timestamp: string;
  /** What area this is about — a tool name, workflow step, etc. */
  target: string;
  /** Category */
  type: "missing" | "friction" | "suggestion";
  /** What the agent needed or what could be improved */
  description: string;
  /** Optional: what the agent was trying to do */
  context?: string;
}

export interface FeedbackToolOptions {
  /** Called each time the agent submits feedback */
  onFeedback?: (entry: FeedbackEntry) => void;
  /** Maximum entries to keep (default: 50) */
  maxEntries?: number;
}

export interface FeedbackToolResult {
  /** AI SDK tool() object — pass to AgentWorker as a tool */
  tool: unknown;
  /** Retrieve all collected feedback entries */
  getFeedback(): FeedbackEntry[];
  /** Clear collected feedback */
  clearFeedback(): void;
}

// ── System prompt snippet ──────────────────────────────────────────

/**
 * Append this to the system prompt when the feedback tool is enabled.
 * Tells the agent the tool exists and when to use it.
 */
export const FEEDBACK_PROMPT = `
## Feedback

You have a \`feedback\` tool. If you run into something inconvenient during your work — a tool you wish you had, a workflow step that feels unnecessarily slow, a capability gap — use it to report what you needed.

The purpose is to improve the workflow for future runs. Don't force feedback; only call it when you genuinely hit a pain point.
`.trim();

// ── Factory ────────────────────────────────────────────────────────

export function createFeedbackTool(options: FeedbackToolOptions = {}): FeedbackToolResult {
  const { onFeedback, maxEntries = 50 } = options;
  const entries: FeedbackEntry[] = [];

  const feedbackTool = tool({
    description:
      "Report a workflow improvement need. Use when you hit something inconvenient — a missing tool, an awkward step, or a capability you wished you had.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "The area this is about — a tool name (e.g. bash, readFile), a workflow step, or a general area (e.g. file search, code review).",
        },
        type: {
          type: "string",
          enum: ["missing", "friction", "suggestion"],
          description:
            "missing: a tool or capability you needed but didn't have. friction: something that works but is awkward or slow. suggestion: a concrete improvement idea.",
        },
        description: {
          type: "string",
          description: "What you needed or what could be improved. Be specific.",
        },
        context: {
          type: "string",
          description: "Optional: what you were trying to do when you hit this.",
        },
      },
      required: ["target", "type", "description"],
    }) as unknown as Parameters<typeof tool>[0]["inputSchema"],
    execute: async (args: Record<string, unknown>) => {
      const validTypes = ["missing", "friction", "suggestion"] as const;
      const rawType = args.type as string;
      const type = validTypes.includes(rawType as (typeof validTypes)[number])
        ? (rawType as FeedbackEntry["type"])
        : "suggestion";

      const entry: FeedbackEntry = {
        timestamp: new Date().toISOString(),
        target: args.target as string,
        type,
        description: args.description as string,
        ...(args.context ? { context: args.context as string } : {}),
      };

      // Enforce cap
      if (entries.length >= maxEntries) {
        entries.shift();
      }
      entries.push(entry);

      onFeedback?.(entry);

      return { recorded: true };
    },
  } as unknown as Parameters<typeof tool>[0]);

  return {
    tool: feedbackTool,
    getFeedback: () => [...entries],
    clearFeedback: () => {
      entries.length = 0;
    },
  };
}
