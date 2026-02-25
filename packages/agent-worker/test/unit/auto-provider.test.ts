import { describe, test, expect, mock } from "bun:test";

// Clear module mocks from other test files (e.g. session-send.test.ts mocks models.ts)
mock.restore();

// Dynamic import after mock.restore() to get unmocked module
const {
  discoverProvider,
  resolveAutoModel,
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

  test("AGENT_MODEL env var overrides default model", () => {
    const result = discoverProvider({
      env: env({ ANTHROPIC_API_KEY: "sk-test", AGENT_MODEL: "claude-opus-4-5" }),
    });
    expect(result).not.toBe(null);
    expect(result!.model).toBe("anthropic/claude-opus-4-5");
  });

  test("AGENT_MODEL preserves provider/model format", () => {
    const result = discoverProvider({
      env: env({ ANTHROPIC_API_KEY: "sk-test", AGENT_MODEL: "openai/gpt-5.2" }),
    });
    expect(result).not.toBe(null);
    expect(result!.model).toBe("openai/gpt-5.2");
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
