/**
 * Mock backend — scripted responses for testing.
 */
import type { Backend, BackendResponse } from "./types.ts";

export interface MockBackendOptions {
  /** Fixed response content */
  response?: string;
  /** Function to generate response from input */
  handler?: (message: string) => string | BackendResponse;
}

export function createMockBackend(options: MockBackendOptions = {}): Backend {
  return {
    type: "mock",

    async send(message) {
      if (options.handler) {
        const result = options.handler(message);
        if (typeof result === "string") {
          return { content: result };
        }
        return result;
      }
      return { content: options.response ?? `Mock response to: ${message}` };
    },
  };
}
