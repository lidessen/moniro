/**
 * Personal Context MCP tools — my_memory_*, my_notes_*, my_todos_*
 *
 * Gives agents runtime access to their persistent personal context:
 *   - Memory: structured key-value store (YAML files)
 *   - Notes: freeform reflections (markdown files)
 *   - Todos: cross-session task tracking
 *
 * These tools are only registered for ref agents that have an AgentHandle
 * with a context directory. Inline agents don't get these tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MCPToolContext } from "./types.ts";
import type { AgentHandleRef } from "@/types.ts";

/**
 * Resolve an agent handle by name.
 * Returns undefined for inline agents or unknown agents.
 */
export type HandleResolver = (agentName: string) => AgentHandleRef | undefined;

export function registerPersonalContextTools(
  server: McpServer,
  ctx: MCPToolContext,
  resolveHandle: HandleResolver,
): void {
  const { getAgentId, logTool } = ctx;

  // ── Memory ────────────────────────────────────────────────────

  server.tool(
    "my_memory_read",
    "Read your persistent memory entries. Returns all key-value pairs, or a specific key if provided.",
    {
      key: z.string().optional().describe("Specific memory key to read (omit for all)"),
    },
    async (args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_memory_read", agent, args);

      const handle = resolveHandle(agent);
      if (!handle?.readMemory) {
        return text({ error: "No personal context available" });
      }

      const memory = await handle.readMemory();
      if (args.key) {
        const value = memory[args.key];
        return text(
          value !== undefined ? { key: args.key, value } : { error: `Key "${args.key}" not found` },
        );
      }
      return text(memory);
    },
  );

  server.tool(
    "my_memory_write",
    "Store a persistent memory entry. Survives across sessions. Use for facts, preferences, learned patterns.",
    {
      key: z.string().describe("Memory key (e.g., 'team-conventions', 'auth-pattern')"),
      value: z.unknown().describe("Value to store (string, number, object, array)"),
    },
    async (args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_memory_write", agent, args);

      const handle = resolveHandle(agent);
      if (!handle?.writeMemory) {
        return text({ error: "No personal context available" });
      }

      await handle.writeMemory(args.key, args.value);
      return text({ status: "saved", key: args.key });
    },
  );

  // ── Notes ─────────────────────────────────────────────────────

  server.tool(
    "my_notes_read",
    "Read your recent notes (freeform reflections, session summaries). Most recent first.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max notes to return (default: 5)"),
    },
    async (args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_notes_read", agent, args);

      const handle = resolveHandle(agent);
      if (!handle?.readNotes) {
        return text({ error: "No personal context available" });
      }

      const notes = await handle.readNotes(args.limit ?? 5);
      return text({ count: notes.length, notes });
    },
  );

  server.tool(
    "my_notes_write",
    "Write a freeform note (reflection, learning, observation). Stored as timestamped markdown.",
    {
      content: z.string().describe("Note content (markdown)"),
      slug: z.string().optional().describe("Optional filename slug (e.g., 'session-review')"),
    },
    async (args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_notes_write", agent, args);

      const handle = resolveHandle(agent);
      if (!handle?.appendNote) {
        return text({ error: "No personal context available" });
      }

      const filename = await handle.appendNote(args.content, args.slug);
      return text({ status: "saved", filename });
    },
  );

  // ── Todos ─────────────────────────────────────────────────────

  server.tool(
    "my_todos_read",
    "Read your active task list. Tasks persist across sessions.",
    {},
    async (_args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_todos_read", agent, {});

      const handle = resolveHandle(agent);
      if (!handle?.readTodos) {
        return text({ error: "No personal context available" });
      }

      const todos = await handle.readTodos();
      return text({ count: todos.length, todos });
    },
  );

  server.tool(
    "my_todos_write",
    "Replace your todo list. Pass the complete list of active tasks.",
    {
      todos: z.array(z.string()).describe("List of active task descriptions"),
    },
    async (args, extra) => {
      const agent = getAgentId(extra) || "anonymous";
      logTool("my_todos_write", agent, args);

      const handle = resolveHandle(agent);
      if (!handle?.writeTodos) {
        return text({ error: "No personal context available" });
      }

      await handle.writeTodos(args.todos);
      return text({ status: "saved", count: args.todos.length });
    },
  );
}

/** Helper: wrap value as MCP text content */
function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}
