/**
 * Personal Context Tools — local AI SDK tools for agent personal context.
 *
 * Unlike the MCP tools in workflow/context/mcp/personal.ts, these are
 * direct tool() objects that can be passed to AgentWorker without MCP.
 *
 * This lets personal agents use their context without a workspace MCP server.
 */

import { createTool } from "@moniro/agent-loop";
import type { PersonalContextProvider } from "./types.ts";

/**
 * Create personal context tools for an agent.
 *
 * Returns tool objects compatible with AgentWorker's tools parameter.
 * Only creates tools for methods that the provider supports.
 */
export function createPersonalContextTools(
  provider: PersonalContextProvider,
): Record<string, unknown> {
  const tools: Record<string, unknown> = {};

  // ── Memory ────────────────────────────────────────────────────

  if (provider.readMemory) {
    tools.my_memory_read = createTool({
      description:
        "Read your persistent memory entries. Returns all key-value pairs, or a specific key if provided.",
      schema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Specific memory key to read (omit for all)",
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const memory = await provider.readMemory!();
        const key = args.key as string | undefined;
        if (key) {
          const value = memory[key];
          return value !== undefined
            ? JSON.stringify({ key, value })
            : JSON.stringify({ error: `Key "${key}" not found` });
        }
        return JSON.stringify(memory);
      },
    });
  }

  if (provider.writeMemory) {
    tools.my_memory_write = createTool({
      description:
        "Store a persistent memory entry. Survives across sessions. Use for facts, preferences, learned patterns.",
      schema: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Memory key (e.g., 'team-conventions', 'auth-pattern')",
          },
          value: {
            description: "Value to store (string, number, object, array)",
          },
        },
        required: ["key", "value"],
      },
      execute: async (args: Record<string, unknown>) => {
        await provider.writeMemory!(args.key as string, args.value);
        return JSON.stringify({ status: "saved", key: args.key });
      },
    });
  }

  // ── Notes ─────────────────────────────────────────────────────

  if (provider.readNotes) {
    tools.my_notes_read = createTool({
      description:
        "Read your recent notes (freeform reflections, session summaries). Most recent first.",
      schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max notes to return (default: 5)",
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const limit = (args.limit as number) ?? 5;
        const notes = await provider.readNotes!(limit);
        return JSON.stringify({ count: notes.length, notes });
      },
    });
  }

  if (provider.appendNote) {
    tools.my_notes_write = createTool({
      description:
        "Write a freeform note (reflection, learning, observation). Stored as timestamped markdown.",
      schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Note content (markdown)",
          },
          slug: {
            type: "string",
            description: "Optional filename slug (e.g., 'session-review')",
          },
        },
        required: ["content"],
      },
      execute: async (args: Record<string, unknown>) => {
        const filename = await provider.appendNote!(
          args.content as string,
          args.slug as string | undefined,
        );
        return JSON.stringify({ status: "saved", filename });
      },
    });
  }

  // ── Todos ─────────────────────────────────────────────────────

  if (provider.readTodos) {
    tools.my_todos_read = createTool({
      description: "Read your active task list. Tasks persist across sessions.",
      schema: { type: "object", properties: {} },
      execute: async () => {
        const todos = await provider.readTodos!();
        return JSON.stringify({ count: todos.length, todos });
      },
    });
  }

  if (provider.writeTodos) {
    tools.my_todos_write = createTool({
      description: "Replace your todo list. Pass the complete list of active tasks.",
      schema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: { type: "string" },
            description: "List of active task descriptions",
          },
        },
        required: ["todos"],
      },
      execute: async (args: Record<string, unknown>) => {
        const todos = args.todos as string[];
        await provider.writeTodos!(todos);
        return JSON.stringify({ status: "saved", count: todos.length });
      },
    });
  }

  return tools;
}
