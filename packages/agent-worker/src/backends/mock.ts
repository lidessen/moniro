/**
 * Mock AI Backend
 *
 * Simple mock that echoes messages for testing.
 * For workflow integration testing with MCP tools, see controller/mock-runner.ts.
 */

import type { Backend, BackendResponse } from './types.ts'

/**
 * Mock AI Backend for testing
 *
 * In single-agent mode, provides a simple echo send().
 * In workflow mode, the controller handles MCP tool orchestration
 * via the mock runner strategy (controller/mock-runner.ts).
 */
export class MockAIBackend implements Backend {
  readonly type = 'mock' as const

  constructor(private debugLog?: (message: string) => void) {}

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const log = this.debugLog || (() => {})
    log(`[mock] Received message (${message.length} chars)`)
    return {
      content: `[mock] Processed: ${message.slice(0, 200)}`,
    }
  }
}

/**
 * Create a mock AI backend
 */
export function createMockBackend(debugLog?: (msg: string) => void): Backend {
  return new MockAIBackend(debugLog)
}
