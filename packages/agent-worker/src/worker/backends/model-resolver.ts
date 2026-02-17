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

/**
 * Create a language model from a model ID string.
 * Dynamically imports the appropriate provider SDK.
 */
export async function createModelAsync(modelId: string): Promise<LanguageModel> {
  const { provider, model } = parseModelId(modelId);

  switch (provider) {
    case "anthropic": {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return anthropic(model) as LanguageModel;
    }
    case "openai": {
      const { openai } = await import("@ai-sdk/openai");
      return openai(model) as LanguageModel;
    }
    case "deepseek": {
      const { deepseek } = await import("@ai-sdk/deepseek");
      return deepseek(model) as LanguageModel;
    }
    case "google": {
      const { google } = await import("@ai-sdk/google");
      return google(model) as unknown as LanguageModel;
    }
    case "groq": {
      const { groq } = await import("@ai-sdk/groq");
      return groq(model) as unknown as LanguageModel;
    }
    case "mistral": {
      const { mistral } = await import("@ai-sdk/mistral");
      return mistral(model) as unknown as LanguageModel;
    }
    case "xai": {
      const { xai } = await import("@ai-sdk/xai");
      return xai(model) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, deepseek, google, groq, mistral, xai`);
  }
}
