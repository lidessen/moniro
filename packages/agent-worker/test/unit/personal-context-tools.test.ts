/**
 * Tests for Phase 6b: Personal Context MCP Tools
 *
 * Covers:
 *   - my_memory_read/write tools
 *   - my_notes_read/write tools
 *   - my_todos_read/write tools
 *   - Error handling for agents without context
 *   - Tool registration with resolveHandle
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createContextMCPServer, type ContextMCPServer } from "@moniro/workspace";
import { MemoryContextProvider } from "@moniro/workspace";
import type { AgentHandleRef } from "@moniro/workspace";
import type { AgentDefinition } from "@moniro/agent-loop";

// ── Mock AgentHandleRef ──────────────────────────────────────────

function createMockHandle(name: string): AgentHandleRef & {
  _memory: Record<string, unknown>;
  _notes: string[];
  _todos: string[];
} {
  const def: AgentDefinition = {
    name,
    model: "test",
    prompt: { system: "You are a test agent" },
    soul: { role: "tester", expertise: ["testing"] },
  };

  const handle = {
    definition: def,
    _memory: {} as Record<string, unknown>,
    _notes: [] as string[],
    _todos: [] as string[],

    async readMemory() {
      return { ...this._memory };
    },
    async writeMemory(key: string, value: unknown) {
      this._memory[key] = value;
    },
    async readNotes(limit?: number) {
      return limit ? this._notes.slice(0, limit) : [...this._notes];
    },
    async appendNote(content: string, slug?: string) {
      const filename = `2026-03-06-${slug ?? "note"}.md`;
      this._notes.unshift(content);
      return filename;
    },
    async readTodos() {
      return [...this._todos];
    },
    async writeTodos(todos: string[]) {
      this._todos = [...todos];
    },
  };

  return handle;
}

// ── Test Helpers ──────────────────────────────────────────────────

async function callTool(
  mcpServer: ContextMCPServer,
  toolName: string,
  args: Record<string, unknown>,
  extra?: { sessionId?: string },
): Promise<unknown> {
  const server = mcpServer.server as unknown as {
    _registeredTools: Record<
      string,
      {
        handler: (
          args: Record<string, unknown>,
          extra: unknown,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }
    >;
  };
  const tool = server._registeredTools[toolName];
  if (!tool) {
    throw new Error(`Tool ${toolName} not found`);
  }
  const result = await tool.handler(args, extra || {});
  const text = result.content[0]!.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe("Personal Context MCP Tools", () => {
  let provider: MemoryContextProvider;
  let mcpServer: ContextMCPServer;
  let aliceHandle: ReturnType<typeof createMockHandle>;
  const handles = new Map<string, AgentHandleRef>();

  beforeEach(() => {
    provider = new MemoryContextProvider(["alice", "bob"]);
    aliceHandle = createMockHandle("alice");
    handles.clear();
    handles.set("alice", aliceHandle);

    mcpServer = createContextMCPServer({
      provider,
      validAgents: ["alice", "bob"],
      resolveHandle: (name) => handles.get(name),
    });
  });

  // ── Registration ────────────────────────────────────────────────

  describe("registration", () => {
    test("registers personal context tools when resolveHandle provided", () => {
      expect(mcpServer.mcpToolNames.has("my_memory_read")).toBe(true);
      expect(mcpServer.mcpToolNames.has("my_memory_write")).toBe(true);
      expect(mcpServer.mcpToolNames.has("my_notes_read")).toBe(true);
      expect(mcpServer.mcpToolNames.has("my_notes_write")).toBe(true);
      expect(mcpServer.mcpToolNames.has("my_todos_read")).toBe(true);
      expect(mcpServer.mcpToolNames.has("my_todos_write")).toBe(true);
    });

    test("does not register personal tools when resolveHandle absent", () => {
      const noHandleMcp = createContextMCPServer({
        provider,
        validAgents: ["alice"],
      });
      expect(noHandleMcp.mcpToolNames.has("my_memory_read")).toBe(false);
    });
  });

  // ── Memory ──────────────────────────────────────────────────────

  describe("my_memory_read", () => {
    test("returns empty memory", async () => {
      const result = await callTool(mcpServer, "my_memory_read", {}, { sessionId: "alice" });
      expect(result).toEqual({});
    });

    test("returns all memory entries", async () => {
      aliceHandle._memory = { lang: "TypeScript", framework: "React" };
      const result = await callTool(mcpServer, "my_memory_read", {}, { sessionId: "alice" });
      expect(result).toEqual({ lang: "TypeScript", framework: "React" });
    });

    test("returns specific key", async () => {
      aliceHandle._memory = { lang: "TypeScript", framework: "React" };
      const result = await callTool(
        mcpServer,
        "my_memory_read",
        { key: "lang" },
        { sessionId: "alice" },
      ) as { key: string; value: string };
      expect(result.key).toBe("lang");
      expect(result.value).toBe("TypeScript");
    });

    test("returns error for missing key", async () => {
      const result = await callTool(
        mcpServer,
        "my_memory_read",
        { key: "missing" },
        { sessionId: "alice" },
      ) as { error: string };
      expect(result.error).toContain("not found");
    });

    test("returns error for agent without handle", async () => {
      const result = await callTool(
        mcpServer,
        "my_memory_read",
        {},
        { sessionId: "bob" },
      ) as { error: string };
      expect(result.error).toContain("No personal context");
    });
  });

  describe("my_memory_write", () => {
    test("writes a memory entry", async () => {
      const result = await callTool(
        mcpServer,
        "my_memory_write",
        { key: "pattern", value: "singleton" },
        { sessionId: "alice" },
      ) as { status: string; key: string };
      expect(result.status).toBe("saved");
      expect(result.key).toBe("pattern");
      expect(aliceHandle._memory["pattern"]).toBe("singleton");
    });

    test("overwrites existing entry", async () => {
      aliceHandle._memory = { lang: "JS" };
      await callTool(
        mcpServer,
        "my_memory_write",
        { key: "lang", value: "TypeScript" },
        { sessionId: "alice" },
      );
      expect(aliceHandle._memory["lang"]).toBe("TypeScript");
    });
  });

  // ── Notes ───────────────────────────────────────────────────────

  describe("my_notes_read", () => {
    test("returns empty notes", async () => {
      const result = await callTool(
        mcpServer,
        "my_notes_read",
        {},
        { sessionId: "alice" },
      ) as { count: number; notes: string[] };
      expect(result.count).toBe(0);
      expect(result.notes).toEqual([]);
    });

    test("returns recent notes", async () => {
      aliceHandle._notes = ["Session 3 reflection", "Session 2 notes", "Session 1 notes"];
      const result = await callTool(
        mcpServer,
        "my_notes_read",
        { limit: 2 },
        { sessionId: "alice" },
      ) as { count: number; notes: string[] };
      expect(result.count).toBe(2);
      expect(result.notes).toEqual(["Session 3 reflection", "Session 2 notes"]);
    });
  });

  describe("my_notes_write", () => {
    test("appends a note", async () => {
      const result = await callTool(
        mcpServer,
        "my_notes_write",
        { content: "Learned about caching patterns", slug: "caching" },
        { sessionId: "alice" },
      ) as { status: string; filename: string };
      expect(result.status).toBe("saved");
      expect(result.filename).toContain("caching");
      expect(aliceHandle._notes[0]).toBe("Learned about caching patterns");
    });
  });

  // ── Todos ───────────────────────────────────────────────────────

  describe("my_todos_read", () => {
    test("returns empty todos", async () => {
      const result = await callTool(
        mcpServer,
        "my_todos_read",
        {},
        { sessionId: "alice" },
      ) as { count: number; todos: string[] };
      expect(result.count).toBe(0);
      expect(result.todos).toEqual([]);
    });

    test("returns active todos", async () => {
      aliceHandle._todos = ["Review PR #42", "Update docs"];
      const result = await callTool(
        mcpServer,
        "my_todos_read",
        {},
        { sessionId: "alice" },
      ) as { count: number; todos: string[] };
      expect(result.count).toBe(2);
      expect(result.todos).toEqual(["Review PR #42", "Update docs"]);
    });
  });

  describe("my_todos_write", () => {
    test("replaces todo list", async () => {
      aliceHandle._todos = ["Old task"];
      const result = await callTool(
        mcpServer,
        "my_todos_write",
        { todos: ["New task 1", "New task 2"] },
        { sessionId: "alice" },
      ) as { status: string; count: number };
      expect(result.status).toBe("saved");
      expect(result.count).toBe(2);
      expect(aliceHandle._todos).toEqual(["New task 1", "New task 2"]);
    });
  });

  // ── Prompt Integration ──────────────────────────────────────────

  describe("prompt instructions", () => {
    test("includes personal context tools in prompt when context available", async () => {
      const { buildAgentPrompt } = await import("@moniro/workspace");
      const ctx = {
        name: "alice",
        agent: { model: "test" },
        inbox: [],
        recentChannel: [],
        documentContent: "",
        mcpUrl: "http://localhost/mcp",
        workspaceDir: "/tmp/test",
        projectDir: "/tmp/project",
        retryAttempt: 1,
        provider: {} as any,
        personalContext: { soul: { role: "tester" } },
      };
      const prompt = buildAgentPrompt(ctx);
      expect(prompt).toContain("my_memory_read");
      expect(prompt).toContain("my_notes_write");
      expect(prompt).toContain("my_todos_read");
    });

    test("excludes personal context tools in prompt when no context", async () => {
      const { buildAgentPrompt } = await import("@moniro/workspace");
      const ctx = {
        name: "alice",
        agent: { model: "test" },
        inbox: [],
        recentChannel: [],
        documentContent: "",
        mcpUrl: "http://localhost/mcp",
        workspaceDir: "/tmp/test",
        projectDir: "/tmp/project",
        retryAttempt: 1,
        provider: {} as any,
      };
      const prompt = buildAgentPrompt(ctx);
      expect(prompt).not.toContain("my_memory_read");
    });
  });
});
