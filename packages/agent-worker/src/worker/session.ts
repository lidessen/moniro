/**
 * Worker session — runs a single LLM conversation.
 *
 * The session is the core execution unit: it receives a prompt,
 * an optional backend, and tools, then runs the LLM conversation
 * and returns the result. It does NOT know about scheduling,
 * inbox acking, or lifecycle.
 */
import type { Backend, BackendResponse } from "./backends/types.ts";
import type { SessionResult } from "../shared/types.ts";

export interface SessionConfig {
  /** LLM backend */
  backend: Backend;
  /** System prompt */
  system?: string;
  /** User prompt (built from context) */
  prompt: string;
  /** MCP config for CLI backends */
  mcpConfig?: { mcpServers: Record<string, unknown> };
  /** Additional SDK tools */
  tools?: Record<string, unknown>;
}

/**
 * Run a single worker session.
 *
 * For SDK backend: directly calls generateText with tools.
 * For CLI backends: sends prompt via backend.send(), CLI handles MCP internally.
 */
export async function runSession(config: SessionConfig): Promise<SessionResult> {
  const response: BackendResponse = await config.backend.send(config.prompt, {
    system: config.system,
    tools: config.tools,
    mcpConfig: config.mcpConfig,
  });

  return {
    content: response.content,
    toolCalls: response.toolCalls,
    usage: response.usage,
  };
}
