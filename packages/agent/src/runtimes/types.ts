/**
 * Runtime types for different AI execution engines
 */

// Re-export model maps from canonical source
export {
  type RuntimeType,
  RUNTIME_DEFAULT_MODELS,
  SDK_MODEL_ALIASES,
  CURSOR_MODEL_MAP,
  CLAUDE_MODEL_MAP,
  CODEX_MODEL_MAP,
  OPENCODE_MODEL_MAP,
  getModelForRuntime,
  normalizeRuntimeType,
} from "./model-maps.ts";

import type { RuntimeType } from "./model-maps.ts";
import type { RuntimeCapabilities } from "../loop/types.ts";
import type { StreamEvent } from "./stream-json.ts";

/**
 * Default idle timeout for CLI runtimes (10 minutes).
 * Timeout resets on any stdout activity, so this is an inactivity threshold.
 */
export const DEFAULT_IDLE_TIMEOUT = 600_000; // 10 minutes in milliseconds

export interface RuntimeConfig {
  type: RuntimeType;
  /** Model identifier (interpretation depends on backend) */
  model?: string;
  /** Additional CLI flags or SDK options */
  options?: Record<string, unknown>;
}

export interface RuntimeResponse {
  content: string;
  /** Tool calls made during execution (if supported) */
  toolCalls?: Array<{
    name: string;
    arguments: unknown;
    result: unknown;
  }>;
  /** Usage statistics (if available) */
  usage?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Options for Runtime.send().
 */
export interface RuntimeSendOptions {
  /** System prompt */
  system?: string;
  /**
   * Stream event callback — receives parsed execution events in real-time.
   * CLI runtimes fire these from JSON stream parsing.
   * SDK runtimes don't use this (observation happens through AI SDK hooks).
   */
  onEvent?: (event: StreamEvent) => void;
}

export interface Runtime {
  readonly type: RuntimeType;
  /** Runtime capabilities — declares what this runtime can do */
  readonly capabilities: RuntimeCapabilities;
  /** Send a message and get a response */
  send(message: string, options?: RuntimeSendOptions): Promise<RuntimeResponse>;
  /** Check if the runtime is available (CLI installed, API key set, etc.) */
  isAvailable?(): Promise<boolean>;
  /** Get runtime info for display */
  getInfo?(): { name: string; version?: string; model?: string };
  /** Abort any running operations and cleanup resources */
  abort?(): void;
}
