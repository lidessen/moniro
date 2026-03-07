import { describe, test, expect } from "bun:test";

// ==================== Target Identifier Tests ====================

import {
  parseTarget,
  buildTarget,
  isValidName,
  DEFAULT_WORKSPACE,
} from "../src/cli/target.ts";

describe("parseTarget", () => {
  test("parses simple agent name", () => {
    const result = parseTarget("reviewer");
    expect(result.agent).toBe("reviewer");
    expect(result.workspace).toBe("global");
    expect(result.tag).toBeUndefined();
    expect(result.full).toBe("reviewer@global");
  });

  test("parses agent@workspace format", () => {
    const result = parseTarget("reviewer@pr-123");
    expect(result.agent).toBe("reviewer");
    expect(result.workspace).toBe("pr-123");
    expect(result.tag).toBeUndefined();
  });

  test("handles explicit global workspace", () => {
    const result = parseTarget("assistant@global");
    expect(result.agent).toBe("assistant");
    expect(result.workspace).toBe("global");
  });

  test("handles empty workspace after @", () => {
    const result = parseTarget("agent@");
    expect(result.agent).toBe("agent");
    expect(result.workspace).toBe("global");
  });

  test("handles multiple @ symbols", () => {
    const result = parseTarget("agent@instance@extra");
    expect(result.agent).toBe("agent");
    expect(result.workspace).toBe("instance@extra");
  });

  test("handles hyphenated names", () => {
    const result = parseTarget("code-reviewer@feature-branch");
    expect(result.agent).toBe("code-reviewer");
    expect(result.workspace).toBe("feature-branch");
  });

  test("handles underscored names", () => {
    const result = parseTarget("test_agent@test_workspace");
    expect(result.agent).toBe("test_agent");
    expect(result.workspace).toBe("test_workspace");
  });

  test("handles numeric workspace", () => {
    const result = parseTarget("worker@123");
    expect(result.agent).toBe("worker");
    expect(result.workspace).toBe("123");
  });

  test("parses full agent@workspace:tag format", () => {
    const result = parseTarget("reviewer@review:pr-123");
    expect(result.agent).toBe("reviewer");
    expect(result.workspace).toBe("review");
    expect(result.tag).toBe("pr-123");
    expect(result.full).toBe("reviewer@review:pr-123");
  });

  test("parses workspace-only target @workspace", () => {
    const result = parseTarget("@review");
    expect(result.agent).toBeUndefined();
    expect(result.workspace).toBe("review");
    expect(result.tag).toBeUndefined();
  });

  test("parses workspace-only target @workspace:tag", () => {
    const result = parseTarget("@review:pr-123");
    expect(result.agent).toBeUndefined();
    expect(result.workspace).toBe("review");
    expect(result.tag).toBe("pr-123");
  });
});

describe("buildTarget", () => {
  test("builds with explicit workspace", () => {
    expect(buildTarget("agent", "prod")).toBe("agent@prod");
  });

  test("builds with default workspace when undefined", () => {
    expect(buildTarget("agent", undefined)).toBe("agent@global");
  });

  test("builds with default workspace when empty", () => {
    expect(buildTarget("agent", "")).toBe("agent@global");
  });

  test("preserves special characters in workspace", () => {
    expect(buildTarget("agent", "pr-123")).toBe("agent@pr-123");
    expect(buildTarget("agent", "feature_branch")).toBe("agent@feature_branch");
  });

  test("builds workspace-only target (no agent)", () => {
    expect(buildTarget(undefined, "review", "pr-123")).toBe("@review:pr-123");
  });

  test("builds with explicit tag", () => {
    expect(buildTarget("agent", "review", "pr-123")).toBe("agent@review:pr-123");
  });
});

describe("isValidName", () => {
  test("accepts alphanumeric", () => {
    expect(isValidName("test123")).toBe(true);
    expect(isValidName("ABC")).toBe(true);
    expect(isValidName("123")).toBe(true);
  });

  test("accepts hyphens", () => {
    expect(isValidName("my-workspace")).toBe(true);
    expect(isValidName("pr-123")).toBe(true);
  });

  test("accepts underscores", () => {
    expect(isValidName("my_workspace")).toBe(true);
    expect(isValidName("test_123")).toBe(true);
  });

  test("accepts dots", () => {
    expect(isValidName("test.workspace")).toBe(true);
    expect(isValidName("v1.2.3")).toBe(true);
  });

  test("accepts mixed valid characters", () => {
    expect(isValidName("my-test_workspace-123")).toBe(true);
  });

  test("rejects spaces", () => {
    expect(isValidName("my workspace")).toBe(false);
  });

  test("rejects special characters", () => {
    expect(isValidName("test@workspace")).toBe(false);
    expect(isValidName("test/workspace")).toBe(false);
    expect(isValidName("test:workspace")).toBe(false);
    expect(isValidName("test!workspace")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidName("")).toBe(false);
  });
});

describe("DEFAULT_WORKSPACE", () => {
  test('is "global"', () => {
    expect(DEFAULT_WORKSPACE).toBe("global");
  });
});

// ==================== Integration: parseTarget + buildTarget ====================

describe("parseTarget + buildTarget roundtrip", () => {
  test("parseTarget extracts workspace", () => {
    const parsed = parseTarget("agent@prod");
    expect(parsed.workspace).toBe("prod");
  });

  test("buildTarget without tag omits tag", () => {
    const built = buildTarget("agent", "prod");
    expect(built).toBe("agent@prod");
  });

  test("roundtrip: build → parse → verify", () => {
    const built = buildTarget("agent", "review", "pr-42");
    expect(built).toBe("agent@review:pr-42");

    const parsed = parseTarget(built);
    expect(parsed.agent).toBe("agent");
    expect(parsed.workspace).toBe("review");
    expect(parsed.tag).toBe("pr-42");
  });

  test("roundtrip with defaults: build → parse → verify", () => {
    const built = buildTarget("worker");
    expect(built).toBe("worker@global");

    const parsed = parseTarget(built);
    expect(parsed.agent).toBe("worker");
    expect(parsed.workspace).toBe("global");
    expect(parsed.tag).toBeUndefined();
  });
});
