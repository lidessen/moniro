import { describe, test, expect, mock } from "bun:test";

// Clear module mocks from other test files (e.g. session-send.test.ts mocks models.ts)
mock.restore();

// Dynamic import after mock.restore() to get unmocked module
const {
  discoverProvider,
  resolveAutoModel,
  resolveModelFallback,
  isAutoProvider,
} = await import("../../src/agent/models.ts");

/** Create a clean env with only the specified keys set */
function env(keys: Record<string, string>): Record<string, string | undefined> {
  return keys;
}

describe("isAutoProvider", () => {
  test('returns true for "auto"', () => {
    expect(isAutoProvider("auto")).toBe(true);
  });

  test("returns false for other values", () => {
    expect(isAutoProvider("anthropic")).toBe(false);
    expect(isAutoProvider(undefined)).toBe(false);
    expect(isAutoProvider(null)).toBe(false);
  });
});

describe("discoverProvider", () => {
  test("returns null when no env vars set", () => {
    const result = discoverProvider({ env: env({}) });
    expect(result).toBe(null);
  });

  test("discovers anthropic when ANTHROPIC_API_KEY is set", () => {
    const result = discoverProvider({ env: env({ ANTHROPIC_API_KEY: "sk-test" }) });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("anthropic");
    expect(result!.model).toMatch(/^anthropic\//);
  });

  test("discovers deepseek when DEEPSEEK_API_KEY is set", () => {
    const result = discoverProvider({ env: env({ DEEPSEEK_API_KEY: "sk-test" }) });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("deepseek");
    expect(result!.model).toMatch(/^deepseek(\/|$)/);
  });

  test("discovers openai when OPENAI_API_KEY is set", () => {
    const result = discoverProvider({ env: env({ OPENAI_API_KEY: "sk-test" }) });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("openai");
    expect(result!.model).toMatch(/^openai(\/|$)/);
  });

  test("prefers gateway when AI_GATEWAY_API_KEY is set", () => {
    const result = discoverProvider({
      env: env({ AI_GATEWAY_API_KEY: "gw-test", DEEPSEEK_API_KEY: "sk-test" }),
    });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("gateway");
  });

  test("gateway uses anthropic model by default", () => {
    const result = discoverProvider({ env: env({ AI_GATEWAY_API_KEY: "gw-test" }) });
    expect(result).not.toBe(null);
    expect(result!.model).toMatch(/^anthropic\//);
  });

  test("respects preferred model — picks its provider", () => {
    const result = discoverProvider({
      preferredModel: "deepseek-chat",
      env: env({ DEEPSEEK_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-test2" }),
    });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("deepseek");
    expect(result!.model).toBe("deepseek/deepseek-chat");
  });

  test("falls back to priority order when preferred model's provider is unavailable", () => {
    const result = discoverProvider({
      preferredModel: "deepseek-chat",
      env: env({ ANTHROPIC_API_KEY: "sk-test" }),
    });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("anthropic");
  });

  test("gateway with preferred model uses correct provider prefix", () => {
    const result = discoverProvider({
      preferredModel: "deepseek-chat",
      env: env({ AI_GATEWAY_API_KEY: "gw-test" }),
    });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("gateway");
    expect(result!.model).toBe("deepseek/deepseek-chat");
  });

  test("AGENT_MODEL does NOT affect discoverProvider (handled by resolveModelFallback)", () => {
    const result = discoverProvider({
      env: env({ ANTHROPIC_API_KEY: "sk-test", AGENT_MODEL: "totally-different" }),
    });
    expect(result).not.toBe(null);
    expect(result!.provider).toBe("anthropic");
    // Model is from FRONTIER_MODELS, not AGENT_MODEL
    expect(result!.model).not.toContain("totally-different");
  });

  test("priority: anthropic before openai", () => {
    const result = discoverProvider({
      env: env({ ANTHROPIC_API_KEY: "sk-a", OPENAI_API_KEY: "sk-o" }),
    });
    expect(result!.provider).toBe("anthropic");
  });

  test("priority: openai before deepseek", () => {
    const result = discoverProvider({
      env: env({ OPENAI_API_KEY: "sk-o", DEEPSEEK_API_KEY: "sk-d" }),
    });
    expect(result!.provider).toBe("openai");
  });
});

describe("resolveAutoModel", () => {
  test("passes through non-auto values unchanged", () => {
    const result = resolveAutoModel({ model: "deepseek/deepseek-chat", provider: "deepseek" });
    expect(result.model).toBe("deepseek/deepseek-chat");
    expect(result.provider).toBe("deepseek");
  });

  test('resolves model: "auto"', () => {
    const result = resolveAutoModel({
      model: "auto",
      env: env({ ANTHROPIC_API_KEY: "sk-test" }),
    });
    expect(result.model).toMatch(/^anthropic\//);
    expect(result.model).not.toBe("auto");
    expect(result.provider).toBeUndefined();
  });

  test('resolves provider: "auto" with specific model', () => {
    const result = resolveAutoModel({
      model: "deepseek-chat",
      provider: "auto",
      env: env({ DEEPSEEK_API_KEY: "sk-test" }),
    });
    expect(result.model).toBe("deepseek/deepseek-chat");
  });

  test("throws when no provider available", () => {
    expect(() => resolveAutoModel({ model: "auto", env: env({}) })).toThrow(
      "No provider available",
    );
  });

  test('resolves model: "auto" picks deepseek when only deepseek available', () => {
    const result = resolveAutoModel({
      model: "auto",
      env: env({ DEEPSEEK_API_KEY: "sk-test" }),
    });
    expect(result.model).toMatch(/^deepseek(\/|$)/);
  });
});

describe("resolveModelFallback", () => {
  test("non-auto model passes through directly", () => {
    const result = resolveModelFallback({
      model: "anthropic/claude-sonnet-4-5",
      env: env({ ANTHROPIC_API_KEY: "sk-test" }),
    });
    expect(result.model).toBe("anthropic/claude-sonnet-4-5");
  });

  test("model: auto resolves via provider discovery", () => {
    const result = resolveModelFallback({
      model: "auto",
      env: env({ DEEPSEEK_API_KEY: "sk-test" }),
    });
    expect(result.model).toMatch(/^deepseek(\/|$)/);
  });

  test("AGENT_DEFAULT_MODELS picks first available preference", () => {
    // Only deepseek key set → skip anthropic, pick deepseek
    const result = resolveModelFallback({
      model: "auto",
      env: env({
        DEEPSEEK_API_KEY: "sk-test",
        AGENT_DEFAULT_MODELS: "anthropic/claude-sonnet-4-5, deepseek/deepseek-chat",
      }),
    });
    expect(result.model).toBe("deepseek/deepseek-chat");
  });

  test("AGENT_DEFAULT_MODELS respects order when both available", () => {
    const result = resolveModelFallback({
      model: "auto",
      env: env({
        DEEPSEEK_API_KEY: "sk-d",
        ANTHROPIC_API_KEY: "sk-a",
        AGENT_DEFAULT_MODELS: "deepseek/deepseek-chat, anthropic/claude-sonnet-4-5",
      }),
    });
    expect(result.model).toBe("deepseek/deepseek-chat");
  });

  test("implicit fallback to discovery after exhausting preferences", () => {
    const result = resolveModelFallback({
      model: "auto",
      env: env({
        ANTHROPIC_API_KEY: "sk-test",
        AGENT_DEFAULT_MODELS: "deepseek/deepseek-chat",
      }),
    });
    // deepseek not available → implicit fallback → discovers anthropic
    expect(result.model).toMatch(/^anthropic(\/|$)/);
  });

  test("throws when nothing available (no preferences, no provider keys)", () => {
    expect(() =>
      resolveModelFallback({
        model: "auto",
        env: env({}),
      }),
    ).toThrow("No provider available");
  });

  test("single preference value works", () => {
    const result = resolveModelFallback({
      model: "auto",
      env: env({
        ANTHROPIC_API_KEY: "sk-test",
        AGENT_DEFAULT_MODELS: "anthropic/claude-opus-4-5",
      }),
    });
    expect(result.model).toBe("anthropic/claude-opus-4-5");
  });

  test("gateway key makes all preferences available", () => {
    const result = resolveModelFallback({
      model: "auto",
      env: env({
        AI_GATEWAY_API_KEY: "gw-test",
        AGENT_DEFAULT_MODELS: "deepseek/deepseek-chat",
      }),
    });
    expect(result.model).toBe("deepseek/deepseek-chat");
  });

  test("handles model name without provider prefix", () => {
    const result = resolveModelFallback({
      model: "auto",
      env: env({
        DEEPSEEK_API_KEY: "sk-test",
        AGENT_DEFAULT_MODELS: "deepseek-chat",
      }),
    });
    expect(result.model).toBe("deepseek-chat");
  });

  test("AGENT_DEFAULT_MODELS applies even when YAML model is not auto", () => {
    // env var preference list takes precedence over YAML model field
    const result = resolveModelFallback({
      model: "anthropic/claude-sonnet-4-5",
      env: env({
        DEEPSEEK_API_KEY: "sk-test",
        AGENT_DEFAULT_MODELS: "deepseek-chat",
      }),
    });
    expect(result.model).toBe("deepseek-chat");
  });

  test("without AGENT_DEFAULT_MODELS, non-auto model is not affected", () => {
    const result = resolveModelFallback({
      model: "anthropic/claude-sonnet-4-5",
      env: env({ ANTHROPIC_API_KEY: "sk-test" }),
    });
    // No env var → YAML model passes through
    expect(result.model).toBe("anthropic/claude-sonnet-4-5");
    expect(result.provider).toBeUndefined();
  });
});
