/**
 * Tests for Phase 1: Agent Definition + Context
 *
 * Covers:
 *   - AgentDefinition type + Zod schema validation
 *   - YAML parsing (single file, discovery, serialization)
 *   - AgentHandle context operations (memory, notes, todos)
 *   - AgentRegistry (load, create, delete, lookup)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { AgentDefinitionSchema, CONTEXT_SUBDIRS } from "@/agent/definition.ts";
import type { AgentDefinition } from "@/agent/definition.ts";
import { parseAgentFile, parseAgentObject, discoverAgents, serializeAgent } from "@/agent/yaml-parser.ts";
import { AgentHandle } from "@/agent/agent-handle.ts";
import { AgentRegistry } from "@/agent/agent-registry.ts";

// ── Test Helpers ──────────────────────────────────────────────────

function tmpDir(): string {
  const dir = join(tmpdir(), `agent-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeYaml(dir: string, filename: string, content: string): string {
  const path = join(dir, filename);
  writeFileSync(path, content);
  return path;
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
      backend: "sdk",
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

  test("rejects invalid backend", () => {
    const result = AgentDefinitionSchema.safeParse({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
      backend: "invalid",
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

// ── YAML Parser ───────────────────────────────────────────────────

describe("parseAgentFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("parses a valid YAML file", () => {
    const path = writeYaml(
      dir,
      "alice.yaml",
      `
name: alice
model: anthropic/claude-sonnet-4-5
prompt:
  system: You are Alice, a code reviewer.
soul:
  role: code-reviewer
  expertise:
    - typescript
    - testing
`,
    );

    const def = parseAgentFile(path);
    expect(def.name).toBe("alice");
    expect(def.model).toBe("anthropic/claude-sonnet-4-5");
    expect(def.prompt.system).toBe("You are Alice, a code reviewer.");
    expect(def.soul?.role).toBe("code-reviewer");
    expect(def.soul?.expertise).toEqual(["typescript", "testing"]);
  });

  test("infers name from filename", () => {
    const path = writeYaml(
      dir,
      "bob.yaml",
      `
model: anthropic/claude-sonnet-4-5
prompt:
  system: You are Bob.
`,
    );

    const def = parseAgentFile(path);
    expect(def.name).toBe("bob");
  });

  test("resolves system_file", () => {
    writeFileSync(join(dir, "prompt.md"), "You are a helpful assistant.");
    const path = writeYaml(
      dir,
      "helper.yaml",
      `
name: helper
model: anthropic/claude-sonnet-4-5
prompt:
  system_file: ./prompt.md
`,
    );

    const def = parseAgentFile(path);
    expect(def.prompt.system).toBe("You are a helpful assistant.");
    expect(def.prompt.system_file).toBeUndefined();
  });

  test("throws on missing file", () => {
    expect(() => parseAgentFile(join(dir, "nonexistent.yaml"))).toThrow(
      "Agent file not found",
    );
  });

  test("throws on missing system_file reference", () => {
    const path = writeYaml(
      dir,
      "bad.yaml",
      `
name: bad
model: anthropic/claude-sonnet-4-5
prompt:
  system_file: ./nonexistent.md
`,
    );

    expect(() => parseAgentFile(path)).toThrow("system_file not found");
  });

  test("throws on invalid YAML content", () => {
    const path = writeYaml(dir, "invalid.yaml", "model: x\nprompt: just-a-string\n");
    expect(() => parseAgentFile(path)).toThrow();
  });
});

describe("parseAgentObject", () => {
  test("validates a valid object", () => {
    const def = parseAgentObject({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Hello" },
    });
    expect(def.name).toBe("alice");
  });

  test("throws on invalid object", () => {
    expect(() => parseAgentObject({ name: "alice" })).toThrow(
      "Invalid agent definition",
    );
  });
});

describe("discoverAgents", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("discovers agents from .agents/ directory", () => {
    const agentsDir = join(dir, ".agents");
    mkdirSync(agentsDir, { recursive: true });

    writeYaml(
      agentsDir,
      "alice.yaml",
      `
name: alice
model: anthropic/claude-sonnet-4-5
prompt:
  system: Alice prompt
`,
    );
    writeYaml(
      agentsDir,
      "bob.yaml",
      `
name: bob
model: anthropic/claude-sonnet-4-5
prompt:
  system: Bob prompt
`,
    );

    const agents = discoverAgents(dir);
    expect(agents.length).toBe(2);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["alice", "bob"]);
  });

  test("returns empty array if .agents/ doesn't exist", () => {
    const agents = discoverAgents(dir);
    expect(agents).toEqual([]);
  });

  test("skips invalid files", () => {
    const agentsDir = join(dir, ".agents");
    mkdirSync(agentsDir, { recursive: true });

    writeYaml(
      agentsDir,
      "good.yaml",
      `
name: good
model: anthropic/claude-sonnet-4-5
prompt:
  system: Good agent
`,
    );
    writeYaml(agentsDir, "bad.yaml", "not: valid: agent\n");

    const warnings: string[] = [];
    const agents = discoverAgents(dir, (msg) => warnings.push(msg));
    expect(agents.length).toBe(1);
    expect(agents[0]!.name).toBe("good");
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("skips non-yaml files", () => {
    const agentsDir = join(dir, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "readme.md"), "not an agent");

    const agents = discoverAgents(dir);
    expect(agents).toEqual([]);
  });
});

describe("serializeAgent", () => {
  test("serializes a definition to YAML", () => {
    const def: AgentDefinition = {
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "You are Alice." },
      soul: { role: "reviewer" },
    };

    const yaml = serializeAgent(def);
    expect(yaml).toContain("name: alice");
    expect(yaml).toContain("model: anthropic/claude-sonnet-4-5");
    expect(yaml).toContain("system: You are Alice.");
    expect(yaml).toContain("role: reviewer");
  });

  test("round-trips through parse", () => {
    const dir = tmpDir();
    const def: AgentDefinition = {
      name: "roundtrip",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Test agent." },
      backend: "sdk",
      soul: { role: "tester", expertise: ["ts"] },
    };

    const yaml = serializeAgent(def);
    const path = writeYaml(dir, "roundtrip.yaml", yaml);
    const parsed = parseAgentFile(path);

    expect(parsed.name).toBe(def.name);
    expect(parsed.model).toBe(def.model);
    expect(parsed.prompt.system).toBe(def.prompt.system);
    expect(parsed.backend).toBe(def.backend);
    expect(parsed.soul?.role).toBe(def.soul?.role);
    expect(parsed.soul?.expertise).toEqual(def.soul?.expertise);

    rmSync(dir, { recursive: true, force: true });
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

  test("loadFromDisk discovers agents", () => {
    const agentsDir = join(dir, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    writeYaml(
      agentsDir,
      "alice.yaml",
      `
name: alice
model: anthropic/claude-sonnet-4-5
prompt:
  system: Alice agent
`,
    );

    const registry = new AgentRegistry(dir);
    registry.loadFromDisk();

    expect(registry.size).toBe(1);
    expect(registry.has("alice")).toBe(true);
    const handle = registry.get("alice")!;
    expect(handle.name).toBe("alice");
    expect(handle.definition.prompt.system).toBe("Alice agent");
  });

  test("create writes YAML and creates context dir", () => {
    const registry = new AgentRegistry(dir);
    const handle = registry.create({
      name: "bob",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Bob agent" },
    });

    // YAML file exists
    expect(existsSync(join(dir, ".agents", "bob.yaml"))).toBe(true);

    // Context dir + subdirs exist
    for (const sub of CONTEXT_SUBDIRS) {
      expect(existsSync(join(handle.contextDir, sub))).toBe(true);
    }

    // Registered in memory
    expect(registry.has("bob")).toBe(true);
    expect(registry.get("bob")).toBe(handle);
  });

  test("create throws on duplicate", () => {
    const registry = new AgentRegistry(dir);
    registry.create({
      name: "alice",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Alice" },
    });

    expect(() =>
      registry.create({
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "Another Alice" },
      }),
    ).toThrow("already exists");
  });

  test("delete removes YAML + context + unregisters", () => {
    const registry = new AgentRegistry(dir);
    const handle = registry.create({
      name: "temp",
      model: "anthropic/claude-sonnet-4-5",
      prompt: { system: "Temporary" },
    });

    const yamlPath = join(dir, ".agents", "temp.yaml");
    const contextDir = handle.contextDir;

    expect(existsSync(yamlPath)).toBe(true);
    expect(existsSync(contextDir)).toBe(true);

    const deleted = registry.delete("temp");
    expect(deleted).toBe(true);
    expect(registry.has("temp")).toBe(false);
    expect(existsSync(yamlPath)).toBe(false);
    expect(existsSync(contextDir)).toBe(false);
  });

  test("delete returns false for nonexistent agent", () => {
    const registry = new AgentRegistry(dir);
    expect(registry.delete("nonexistent")).toBe(false);
  });

  test("list returns all handles", () => {
    const registry = new AgentRegistry(dir);
    registry.create({
      name: "a1",
      model: "m1",
      prompt: { system: "A1" },
    });
    registry.create({
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

  test("loadFromDisk creates context dirs", () => {
    const agentsDir = join(dir, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    writeYaml(
      agentsDir,
      "loader.yaml",
      `
name: loader
model: anthropic/claude-sonnet-4-5
prompt:
  system: Loader agent
`,
    );

    const registry = new AgentRegistry(dir);
    registry.loadFromDisk();

    const handle = registry.get("loader")!;
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
