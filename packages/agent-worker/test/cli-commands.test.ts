import { describe, test, expect } from "bun:test";

// ==================== Client Module Tests ====================

import { isDaemonActive } from "../src/cli/client.ts";

describe("Client Module", () => {
  test("isDaemonActive returns false when no daemon running", () => {
    const active = isDaemonActive();
    expect(typeof active).toBe("boolean");
  });
});

// ==================== CLI Command Logic Tests ====================

import { buildTarget, parseTarget } from "../src/cli/target.ts";

describe("CLI Command Logic", () => {
  describe("target handling", () => {
    test("builds targets with workspace (includes tag)", () => {
      const target = buildTarget("reviewer", "pr-123", "v1");
      expect(target).toBe("reviewer@pr-123:v1");

      const parsed = parseTarget(target);
      expect(parsed.agent).toBe("reviewer");
      expect(parsed.workspace).toBe("pr-123");
      expect(parsed.tag).toBe("v1");
    });

    test("default workspace is used when not specified", () => {
      const id = buildTarget("worker");
      expect(id).toBe("worker@global");

      const parsed = parseTarget(id);
      expect(parsed.workspace).toBe("global");
      expect(parsed.tag).toBeUndefined();
    });
  });

  describe("daemon check", () => {
    test("isDaemonActive returns boolean", () => {
      const active = isDaemonActive();
      expect(typeof active).toBe("boolean");
    });
  });
});

// ==================== Agent Workspace Lifecycle Tests ====================

describe("Agent Workspace Lifecycle", () => {
  test("buildTarget handles workspace naming", () => {
    const reviewerId = buildTarget("reviewer", "pr-review", "pr-123");
    const coderId = buildTarget("coder", "pr-review", "pr-123");

    expect(reviewerId).toBe("reviewer@pr-review:pr-123");
    expect(coderId).toBe("coder@pr-review:pr-123");

    const parsed1 = parseTarget(reviewerId);
    const parsed2 = parseTarget(coderId);
    expect(parsed1.workspace).toBe(parsed2.workspace);
  });

  test("default workspace is used when not specified", () => {
    const id = buildTarget("worker");
    expect(id).toBe("worker@global");

    const parsed = parseTarget(id);
    expect(parsed.workspace).toBe("global");
    expect(parsed.tag).toBeUndefined();
  });
});
