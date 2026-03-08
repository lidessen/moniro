/**
 * Mock AI Runtime
 *
 * Simple mock that echoes messages for testing.
 * For workflow integration testing with MCP tools, see loop/mock-runner.ts.
 */

import type { Runtime, RuntimeResponse, RuntimeSendOptions } from "./types.ts";
import type { RuntimeCapabilities } from "../loop/types.ts";

/**
 * Mock AI Runtime for testing
 *
 * In single-agent mode, provides a simple echo send().
 * In workflow mode, the loop handles MCP tool orchestration
 * via the mock runner strategy (loop/mock-runner.ts).
 */
export class MockRuntime implements Runtime {
  readonly type = "mock" as const;
  readonly capabilities: RuntimeCapabilities = {
    streaming: false,
    toolLoop: "external",
    stepControl: "step-finish",
    cancellation: "none",
  };

  constructor(private debugLog?: (message: string) => void) {}

  async send(message: string, _options?: RuntimeSendOptions): Promise<RuntimeResponse> {
    const log = this.debugLog || (() => {});
    log(`[mock] Received message (${message.length} chars)`);
    return {
      content: `[mock] Processed: ${message.slice(0, 200)}`,
    };
  }
}

/**
 * Create a mock AI runtime
 */
export function createMockRuntime(debugLog?: (msg: string) => void): Runtime {
  return new MockRuntime(debugLog);
}
