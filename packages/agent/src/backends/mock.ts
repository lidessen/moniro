/**
 * Mock AI Backend
 *
 * Simple mock that echoes messages for testing.
 * For workflow integration testing with MCP tools, see loop/mock-runner.ts.
 */

import type { Backend, BackendResponse, BackendSendOptions } from "./types.ts";
import type { BackendCapabilities } from "../execution/types.ts";

/**
 * Mock AI Backend for testing
 *
 * In single-agent mode, provides a simple echo send().
 * In workflow mode, the loop handles MCP tool orchestration
 * via the mock runner strategy (loop/mock-runner.ts).
 */
export class MockAIBackend implements Backend {
  readonly type = "mock" as const;
  readonly capabilities: BackendCapabilities = {
    streaming: false,
    toolLoop: "external",
    stepControl: "step-finish",
    cancellation: "none",
  };

  constructor(private debugLog?: (message: string) => void) {}

  async send(message: string, _options?: BackendSendOptions): Promise<BackendResponse> {
    const log = this.debugLog || (() => {});
    log(`[mock] Received message (${message.length} chars)`);
    return {
      content: `[mock] Processed: ${message.slice(0, 200)}`,
    };
  }
}

/**
 * Create a mock AI backend
 */
export function createMockBackend(debugLog?: (msg: string) => void): Backend {
  return new MockAIBackend(debugLog);
}
