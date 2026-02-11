/**
 * CLI client — HTTP client for daemon REST API.
 *
 * Talks to the 9-endpoint daemon:
 *   GET  /health, POST /shutdown
 *   GET/POST /agents, GET/DELETE /agents/:name
 *   POST /run (SSE), POST /serve
 *   ALL  /mcp
 */

import { isDaemonRunning } from "../daemon/index.ts";

// ── Types ──────────────────────────────────────────────────────────

interface ApiResponse {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

// ── Retry logic ────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ECONNREFUSED" || code === "ECONNRESET";
  }
  return false;
}

// ── Daemon URL resolution ──────────────────────────────────────────

function getDaemonUrl(): string | null {
  const daemon = isDaemonRunning();
  if (!daemon) return null;
  return `http://${daemon.host}:${daemon.port}`;
}

function requireDaemon(): string {
  const url = getDaemonUrl();
  if (!url) {
    throw new Error("No daemon running. Start one with: agent-worker daemon");
  }
  return url;
}

// ── Low-level HTTP ─────────────────────────────────────────────────

async function request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const baseUrl = requireDaemon();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const init: RequestInit = {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      };

      const res = await fetch(`${baseUrl}${path}`, init);
      return (await res.json()) as ApiResponse;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return { success: false, error: `Connection failed: ${message}` };
}

// ── Public API ─────────────────────────────────────────────────────

/** GET /health */
export function health(): Promise<ApiResponse> {
  return request("GET", "/health");
}

/** POST /shutdown */
export function shutdown(): Promise<ApiResponse> {
  return request("POST", "/shutdown");
}

/** GET /agents */
export function listAgents(): Promise<ApiResponse> {
  return request("GET", "/agents");
}

/** POST /agents */
export function createAgent(body: {
  name: string;
  model: string;
  system: string;
  backend?: string;
  workflow?: string;
  tag?: string;
}): Promise<ApiResponse> {
  return request("POST", "/agents", body);
}

/** GET /agents/:name */
export function getAgent(name: string): Promise<ApiResponse> {
  return request("GET", `/agents/${encodeURIComponent(name)}`);
}

/** DELETE /agents/:name */
export function deleteAgent(name: string): Promise<ApiResponse> {
  return request("DELETE", `/agents/${encodeURIComponent(name)}`);
}

/** POST /serve (sync JSON response) */
export function serve(body: { agent: string; message: string }): Promise<ApiResponse> {
  return request("POST", "/serve", body);
}

/**
 * POST /run (SSE stream).
 * Calls onChunk for each chunk, returns final response.
 */
export async function run(
  body: { agent: string; message: string },
  onChunk?: (data: { agent: string; text: string }) => void,
): Promise<ApiResponse> {
  let baseUrl: string;
  try {
    baseUrl = requireDaemon();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }

  try {
    const res = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      return (await res.json()) as ApiResponse;
    }

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: ApiResponse = { success: true };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7);
        } else if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (currentEvent === "chunk" && onChunk) {
              onChunk(parsed);
            } else if (currentEvent === "done") {
              finalResponse = parsed;
            } else if (currentEvent === "error") {
              return { success: false, error: parsed.error };
            }
          } catch {
            // Ignore malformed SSE data
          }
        }
      }
    }

    return finalResponse;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Connection failed: ${msg}` };
  }
}

// ── Workflow API ──────────────────────────────────────────────────

/** POST /workflows — start a workflow via daemon */
export function startWorkflow(body: {
  workflow: unknown;
  tag?: string;
  feedback?: boolean;
  pollInterval?: number;
}): Promise<ApiResponse> {
  return request("POST", "/workflows", body);
}

/** GET /workflows — list running workflows */
export function listWorkflows(): Promise<ApiResponse> {
  return request("GET", "/workflows");
}

/** DELETE /workflows/:name/:tag — stop a workflow */
export function stopWorkflow(name: string, tag: string = "main"): Promise<ApiResponse> {
  return request("DELETE", `/workflows/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
}

/** Check if daemon is running */
export function isDaemonActive(): boolean {
  return getDaemonUrl() !== null;
}
