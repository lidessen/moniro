/**
 * Mock Runtime Helpers
 *
 * Reusable mock backend factories for testing loops and workflows.
 * Consolidates patterns from workflow-mock-backend.test.ts and workflow-simulation.test.ts.
 */

import type { Runtime, RuntimeResponse } from "@moniro/agent-loop";
import type { ContextProvider } from "@moniro/workspace";

type BehaviorFn = (
  prompt: string,
  provider: ContextProvider,
  options?: { system?: string },
) => Promise<void>;

/**
 * Create a mock backend that uses type 'claude' for normal prompt routing.
 * The behavior function receives the built prompt and can interact with
 * the context provider to simulate MCP tool calls.
 */
export function createMockRuntime(behavior: BehaviorFn, provider: ContextProvider): Runtime {
  return {
    type: "claude" as const,
    async send(message: string, options?: { system?: string }) {
      await behavior(message, provider, options);
      return { content: "ok" };
    },
  };
}

/**
 * Create a no-op backend for idle/lifecycle tests.
 */
export function noopBackend(): Runtime {
  return {
    type: "claude" as const,
    async send() {
      return { content: "ok" };
    },
  };
}

/**
 * Create a backend that fails N times then succeeds.
 * Returns the attempt count for assertions.
 */
export function failingBackend(failCount: number): Runtime & { getAttempts: () => number } {
  let attempts = 0;
  return {
    type: "claude" as const,
    async send() {
      attempts++;
      if (attempts <= failCount) throw new Error(`Attempt ${attempts} failed`);
      return { content: "ok" };
    },
    getAttempts: () => attempts,
  };
}

/**
 * Create a recording backend that captures all send() calls.
 */
export function recordingBackend(
  response: RuntimeResponse = { content: "ok" },
): Runtime & { getCalls: () => Array<{ message: string; options?: Record<string, unknown> }> } {
  const calls: Array<{ message: string; options?: Record<string, unknown> }> = [];
  return {
    type: "claude" as const,
    async send(message: string, options?: Record<string, unknown>) {
      calls.push({ message, options });
      return response;
    },
    getCalls: () => calls,
  };
}
