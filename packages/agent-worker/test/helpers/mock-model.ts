// @ts-nocheck
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
      usage: { inputTokens, outputTokens },
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
  return new MockLanguageModelV3({
    doGenerate: mockValues(
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
        usage: { inputTokens: 20, outputTokens: 15 },
      },
      // Step 2: final text
      {
        content: [{ type: 'text' as const, text: finalText }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: { inputTokens: 30, outputTokens: 10 },
      },
    ),
  })
}

/**
 * Create a mock model that returns a sequence of text responses.
 * Useful for multi-turn tests.
 */
export function sequenceModel(responses: string[]) {
  return new MockLanguageModelV3({
    doGenerate: mockValues(
      ...responses.map((text) => ({
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
    ),
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
