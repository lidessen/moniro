import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/**
 * Parse model identifier and return the appropriate provider model
 *
 * Format: provider:model-name
 * Examples:
 *   - anthropic:claude-3-5-sonnet-20241022
 *   - openai:gpt-4o
 */
export function createModel(modelId: string): LanguageModel {
  const [provider, modelName] = modelId.split(':')

  if (!provider || !modelName) {
    throw new Error(
      `Invalid model identifier: ${modelId}. Expected format: provider:model-name`
    )
  }

  switch (provider) {
    case 'anthropic':
      return anthropic(modelName)
    case 'openai':
      return openai(modelName)
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai`)
  }
}
