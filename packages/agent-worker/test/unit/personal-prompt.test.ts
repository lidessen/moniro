/**
 * Tests for Phase 6a: Personal Agent Prompt Sections
 *
 * Covers:
 *   - soulSection formatting
 *   - memorySection formatting
 *   - todoSection formatting
 *   - Integration with DEFAULT_SECTIONS and buildAgentPrompt
 *   - Null return for inline agents (no personal context)
 */

import { describe, test, expect } from "bun:test";
import {
  soulSection,
  memorySection,
  todoSection,
  buildAgentPrompt,
} from "@moniro/workflow";
import type { AgentRunContext, PersonalContext } from "@moniro/workflow";

// ── Test Helpers ──────────────────────────────────────────────────

function makeCtx(personalContext?: PersonalContext): AgentRunContext {
  return {
    name: "alice",
    agent: { model: "test" },
    inbox: [],
    recentChannel: [],
    documentContent: "",
    mcpUrl: "http://localhost:0/mcp",
    workspaceDir: "/tmp/test",
    projectDir: "/tmp/project",
    retryAttempt: 1,
    provider: {} as AgentRunContext["provider"],
    personalContext,
  };
}

// ── soulSection ──────────────────────────────────────────────────

describe("soulSection", () => {
  test("returns null when no personal context", () => {
    expect(soulSection(makeCtx())).toBeNull();
  });

  test("returns null when soul is undefined", () => {
    expect(soulSection(makeCtx({}))).toBeNull();
  });

  test("returns null when soul is empty", () => {
    expect(soulSection(makeCtx({ soul: {} }))).toBeNull();
  });

  test("formats role", () => {
    const result = soulSection(makeCtx({ soul: { role: "code-reviewer" } }));
    expect(result).toContain("## Identity");
    expect(result).toContain("**Role**: code-reviewer");
  });

  test("formats expertise", () => {
    const result = soulSection(
      makeCtx({ soul: { expertise: ["typescript", "testing"] } }),
    );
    expect(result).toContain("**Expertise**: typescript, testing");
  });

  test("formats style", () => {
    const result = soulSection(
      makeCtx({ soul: { style: "thorough but constructive" } }),
    );
    expect(result).toContain("**Style**: thorough but constructive");
  });

  test("formats principles", () => {
    const result = soulSection(
      makeCtx({
        soul: {
          principles: ["Explain the why", "Suggest, don't demand"],
        },
      }),
    );
    expect(result).toContain("**Principles**:");
    expect(result).toContain("- Explain the why");
    expect(result).toContain("- Suggest, don't demand");
  });

  test("formats full soul", () => {
    const result = soulSection(
      makeCtx({
        soul: {
          role: "architect",
          expertise: ["systems", "distributed"],
          style: "concise",
          principles: ["Simplicity first"],
        },
      }),
    );
    expect(result).toContain("## Identity");
    expect(result).toContain("**Role**: architect");
    expect(result).toContain("**Expertise**: systems, distributed");
    expect(result).toContain("**Style**: concise");
    expect(result).toContain("- Simplicity first");
  });
});

// ── memorySection ────────────────────────────────────────────────

describe("memorySection", () => {
  test("returns null when no personal context", () => {
    expect(memorySection(makeCtx())).toBeNull();
  });

  test("returns null when memory is empty", () => {
    expect(memorySection(makeCtx({ memory: {} }))).toBeNull();
  });

  test("formats string values", () => {
    const result = memorySection(
      makeCtx({ memory: { "auth-pattern": "JWT" } }),
    );
    expect(result).toContain("## Memory");
    expect(result).toContain("- **auth-pattern**: JWT");
  });

  test("formats object values as JSON", () => {
    const result = memorySection(
      makeCtx({ memory: { prefs: { theme: "dark" } } }),
    );
    expect(result).toContain("## Memory");
    expect(result).toContain('- **prefs**: {"theme":"dark"}');
  });

  test("formats multiple entries", () => {
    const result = memorySection(
      makeCtx({ memory: { lang: "TypeScript", framework: "React" } }),
    );
    expect(result).toContain("- **lang**: TypeScript");
    expect(result).toContain("- **framework**: React");
  });
});

// ── todoSection ──────────────────────────────────────────────────

describe("todoSection", () => {
  test("returns null when no personal context", () => {
    expect(todoSection(makeCtx())).toBeNull();
  });

  test("returns null when todos is empty", () => {
    expect(todoSection(makeCtx({ todos: [] }))).toBeNull();
  });

  test("formats todo items as checklist", () => {
    const result = todoSection(
      makeCtx({ todos: ["Review PR #42", "Update docs"] }),
    );
    expect(result).toContain("## Active Tasks");
    expect(result).toContain("- [ ] Review PR #42");
    expect(result).toContain("- [ ] Update docs");
  });
});

// ── buildAgentPrompt integration ─────────────────────────────────

describe("buildAgentPrompt with personal context", () => {
  test("includes personal sections for ref agent", () => {
    const ctx = makeCtx({
      soul: { role: "reviewer", expertise: ["go"] },
      memory: { "team-convention": "gofmt" },
      todos: ["Check linting"],
    });
    const prompt = buildAgentPrompt(ctx);

    // Personal sections appear in the prompt
    expect(prompt).toContain("## Identity");
    expect(prompt).toContain("**Role**: reviewer");
    expect(prompt).toContain("## Memory");
    expect(prompt).toContain("- **team-convention**: gofmt");
    expect(prompt).toContain("## Active Tasks");
    expect(prompt).toContain("- [ ] Check linting");

    // Standard sections still present
    expect(prompt).toContain("## Project");
    expect(prompt).toContain("## Inbox");
    expect(prompt).toContain("## Instructions");
  });

  test("no personal sections for inline agent (no context)", () => {
    const ctx = makeCtx(); // no personalContext
    const prompt = buildAgentPrompt(ctx);

    expect(prompt).not.toContain("## Identity");
    expect(prompt).not.toContain("## Memory");
    expect(prompt).not.toContain("## Active Tasks");

    // Standard sections still work
    expect(prompt).toContain("## Project");
    expect(prompt).toContain("## Instructions");
  });

  test("personal sections come before project section", () => {
    const ctx = makeCtx({
      soul: { role: "tester" },
      memory: { key: "value" },
      todos: ["Run tests"],
    });
    const prompt = buildAgentPrompt(ctx);

    const identityPos = prompt.indexOf("## Identity");
    const memoryPos = prompt.indexOf("## Memory");
    const tasksPos = prompt.indexOf("## Active Tasks");
    const projectPos = prompt.indexOf("## Project");

    expect(identityPos).toBeLessThan(projectPos);
    expect(memoryPos).toBeLessThan(projectPos);
    expect(tasksPos).toBeLessThan(projectPos);
  });
});
