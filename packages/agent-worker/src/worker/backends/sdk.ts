/**
 * SDK backend — Vercel AI SDK for direct API access.
 *
 * Primary backend for LLM calls. Supports any provider
 * compatible with the Vercel AI SDK (Anthropic, OpenAI, etc.).
 */
import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { Backend } from "./types.ts";

export interface SdkBackendOptions {
  /** Model identifier (e.g., 'anthropic/claude-sonnet-4-5') */
  model: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Provider options (apiKey, baseURL) from workflow YAML */
  providerOptions?: { apiKey?: string; baseURL?: string };
}

export function createSdkBackend(options: SdkBackendOptions): Backend {
  let model: LanguageModel | null = null;
  const maxTokens = options.maxTokens ?? 4096;

  async function ensureModel(): Promise<LanguageModel> {
    if (model) return model;

    // Dynamic import to support various providers
    const { createModelAsync } = await import("./model-resolver.ts");
    model = await createModelAsync(options.model, options.providerOptions);
    return model;
  }

  return {
    type: "sdk",

    async send(message, sendOptions) {
      const m = await ensureModel();

      const toolDefs = sendOptions?.tools as Record<string, any> | undefined;

      const result = await generateText({
        model: m,
        system: sendOptions?.system,
        prompt: message,
        maxOutputTokens: maxTokens,
        tools: toolDefs,
        stopWhen: toolDefs ? stepCountIs(10) : undefined,
      });

      // Collect tool calls from all steps
      const toolCalls = result.steps
        ?.flatMap((step) =>
          (step.toolCalls ?? []).map((tc) => ({
            name: tc.toolName,
            arguments: tc.input,
            result: (step.toolResults ?? []).find((r) => r.toolCallId === tc.toolCallId)?.output,
          })),
        )
        .filter((tc) => tc.name);

      return {
        content: result.text,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        usage: {
          input: result.usage.inputTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
          total: result.usage.totalTokens ?? 0,
        },
      };
    },
  };
}
