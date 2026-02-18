/**
 * Model resolver — dynamic provider/model loading for the SDK backend.
 *
 * Supports formats:
 *   "provider/model"  — e.g., "anthropic/claude-sonnet-4-5"
 *   "provider:model"  — e.g., "deepseek:deepseek-chat"
 *   "provider"        — uses default model for provider
 */
import type { LanguageModel } from "ai";

/** Provider → default model mapping */
const DEFAULTS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4.1",
  deepseek: "deepseek-chat",
  google: "gemini-2.5-pro",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  xai: "grok-3",
};

/** Provider options (apiKey, baseURL) from workflow YAML */
export interface ProviderOptions {
  apiKey?: string;
  baseURL?: string;
}

/** Parse model string into provider + model */
function parseModelId(modelId: string): { provider: string; model: string } {
  // provider/model format (gateway style)
  const slashIdx = modelId.indexOf("/");
  if (slashIdx > 0) {
    return {
      provider: modelId.slice(0, slashIdx),
      model: modelId.slice(slashIdx + 1),
    };
  }

  // provider:model format (direct style)
  const colonIdx = modelId.indexOf(":");
  if (colonIdx > 0) {
    return {
      provider: modelId.slice(0, colonIdx),
      model: modelId.slice(colonIdx + 1),
    };
  }

  // Just provider name → use default model
  if (DEFAULTS[modelId]) {
    return { provider: modelId, model: DEFAULTS[modelId] };
  }

  // Unknown — try anthropic as fallback
  return { provider: "anthropic", model: modelId };
}

/** Strip undefined values so provider constructors don't choke */
function cleanOptions(opts: ProviderOptions): Record<string, string> {
  const clean: Record<string, string> = {};
  if (opts.apiKey) clean.apiKey = opts.apiKey;
  if (opts.baseURL) clean.baseURL = opts.baseURL;
  return clean;
}

/**
 * Create a language model from a model ID string.
 * Dynamically imports the appropriate provider SDK.
 */
export async function createModelAsync(
  modelId: string,
  providerOptions?: ProviderOptions,
): Promise<LanguageModel> {
  const { provider, model } = parseModelId(modelId);
  const opts = providerOptions ? cleanOptions(providerOptions) : {};

  switch (provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic(opts)(model) as LanguageModel;
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI(opts)(model) as LanguageModel;
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek(opts)(model) as LanguageModel;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI(opts)(model) as unknown as LanguageModel;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq(opts)(model) as unknown as LanguageModel;
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral(opts)(model) as unknown as LanguageModel;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai(opts)(model) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, deepseek, google, groq, mistral, xai`);
  }
}
