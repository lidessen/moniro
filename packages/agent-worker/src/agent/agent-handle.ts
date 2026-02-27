/**
 * AgentHandle — Runtime wrapper for an agent definition + persistent context.
 *
 * Created by AgentRegistry when an agent is loaded. Provides:
 *   - Context directory management (memory/, notes/, conversations/, todo/)
 *   - Read/write operations for personal context
 *   - State tracking (idle, running, stopped, error)
 *
 * Phase 1 scope: context directory + read/write ops.
 * Phase 3 adds: loop, workspaces, threads.
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgentDefinition } from "./definition.ts";
import { CONTEXT_SUBDIRS } from "./definition.ts";

// ── Types ─────────────────────────────────────────────────────────

export type AgentHandleState = "idle" | "running" | "stopped" | "error";

// ── AgentHandle ───────────────────────────────────────────────────

export class AgentHandle {
  /** Agent definition (from YAML) */
  readonly definition: AgentDefinition;

  /** Absolute path to agent's persistent context directory */
  readonly contextDir: string;

  /** Current agent state */
  state: AgentHandleState = "idle";

  constructor(definition: AgentDefinition, contextDir: string) {
    this.definition = definition;
    this.contextDir = contextDir;
  }

  /** Agent name (convenience accessor) */
  get name(): string {
    return this.definition.name;
  }

  // ── Context Directory ───────────────────────────────────────────

  /**
   * Ensure the context directory and all subdirectories exist.
   * Called on agent load/creation. Idempotent.
   */
  ensureContextDir(): void {
    for (const sub of CONTEXT_SUBDIRS) {
      mkdirSync(join(this.contextDir, sub), { recursive: true });
    }
  }

  // ── Memory (structured key-value) ───────────────────────────────

  /**
   * Read all memory entries as key-value records.
   * Memory files are YAML in memory/<key>.yaml.
   */
  async readMemory(): Promise<Record<string, unknown>> {
    const memDir = join(this.contextDir, "memory");
    if (!existsSync(memDir)) return {};

    const result: Record<string, unknown> = {};
    for (const file of readdirSync(memDir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      const key = basename(file).replace(/\.ya?ml$/i, "");
      try {
        const content = readFileSync(join(memDir, file), "utf-8");
        result[key] = parseYaml(content);
      } catch {
        // Skip malformed files
      }
    }
    return result;
  }

  /**
   * Write a memory entry. Creates/overwrites memory/<key>.yaml.
   */
  async writeMemory(key: string, value: unknown): Promise<void> {
    const memDir = join(this.contextDir, "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, `${key}.yaml`), stringifyYaml(value));
  }

  // ── Notes (freeform reflections) ────────────────────────────────

  /**
   * Read agent's notes, most recent first.
   * Notes are markdown files in notes/.
   */
  async readNotes(limit?: number): Promise<string[]> {
    const notesDir = join(this.contextDir, "notes");
    if (!existsSync(notesDir)) return [];

    const files = readdirSync(notesDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    const selected = limit ? files.slice(0, limit) : files;
    return selected.map((f) => readFileSync(join(notesDir, f), "utf-8"));
  }

  /**
   * Append a note. Creates notes/<date>-<slug>.md.
   */
  async appendNote(content: string, slug?: string): Promise<string> {
    const notesDir = join(this.contextDir, "notes");
    mkdirSync(notesDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const suffix = slug ?? `note-${Date.now().toString(36)}`;
    const filename = `${date}-${suffix}.md`;
    const filePath = join(notesDir, filename);

    writeFileSync(filePath, content);
    return filename;
  }

  // ── Todos (cross-session task tracking) ─────────────────────────

  /**
   * Read active todos from todo/index.md.
   * Returns lines that look like incomplete tasks: "- [ ] ..."
   */
  async readTodos(): Promise<string[]> {
    const todoFile = join(this.contextDir, "todo", "index.md");
    if (!existsSync(todoFile)) return [];

    const content = readFileSync(todoFile, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.match(/^\s*-\s*\[\s*\]/))
      .map((line) => line.replace(/^\s*-\s*\[\s*\]\s*/, "").trim());
  }

  /**
   * Write the full todo list. Replaces todo/index.md.
   */
  async writeTodos(todos: string[]): Promise<void> {
    const todoDir = join(this.contextDir, "todo");
    mkdirSync(todoDir, { recursive: true });

    const content = todos.map((t) => `- [ ] ${t}`).join("\n") + "\n";
    writeFileSync(join(todoDir, "index.md"), content);
  }
}
