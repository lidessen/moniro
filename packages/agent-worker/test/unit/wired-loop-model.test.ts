/**
 * Test that createWiredLoop propagates resolved model to the agent loop.
 *
 * Regression: when workflow YAML has `model: auto`, the factory resolves it
 * to a concrete model for backend creation but previously passed the original
 * agent (with model="auto") to createAgentLoop. The SDK runner then called
 * createModelAsync("auto") which threw "Unknown provider: auto".
 */
import { describe, test, expect } from "bun:test";
import { createWiredLoop, type RuntimeContext } from "../../src/workflow/factory.ts";
import { createMemoryContextProvider } from "../../src/workflow/context/memory-provider.ts";
import { EventLog } from "../../src/workflow/context/event-log.ts";
import type { ResolvedAgent } from "../../src/workflow/types.ts";

/** Minimal runtime context for testing (no HTTP server needed) */
function createTestRuntime(): RuntimeContext {
  const provider = createMemoryContextProvider(["test-agent"]);
  return {
    contextProvider: provider,
    contextDir: "/tmp/test-wired-loop",
    eventLog: new EventLog(provider),
    mcpUrl: "http://127.0.0.1:0/mcp",
    mcpToolNames: new Set(),
    projectDir: process.cwd(),
  };
}

describe("createWiredLoop model resolution", () => {
  // model: "auto" needs at least one provider key for resolution
  let savedKey: string | undefined;

  test("resolves model: auto and passes concrete model to loop agent", () => {
    savedKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = savedKey || "test-key";
    try {
      const agent: ResolvedAgent = {
        model: "auto",
        system_prompt: "test",
        resolvedSystemPrompt: "test",
      };

      const { loop } = createWiredLoop({
        name: "test-agent",
        agent,
        runtime: createTestRuntime(),
        createBackend: () => ({
          type: "default",
          send: async () => ({ content: "ok" }),
        }),
      });

      // The loop should exist and be stoppable
      expect(loop).toBeDefined();
      expect(loop.name).toBe("test-agent");
      expect(loop.state).toBe("stopped");
    } finally {
      if (savedKey !== undefined) process.env.AI_GATEWAY_API_KEY = savedKey;
      else delete process.env.AI_GATEWAY_API_KEY;
    }
  });

  test("model: auto does not mutate the original agent object", () => {
    savedKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = savedKey || "test-key";
    try {
      const agent: ResolvedAgent = {
        model: "auto",
        system_prompt: "test",
        resolvedSystemPrompt: "test",
      };

      createWiredLoop({
        name: "test-agent",
        agent,
        runtime: createTestRuntime(),
        createBackend: () => ({
          type: "default",
          send: async () => ({ content: "ok" }),
        }),
      });

      // Original agent should NOT be mutated
      expect(agent.model).toBe("auto");
    } finally {
      if (savedKey !== undefined) process.env.AI_GATEWAY_API_KEY = savedKey;
      else delete process.env.AI_GATEWAY_API_KEY;
    }
  });

  test("non-auto model passes through unchanged", () => {
    const agent: ResolvedAgent = {
      model: "deepseek/deepseek-chat",
      system_prompt: "test",
      resolvedSystemPrompt: "test",
    };

    // Track what agent config the backend factory receives
    let receivedAgent: ResolvedAgent | undefined;
    createWiredLoop({
      name: "test-agent",
      agent,
      runtime: createTestRuntime(),
      createBackend: (_name, a) => {
        receivedAgent = a;
        return {
          type: "default",
          send: async () => ({ content: "ok" }),
        };
      },
    });

    // Non-auto model should pass through
    expect(receivedAgent?.model).toBe("deepseek/deepseek-chat");
  });
});
