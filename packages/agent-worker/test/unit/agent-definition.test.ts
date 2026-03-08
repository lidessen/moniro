/**
 * Tests for Agent Definition + Context
 *
 * Covers:
 *   - AgentDefinition type + Zod schema validation
 *   - AgentHandle context operations (memory, notes, todos)
 *   - AgentRegistry (in-memory registration, lookup, delete)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { AgentDefinitionSchema, CONTEXT_SUBDIRS } from "@moniro/agent-loop";
import type { AgentDefinition } from "@moniro/agent-loop";
import { AgentHandle } from "@/agent/agent-handle.ts";
import { AgentRegistry } from "@/agent/agent-registry.ts";

// ── Test Helpers ──────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `agent-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── AgentDefinitionSchema ─────────────────────────────────────────

describe("AgentDefinitionSchema", () => {
  test("validates a minimal definition", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "You are Alice." },
    });
    expect(result.success).toBe(true);
  });

  test("validates a full definition", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      runtime: "sdk",
      provider: "anthropic",
      prompt: { system: "You are Alice." },
      soul: {
        role: "code-reviewer",
        expertise: ["typescript", "testing"],
        style: "thorough",
        principles: ["Be precise", "Be kind"],
      },
      context: { dir: ".agents/alice/", thin_thread: 15 },
      max_tokens: 8000,
      max_steps: 20,
      schedule: { wakeup: "5m", prompt: "Check inbox" },
    });
    expect(result.success).toBe(true);
  });

  test("validates system_file prompt variant", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "bob",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system_file: "./prompts/bob.md" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing name", () => {
    const result = AgentDefinitionSchema.safeParse({
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing model", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      prompt: { system: "Hello" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing prompt", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty name", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid runtime", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
      runtime: "invalid",
    });
    expect(result.success).toBe(false);
  });

  test("validates provider as object", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "MiniMax-M2.5",
      prompt: { system: "Hello" },
      provider: { name: "anthropic", base_url: "https://api.example.com" },
    });
    expect(result.success).toBe(true);
  });

  test("preserves custom soul fields (passthrough)", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
      soul: {
        role: "reviewer",
        custom_trait: "value",
        nested: { deep: true },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const soul = (result.data as AgentDefinition).soul!;
      expect(soul.role).toBe("reviewer");
      expect(soul.custom_trait).toBe("value");
      expect(soul.nested).toEqual({ deep: true });
    }
  });

  test("rejects negative thin_thread", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
      context: { thin_thread: -1 },
    });
    expect(result.success).toBe(false);
  });
});


// ── AgentHandle ───────────────────────────────────────────────────

describe("AgentHandle", () => {
  let dir: string;
  let handle: AgentHandle;

  beforeEach(() => {
    dir = tmpDir();
    const contextDir = join(dir, "alice");
    handle = new AgentHandle(
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "You are Alice." },
        soul: { role: "reviewer" },
      },
      contextDir,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("name accessor returns definition name", () => {
    expect(handle.name).toBe("alice");
  });

  test("initial state is idle", () => {
    expect(handle.state).toBe("idle");
  });

  test("ensureContextDir creates all subdirectories", () => {
    handle.ensureContextDir();
    for (const sub of CONTEXT_SUBDIRS) {
      expect(existsSync(join(handle.contextDir, sub))).toBe(true);
    }
  });

  test("ensureContextDir is idempotent", () => {
    handle.ensureContextDir();
    handle.ensureContextDir(); // should not throw
    for (const sub of CONTEXT_SUBDIRS) {
      expect(existsSync(join(handle.contextDir, sub))).toBe(true);
    }
  });

  // ── Memory ──────────────────────────────────────────────────────

  test("writeMemory + readMemory round-trips", async () => {
    handle.ensureContextDir();
    await handle.writeMemory("prefs", { theme: "dark", verbose: true });
    const mem = await handle.readMemory();
    expect(mem.prefs).toEqual({ theme: "dark", verbose: true });
  });

  test("readMemory returns empty on no memory dir", async () => {
    const mem = await handle.readMemory();
    expect(mem).toEqual({});
  });

  test("readMemory reads multiple keys", async () => {
    handle.ensureContextDir();
    await handle.writeMemory("key1", "value1");
    await handle.writeMemory("key2", { nested: true });
    const mem = await handle.readMemory();
    expect(mem.key1).toBe("value1");
    expect(mem.key2).toEqual({ nested: true });
  });

  // ── Notes ───────────────────────────────────────────────────────

  test("appendNote + readNotes round-trips", async () => {
    handle.ensureContextDir();
    await handle.appendNote("First learning", "first");
    await handle.appendNote("Second learning", "second");

    const notes = await handle.readNotes();
    expect(notes.length).toBe(2);
    // Most recent first
    expect(notes[0]).toContain("Second learning");
    expect(notes[1]).toContain("First learning");
  });

  test("readNotes with limit", async () => {
    handle.ensureContextDir();
    await handle.appendNote("Note 1", "n1");
    await handle.appendNote("Note 2", "n2");
    await handle.appendNote("Note 3", "n3");

    const notes = await handle.readNotes(2);
    expect(notes.length).toBe(2);
  });

  test("readNotes returns empty on no notes", async () => {
    const notes = await handle.readNotes();
    expect(notes).toEqual([]);
  });

  // ── Todos ───────────────────────────────────────────────────────

  test("writeTodos + readTodos round-trips", async () => {
    handle.ensureContextDir();
    await handle.writeTodos(["Fix bug #123", "Review PR #456"]);
    const todos = await handle.readTodos();
    expect(todos).toEqual(["Fix bug #123", "Review PR #456"]);
  });

  test("readTodos returns empty on no file", async () => {
    const todos = await handle.readTodos();
    expect(todos).toEqual([]);
  });

  // ── Instruction Routing ────────────────────────────────────────

  test("send() throws when no loop attached", () => {
    expect(() =>
      handle.send({
        id: "test-1",
        message: "hello",
        source: "mention",
        priority: "immediate",
        queuedAt: new Date().toISOString(),
      }),
    ).toThrow("has no loop");
  });

  test("send() delegates to loop.enqueue()", () => {
    const enqueued: any[] = [];
    // Attach a mock loop with enqueue
    handle.loop = {
      enqueue: (instr: any) => enqueued.push(instr),
    } as any;

    const instr = {
      id: "test-2",
      message: "urgent task",
      source: "dm" as const,
      priority: "immediate" as const,
      queuedAt: new Date().toISOString(),
    };
    handle.send(instr);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toBe(instr);
  });

  test("sendMessage() creates instruction with defaults", () => {
    const enqueued: any[] = [];
    handle.loop = {
      enqueue: (instr: any) => enqueued.push(instr),
    } as any;

    handle.sendMessage("do this");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].message).toBe("do this");
    expect(enqueued[0].priority).toBe("immediate");
    expect(enqueued[0].source).toBe("mention");
    expect(enqueued[0].id).toMatch(/^instr_/);
  });

  test("sendMessage() respects custom priority and source", () => {
    const enqueued: any[] = [];
    handle.loop = {
      enqueue: (instr: any) => enqueued.push(instr),
    } as any;

    handle.sendMessage("bg task", { priority: "background", source: "schedule" });
    expect(enqueued[0].priority).toBe("background");
    expect(enqueued[0].source).toBe("schedule");
  });
});

// ── AgentRegistry ─────────────────────────────────────────────────

describe("AgentRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("registerDefinition creates handle + context dir", () => {
    const registry = new AgentRegistry(dir);
    const handle = registry.registerDefinition({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Alice agent" },
    });

    expect(registry.has("alice")).toBe(true);
    expect(handle.name).toBe("alice");
    expect(handle.ephemeral).toBe(false);

    // Context dir at <workspace>/agents/<name>/
    expect(handle.contextDir).toBe(join(dir, "agents", "alice"));
    for (const sub of CONTEXT_SUBDIRS) {
      expect(existsSync(join(handle.contextDir, sub))).toBe(true);
    }
  });

  test("registerEphemeral creates handle without context dir", () => {
    const registry = new AgentRegistry(dir);
    const handle = registry.registerEphemeral({
      name: "temp",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Temp" },
    });

    expect(registry.has("temp")).toBe(true);
    expect(handle.ephemeral).toBe(true);
    // Context dir is set but not created on disk
    expect(existsSync(handle.contextDir)).toBe(false);
  });

  test("delete removes from memory", () => {
    const registry = new AgentRegistry(dir);
    registry.registerEphemeral({
      name: "temp",
      model: "m",
      prompt: { system: "T" },
    });

    expect(registry.delete("temp")).toBe(true);
    expect(registry.has("temp")).toBe(false);
  });

  test("delete returns false for nonexistent agent", () => {
    const registry = new AgentRegistry(dir);
    expect(registry.delete("nonexistent")).toBe(false);
  });

  test("list returns all handles", () => {
    const registry = new AgentRegistry(dir);
    registry.registerDefinition({
      name: "a1",
      model: "m1",
      prompt: { system: "A1" },
    });
    registry.registerDefinition({
      name: "a2",
      model: "m2",
      prompt: { system: "A2" },
    });

    const list = registry.list();
    expect(list.length).toBe(2);
    const names = list.map((h) => h.name).sort();
    expect(names).toEqual(["a1", "a2"]);
  });

  test("custom context.dir is respected", () => {
    const registry = new AgentRegistry(dir);
    const handle = registry.registerDefinition({
      name: "custom",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Custom" },
      context: { dir: "data/agents/custom" },
    });

    expect(handle.contextDir).toBe(join(dir, "data/agents/custom"));
    for (const sub of CONTEXT_SUBDIRS) {
      expect(existsSync(join(handle.contextDir, sub))).toBe(true);
    }
  });

  test("registerDefinition overwrites existing", () => {
    const registry = new AgentRegistry(dir);
    registry.registerDefinition({
      name: "alice",
      model: "model-v1",
      prompt: { system: "V1" },
    });
    registry.registerDefinition({
      name: "alice",
      model: "model-v2",
      prompt: { system: "V2" },
    });

    expect(registry.size).toBe(1);
    expect(registry.get("alice")!.definition.model).toBe("model-v2");
  });
});
