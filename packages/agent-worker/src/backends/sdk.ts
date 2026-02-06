/**
 * Vercel AI SDK backend
 * Uses the AI SDK for direct API access
 */

import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type { Backend, BackendResponse } from './types.ts'
import { createModel, createModelAsync } from '../models.ts'

export interface SdkBackendOptions {
  /** Model identifier (e.g., 'openai/gpt-5.2' or 'anthropic:claude-sonnet-4-5') */
  model: string
  /** Maximum tokens to generate */
  maxTokens?: number
}

export class SdkBackend implements Backend {
  readonly type = 'sdk' as const
  private modelId: string
  private model: LanguageModel | null = null
  private maxTokens: number

  constructor(options: SdkBackendOptions) {
    this.modelId = options.model
    this.maxTokens = options.maxTokens ?? 4096

    // Try sync model creation (works for gateway format)
    try {
      this.model = createModel(this.modelId)
    } catch {
      // Will use async creation on first send
    }
  }

  async send(message: string, options?: { system?: string }): Promise<BackendResponse> {
    // Ensure model is loaded
    if (!this.model) {
      this.model = await createModelAsync(this.modelId)
    }

    const result = await generateText({
      model: this.model,
      system: options?.system,
      prompt: message,
      maxOutputTokens: this.maxTokens,
    })

    return {
      content: result.text,
      usage: {
        input: result.usage.inputTokens ?? 0,
        output: result.usage.outputTokens ?? 0,
        total: result.usage.totalTokens ?? 0,
      },
    }
  }

  async isAvailable(): Promise<boolean> {
    // Check if we can create the model
    try {
      if (!this.model) {
        this.model = await createModelAsync(this.modelId)
      }
      return true
    } catch {
      return false
    }
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'Vercel AI SDK',
      model: this.modelId,
    }
  }
}
