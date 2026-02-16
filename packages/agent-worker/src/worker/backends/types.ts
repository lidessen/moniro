/**
 * Backend interface — LLM communication adapter.
 *
 * A backend only knows how to send a message and get a response.
 * It does not know about scheduling, context, or lifecycle.
 */
export type BackendType = "default" | "claude" | "codex" | "cursor" | "mock";

export interface BackendResponse {
  content: string;
  toolCalls?: Array<{ name: string; arguments: unknown; result: unknown }>;
  usage?: { input: number; output: number; total: number };
}

export interface Backend {
  readonly type: BackendType;
  /** Send a message and get a response */
  send(
    message: string,
    options?: {
      system?: string;
      tools?: Record<string, unknown>;
      mcpConfig?: { mcpServers: Record<string, unknown> };
    },
  ): Promise<BackendResponse>;
  /** Check if the backend is available */
  isAvailable?(): Promise<boolean>;
  /** Abort any running operations */
  abort?(): void;
}
