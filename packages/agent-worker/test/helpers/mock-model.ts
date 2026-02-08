/**
 * Mock Model Helpers
 *
 * Factory functions for creating MockLanguageModelV3 instances
 * with common response patterns. Reduces boilerplate in tests.
 */

import { MockLanguageModelV3, mockValues } from 'ai/test'

/**
 * Create a mock model that returns a simple text response.
 */
export function textModel(text: string, inputTokens = 10, outputTokens = 5) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: outputTokens, text: undefined, reasoning: undefined }
      },
      warnings: [],
    },
  })
}

/**
 * Create a mock model that returns a tool call followed by text.
 * The tool call response and final text response are provided in sequence.
 */
export function toolCallModel(
  toolName: string,
  input: Record<string, unknown>,
  finalText: string,
) {
  const mockGen = mockValues(
      // Step 1: tool call
      {
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: `call-${Date.now()}`,
            toolName,
            input: JSON.stringify(input),
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
        usage: {
          inputTokens: { total: 20, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 15, text: undefined, reasoning: undefined }
        },
        warnings: [],
      },
      // Step 2: final text
      {
        content: [{ type: 'text' as const, text: finalText }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 30, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: undefined, reasoning: undefined }
        },
        warnings: [],
      },
    )

  return new MockLanguageModelV3({
    doGenerate: async () => mockGen(),
  })
}

/**
 * Create a mock model that returns a sequence of text responses.
 * Useful for multi-turn tests.
 */
export function sequenceModel(responses: string[]) {
  const mockGen = mockValues(
      ...responses.map((text) => ({
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: undefined, reasoning: undefined }
        },
        warnings: [],
      })),
    )

  return new MockLanguageModelV3({
    doGenerate: async () => mockGen(),
  })
}

/**
 * Create a mock model that fails with an error.
 */
export function failingModel(errorMessage: string) {
  return new MockLanguageModelV3({
    doGenerate: () => {
      throw new Error(errorMessage)
    },
  })
}
