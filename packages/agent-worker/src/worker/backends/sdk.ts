/**
 * SDK backend — Vercel AI SDK for direct API access.
 *
 * Primary backend for LLM calls. Supports any provider
 * compatible with the Vercel AI SDK (Anthropic, OpenAI, etc.).
 */
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { Backend, BackendResponse } from "./types.ts";

export interface SdkBackendOptions {
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5') */
  model: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
}

export function createSdkBackend(options: SdkBackendOptions): Backend {
  let model: LanguageModel | null = null;
  const maxTokens = options.maxTokens ?? 4096;

  async function ensureModel(): Promise<LanguageModel> {
    if (model) return model;

    // Dynamic import to support various providers
    const { createModelAsync } = await import("./model-resolver.ts");
    model = await createModelAsync(options.model);
    return model;
  }

  return {
    type: "sdk",

    async send(message, sendOptions) {
      const m = await ensureModel();

      const result = await generateText({
        model: m,
        system: sendOptions?.system,
        prompt: message,
        maxOutputTokens: maxTokens,
      });

      return {
        content: result.text,
        usage: {
          input: result.usage.inputTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
          total: result.usage.totalTokens ?? 0,
        },
      };
    },
  };
}
