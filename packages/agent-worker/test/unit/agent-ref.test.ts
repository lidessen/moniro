/**
 * Tests for Phase 2: Workflow Agent References
 *
 * Covers:
 *   - AgentEntry discriminated union (RefAgentEntry | InlineAgentEntry)
 *   - isRefAgentEntry type guard
 *   - Validation of ref vs inline agents
 *   - Ref agent resolution (registry lookup, field mapping, prompt.append)
 *   - parseWorkflowFile with mixed ref + inline agents
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { isRefAgentEntry, type AgentEntry } from "@/workflow/types.ts";
import { validateWorkflow, parseWorkflowFile } from "@/workflow/parser.ts";
import { AgentRegistry } from "@/agent/agent-registry.ts";
import type { AgentDefinition } from "@/agent/definition.ts";

function tmpDir(): string {
  const dir = join(tmpdir(), `agent-ref-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── isRefAgentEntry ──────────────────────────────────────────────────

describe("isRefAgentEntry", () => {
  test("returns true for ref entries", () => {
    const entry: AgentEntry = { ref: "alice" };
    expect(isRefAgentEntry(entry)).toBe(true);
  });

  test("returns true for ref entries with prompt.append", () => {
    const entry: AgentEntry = {
      ref: "alice",
      prompt: { append: "Focus on auth." },
    };
    expect(isRefAgentEntry(entry)).toBe(true);
  });

  test("returns false for inline entries", () => {
    const entry: AgentEntry = {
      model: "anthropic/claude-sonnet-4-5",
      system_prompt: "You are helpful.",
    };
    expect(isRefAgentEntry(entry)).toBe(false);
  });

  test("returns false for inline entries with no model (CLI backend)", () => {
    const entry: AgentEntry = {
      backend: "claude",
    };
    expect(isRefAgentEntry(entry)).toBe(false);
  });
});

// ── Validation: ref agents ──────────────────────────────────────────

describe("validateWorkflow — ref agents", () => {
  test("accepts shorthand ref entry { ref: name }", () => {
    const result = validateWorkflow({
      agents: {
        alice: { ref: "alice" },
      },
    });
    expect(result.valid).toBe(true);
  });

  test("accepts ref entry with prompt.append", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          prompt: { append: "Focus on performance." },
        },
      },
    });
    expect(result.valid).toBe(true);
  });

  test("accepts ref entry with runtime overrides", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          max_tokens: 4000,
          max_steps: 10,
        },
      },
    });
    expect(result.valid).toBe(true);
  });

  test("rejects ref entry with system_prompt", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          system_prompt: "Not allowed",
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("system_prompt"))).toBe(true);
  });

  test("rejects ref entry with model", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          model: "not-allowed",
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("model"))).toBe(true);
  });

  test("rejects ref entry with backend", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          backend: "claude",
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("backend"))).toBe(true);
  });

  test("rejects ref entry with provider", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          provider: "anthropic",
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("provider"))).toBe(true);
  });

  test("rejects ref entry with tools", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          tools: ["read"],
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("tools"))).toBe(true);
  });

  test("rejects ref entry with wakeup", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          wakeup: "5m",
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("wakeup"))).toBe(true);
  });

  test("rejects ref entry with timeout", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          timeout: 30000,
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("timeout"))).toBe(true);
  });

  test("rejects ref entry with non-string prompt.append", () => {
    const result = validateWorkflow({
      agents: {
        alice: {
          ref: "alice",
          prompt: { append: 123 },
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("prompt.append"))).toBe(true);
  });
});

// ── Validation: mixed ref + inline ──────────────────────────────────

describe("validateWorkflow — mixed ref + inline", () => {
  test("accepts workflow with both ref and inline agents", () => {
    const result = validateWorkflow({
      agents: {
        alice: { ref: "alice" },
        helper: {
          model: "anthropic/claude-haiku-4-5",
          system_prompt: "You help with lookups.",
        },
      },
      kickoff: "@alice Review. @helper Check.",
    });
    expect(result.valid).toBe(true);
  });

  test("inline validation still works alongside ref", () => {
    const result = validateWorkflow({
      agents: {
        alice: { ref: "alice" },
        bad: { backend: "default" }, // missing model for default backend
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "agents.bad.model")).toBe(true);
  });
});

// ── Ref resolution ──────────────────────────────────────────────────

describe("parseWorkflowFile — ref agent resolution", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function setupRegistry(agents: AgentDefinition[]): AgentRegistry {
    const registry = new AgentRegistry(dir);
    for (const def of agents) {
      registry.registerDefinition(def);
    }
    return registry;
  }

  function writeWorkflow(filename: string, content: string): string {
    const path = join(dir, filename);
    writeFileSync(path, content);
    return path;
  }

  test("resolves ref agent from registry", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "You are Alice, a code reviewer." },
      },
    ]);

    const path = writeWorkflow(
      "review.yml",
      `agents:
  alice: { ref: alice }
kickoff: "@alice Start reviewing."
`,
    );

    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    const alice = workflow.agents.alice!;
    expect(alice.model).toBe("anthropic/claude-sonnet-4-5");
    expect(alice.resolvedSystemPrompt).toBe("You are Alice, a code reviewer.");
    expect(alice.isRef).toBe(true);
    expect(alice.handle).toBeDefined();
    expect(alice.handle!.definition.name).toBe("alice");
  });

  test("applies prompt.append to ref agent", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "You are Alice." },
      },
    ]);

    const path = writeWorkflow(
      "review.yml",
      `agents:
  alice:
    ref: alice
    prompt:
      append: Focus on security issues.
`,
    );

    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    const alice = workflow.agents.alice!;
    expect(alice.resolvedSystemPrompt).toBe("You are Alice.\n\nFocus on security issues.");
    // system_prompt holds the base prompt
    expect(alice.system_prompt).toBe("You are Alice.");
  });

  test("applies runtime overrides to ref agent", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "Alice." },
        max_tokens: 8000,
        max_steps: 20,
      },
    ]);

    const path = writeWorkflow(
      "review.yml",
      `agents:
  alice:
    ref: alice
    max_tokens: 4000
    max_steps: 5
`,
    );

    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    const alice = workflow.agents.alice!;
    // Overrides take precedence
    expect(alice.max_tokens).toBe(4000);
    expect(alice.max_steps).toBe(5);
  });

  test("maps backend 'sdk' to 'default'", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        backend: "sdk",
        prompt: { system: "Alice." },
      },
    ]);

    const path = writeWorkflow("review.yml", `agents:\n  alice: { ref: alice }\n`);
    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    expect(workflow.agents.alice!.backend).toBe("default");
  });

  test("preserves non-sdk backends as-is", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        backend: "claude",
        prompt: { system: "Alice." },
      },
    ]);

    const path = writeWorkflow("review.yml", `agents:\n  alice: { ref: alice }\n`);
    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    expect(workflow.agents.alice!.backend).toBe("claude");
  });

  test("inherits schedule from agent definition", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "Alice." },
        schedule: { wakeup: "5m", prompt: "Check inbox" },
      },
    ]);

    const path = writeWorkflow("review.yml", `agents:\n  alice: { ref: alice }\n`);
    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    expect(workflow.agents.alice!.schedule).toEqual({
      wakeup: "5m",
      prompt: "Check inbox",
    });
  });

  test("throws for ref without registry", async () => {
    const path = writeWorkflow("review.yml", `agents:\n  alice: { ref: alice }\n`);
    await expect(parseWorkflowFile(path)).rejects.toThrow("requires an AgentRegistry");
  });

  test("throws for ref to unknown agent", async () => {
    const registry = setupRegistry([]);
    const path = writeWorkflow("review.yml", `agents:\n  alice: { ref: alice }\n`);
    await expect(parseWorkflowFile(path, { agentRegistry: registry })).rejects.toThrow(
      "not found in registry",
    );
  });

  test("inline agents still work alongside ref agents", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "You are Alice." },
      },
    ]);

    const path = writeWorkflow(
      "review.yml",
      `agents:
  alice: { ref: alice }
  helper:
    model: anthropic/claude-haiku-4-5
    system_prompt: You help with lookups.
kickoff: "@alice Review. @helper Check."
`,
    );

    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });

    // Ref agent
    const alice = workflow.agents.alice!;
    expect(alice.isRef).toBe(true);
    expect(alice.handle).toBeDefined();
    expect(alice.model).toBe("anthropic/claude-sonnet-4-5");

    // Inline agent
    const helper = workflow.agents.helper!;
    expect(helper.isRef).toBe(false);
    expect(helper.handle).toBeUndefined();
    expect(helper.model).toBe("anthropic/claude-haiku-4-5");
    expect(helper.resolvedSystemPrompt).toBe("You help with lookups.");
  });

  test("maps provider from agent definition", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "claude-sonnet-4-5",
        provider: { name: "anthropic", base_url: "https://custom.api.com" },
        prompt: { system: "Alice." },
      },
    ]);

    const path = writeWorkflow("review.yml", `agents:\n  alice: { ref: alice }\n`);
    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    expect(workflow.agents.alice!.provider).toEqual({
      name: "anthropic",
      base_url: "https://custom.api.com",
    });
  });

  test("prompt.append with empty base prompt", async () => {
    const registry = setupRegistry([
      {
        name: "alice",
        model: "anthropic/claude-sonnet-4-5",
        prompt: { system: "" },
      },
    ]);

    const path = writeWorkflow(
      "review.yml",
      `agents:
  alice:
    ref: alice
    prompt:
      append: Focus on auth.
`,
    );

    const workflow = await parseWorkflowFile(path, { agentRegistry: registry });
    expect(workflow.agents.alice!.resolvedSystemPrompt).toBe("Focus on auth.");
  });
});
