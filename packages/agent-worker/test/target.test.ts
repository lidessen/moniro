import { describe, test, expect } from "bun:test";

// ==================== Target Utilities Tests ====================
// Tests for the workspace:tag model

import {
  parseTarget,
  buildTarget,
  buildTargetDisplay,
  isValidName,
  DEFAULT_WORKSPACE,
} from "../src/cli/target.ts";

describe("parseTarget", () => {
  describe("agent-only targets", () => {
    test("parses simple agent name", () => {
      const result = parseTarget("alice");
      expect(result.agent).toBe("alice");
      expect(result.workspace).toBe("global");
      expect(result.tag).toBeUndefined();
      expect(result.full).toBe("alice@global");
      expect(result.display).toBe("alice"); // Omits @global
    });

    test("parses agent@workspace", () => {
      const result = parseTarget("alice@review");
      expect(result.agent).toBe("alice");
      expect(result.workspace).toBe("review");
      expect(result.tag).toBeUndefined();
      expect(result.full).toBe("alice@review");
      expect(result.display).toBe("alice@review");
    });

    test("parses agent@workspace:tag (full format)", () => {
      const result = parseTarget("alice@review:pr-123");
      expect(result.agent).toBe("alice");
      expect(result.workspace).toBe("review");
      expect(result.tag).toBe("pr-123");
      expect(result.full).toBe("alice@review:pr-123");
      expect(result.display).toBe("alice@review:pr-123");
    });

    test("handles empty workspace after @", () => {
      const result = parseTarget("alice@");
      expect(result.agent).toBe("alice");
      expect(result.workspace).toBe("global");
      expect(result.tag).toBeUndefined();
    });

    test("handles empty tag after :", () => {
      const result = parseTarget("alice@review:");
      expect(result.agent).toBe("alice");
      expect(result.workspace).toBe("review");
      expect(result.tag).toBeUndefined();
    });
  });

  describe("workspace-only targets", () => {
    test("parses @workspace", () => {
      const result = parseTarget("@review");
      expect(result.agent).toBeUndefined();
      expect(result.workspace).toBe("review");
      expect(result.tag).toBeUndefined();
      expect(result.full).toBe("@review");
      expect(result.display).toBe("@review");
    });

    test("parses @workspace:tag", () => {
      const result = parseTarget("@review:pr-123");
      expect(result.agent).toBeUndefined();
      expect(result.workspace).toBe("review");
      expect(result.tag).toBe("pr-123");
      expect(result.full).toBe("@review:pr-123");
      expect(result.display).toBe("@review:pr-123");
    });

    test("parses @global (explicit default)", () => {
      const result = parseTarget("@global");
      expect(result.agent).toBeUndefined();
      expect(result.workspace).toBe("global");
      expect(result.tag).toBeUndefined();
      expect(result.full).toBe("@global");
      expect(result.display).toBe("@global");
    });

    test("handles empty workspace after @ (defaults to global)", () => {
      const result = parseTarget("@");
      expect(result.workspace).toBe("global");
      expect(result.tag).toBeUndefined();
    });
  });

  describe("special characters", () => {
    test("handles hyphenated names", () => {
      const result = parseTarget("code-reviewer@feature-branch:pr-123");
      expect(result.agent).toBe("code-reviewer");
      expect(result.workspace).toBe("feature-branch");
      expect(result.tag).toBe("pr-123");
    });

    test("handles underscored names", () => {
      const result = parseTarget("test_agent@test_workspace:test_tag");
      expect(result.agent).toBe("test_agent");
      expect(result.workspace).toBe("test_workspace");
      expect(result.tag).toBe("test_tag");
    });

    test("handles numeric names", () => {
      const result = parseTarget("agent1@workspace2:tag3");
      expect(result.agent).toBe("agent1");
      expect(result.workspace).toBe("workspace2");
      expect(result.tag).toBe("tag3");
    });

    test("handles dots in names", () => {
      const result = parseTarget("alice@v1.2.3:release-1.0");
      expect(result.agent).toBe("alice");
      expect(result.workspace).toBe("v1.2.3");
      expect(result.tag).toBe("release-1.0");
    });
  });

  describe("edge cases", () => {
    test("handles multiple @ symbols (takes first as separator)", () => {
      const result = parseTarget("agent@work@flow");
      expect(result.agent).toBe("agent");
      expect(result.workspace).toBe("work@flow"); // Rest becomes workspace
      expect(result.tag).toBeUndefined();
    });

    test("handles multiple : symbols (takes first as separator)", () => {
      const result = parseTarget("agent@workspace:tag:extra");
      expect(result.agent).toBe("agent");
      expect(result.workspace).toBe("workspace");
      expect(result.tag).toBe("tag:extra"); // Rest becomes tag
    });
  });
});

describe("buildTarget", () => {
  test("builds full target with all parts", () => {
    expect(buildTarget("alice", "review", "pr-123")).toBe("alice@review:pr-123");
  });

  test("uses default workspace when undefined", () => {
    expect(buildTarget("alice", undefined, "pr-123")).toBe("alice@global:pr-123");
  });

  test("omits tag when undefined", () => {
    expect(buildTarget("alice", "review", undefined)).toBe("alice@review");
  });

  test("uses both defaults when undefined", () => {
    expect(buildTarget("alice")).toBe("alice@global");
  });

  test("builds workspace-only target (no agent)", () => {
    expect(buildTarget(undefined, "review", "pr-123")).toBe("@review:pr-123");
  });

  test("builds workspace-only without tag", () => {
    expect(buildTarget(undefined, "review")).toBe("@review");
  });

  test("uses empty string as default", () => {
    expect(buildTarget("alice", "", "")).toBe("alice@global");
  });
});

describe("buildTargetDisplay", () => {
  describe("display rules - omit @global", () => {
    test("standalone agent (global, no tag) shows just name", () => {
      expect(buildTargetDisplay("alice", "global")).toBe("alice");
    });

    test("global workspace with tag shows workspace:tag", () => {
      expect(buildTargetDisplay("alice", "global", "pr-123")).toBe("alice@global:pr-123");
    });
  });

  describe("display rules - no tag", () => {
    test("non-global workspace without tag shows workspace", () => {
      expect(buildTargetDisplay("alice", "review")).toBe("alice@review");
    });

    test("non-global workspace with tag shows all", () => {
      expect(buildTargetDisplay("alice", "review", "pr-123")).toBe("alice@review:pr-123");
    });
  });

  describe("workspace-only targets", () => {
    test("@global shows @global", () => {
      expect(buildTargetDisplay(undefined, "global")).toBe("@global");
    });

    test("@global:tag shows @global:tag", () => {
      expect(buildTargetDisplay(undefined, "global", "pr-123")).toBe("@global:pr-123");
    });

    test("@workspace shows @workspace", () => {
      expect(buildTargetDisplay(undefined, "review")).toBe("@review");
    });

    test("@workspace:tag shows @workspace:tag", () => {
      expect(buildTargetDisplay(undefined, "review", "pr-123")).toBe("@review:pr-123");
    });
  });

  describe("uses defaults", () => {
    test("undefined workspace defaults to global", () => {
      expect(buildTargetDisplay("alice")).toBe("alice");
    });

    test("undefined tag — shows without tag", () => {
      expect(buildTargetDisplay("alice", "review")).toBe("alice@review");
    });

    test("both undefined defaults to alice", () => {
      expect(buildTargetDisplay("alice")).toBe("alice");
    });
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
    expect(isValidName("v1.2.3")).toBe(true);
    expect(isValidName("workspace.name")).toBe(true);
  });

  test("accepts mixed valid characters", () => {
    expect(isValidName("my-test_workspace.v1")).toBe(true);
  });

  test("rejects spaces", () => {
    expect(isValidName("my workspace")).toBe(false);
  });

  test("rejects special characters", () => {
    expect(isValidName("test@workspace")).toBe(false);
    expect(isValidName("test/workspace")).toBe(false);
    expect(isValidName("test:workspace")).toBe(false);
    expect(isValidName("test!workspace")).toBe(false);
    expect(isValidName("test#workspace")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidName("")).toBe(false);
  });
});

describe("DEFAULT constants", () => {
  test('DEFAULT_WORKSPACE is "global"', () => {
    expect(DEFAULT_WORKSPACE).toBe("global");
  });
});

describe("parseTarget + buildTarget roundtrip", () => {
  test("roundtrips full target", () => {
    const original = "alice@review:pr-123";
    const parsed = parseTarget(original);
    const rebuilt = buildTarget(parsed.agent, parsed.workspace, parsed.tag);
    expect(rebuilt).toBe("alice@review:pr-123");
  });

  test("roundtrips workspace-only target", () => {
    const original = "@review:pr-123";
    const parsed = parseTarget(original);
    const rebuilt = buildTarget(parsed.agent, parsed.workspace, parsed.tag);
    expect(rebuilt).toBe("@review:pr-123");
  });

  test("roundtrips simple agent (adds defaults)", () => {
    const original = "alice";
    const parsed = parseTarget(original);
    const rebuilt = buildTarget(parsed.agent, parsed.workspace, parsed.tag);
    expect(rebuilt).toBe("alice@global");
  });

  test("display uses original input when possible", () => {
    const cases = [
      { input: "alice", expectedDisplay: "alice" },
      { input: "alice@review", expectedDisplay: "alice@review" },
      { input: "alice@review:pr-123", expectedDisplay: "alice@review:pr-123" },
      { input: "@review", expectedDisplay: "@review" },
      { input: "@review:pr-123", expectedDisplay: "@review:pr-123" },
    ];

    for (const { input, expectedDisplay } of cases) {
      const parsed = parseTarget(input);
      expect(parsed.display).toBe(expectedDisplay);
    }
  });
});
