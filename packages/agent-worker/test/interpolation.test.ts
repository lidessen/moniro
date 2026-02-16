/**
 * Tests for variable interpolation and workflow parser integration.
 */
import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { interpolate, type InterpolationContext } from "../src/workflow/interpolate.ts";
import { parseWorkflowFile } from "../src/workflow/parser.ts";

// ==================== Interpolation ====================

describe("interpolate", () => {
  function ctx(overrides?: Partial<InterpolationContext>): InterpolationContext {
    return {
      setup: {},
      env: {},
      workflow: { name: "test", tag: "main" },
      ...overrides,
    };
  }

  test("replaces setup variables", () => {
    const result = interpolate("Data: ${{ diff }}", ctx({ setup: { diff: "abc" } }));
    expect(result).toBe("Data: abc");
  });

  test("replaces env variables", () => {
    const result = interpolate("Key: ${{ env.API_KEY }}", ctx({ env: { API_KEY: "secret" } }));
    expect(result).toBe("Key: secret");
  });

  test("replaces workflow metadata", () => {
    const result = interpolate(
      "Running ${{ workflow.name }}:${{ workflow.tag }}",
      ctx({ workflow: { name: "review", tag: "pr-42" } }),
    );
    expect(result).toBe("Running review:pr-42");
  });

  test("handles whitespace in expressions", () => {
    const result = interpolate("${{  diff  }}", ctx({ setup: { diff: "ok" } }));
    expect(result).toBe("ok");
  });

  test("leaves unresolved variables as-is", () => {
    const result = interpolate("Missing: ${{ unknown }}", ctx());
    expect(result).toBe("Missing: ${{ unknown }}");
  });

  test("handles multiple variables in one string", () => {
    const result = interpolate(
      "${{ greeting }}, version ${{ version }}!",
      ctx({ setup: { greeting: "Hello", version: "1.0" } }),
    );
    expect(result).toBe("Hello, version 1.0!");
  });

  test("multiline template", () => {
    const template = [
      "Line 1: ${{ a }}",
      "Line 2: ${{ env.B }}",
      "Line 3: ${{ workflow.name }}",
    ].join("\n");

    const result = interpolate(template, ctx({
      setup: { a: "alpha" },
      env: { B: "beta" },
      workflow: { name: "review", tag: "main" },
    }));

    expect(result).toBe("Line 1: alpha\nLine 2: beta\nLine 3: review");
  });
});

// ==================== Parser + fixtures ====================

describe("workflow parser", () => {
  const fixturesDir = join(import.meta.dir, "fixtures");

  test("parses simple-review.yaml", async () => {
    const wf = await parseWorkflowFile(join(fixturesDir, "simple-review.yaml"));

    expect(wf.name).toBe("simple-review");
    expect(Object.keys(wf.agents)).toEqual(["reviewer", "coder"]);
    expect(wf.agents.reviewer.backend).toBe("mock");
    expect(wf.agents.reviewer.resolvedSystemPrompt).toContain("code reviewer");
    expect(wf.agents.coder.resolvedSystemPrompt).toContain("Fix issues");
    expect(wf.kickoff).toContain("@reviewer");
    expect(wf.setup).toEqual([]);
  });

  test("parses with-setup.yaml", async () => {
    const wf = await parseWorkflowFile(join(fixturesDir, "with-setup.yaml"));

    expect(wf.name).toBe("setup-test");
    expect(wf.setup).toHaveLength(2);
    expect(wf.setup[0].shell).toBe('echo "hello world"');
    expect(wf.setup[0].as).toBe("greeting");
    expect(wf.kickoff).toContain("${{ greeting }}");
    expect(wf.kickoff).toContain("${{ workflow.name }}");
  });
});
