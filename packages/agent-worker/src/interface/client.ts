/**
 * HTTP client — talks to the daemon REST API.
 *
 * Thin wrapper: method → fetch → parse JSON → return.
 * Retry logic for transient connection errors.
 */
import { findDaemon, type DaemonInfo } from "./discovery.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface ApiResponse {
  [key: string]: unknown;
  error?: string;
  ok?: boolean;
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

// ── Connection ─────────────────────────────────────────────────────

function requireDaemon(): DaemonInfo {
  const info = findDaemon();
  if (!info) {
    throw new Error("No daemon running. Start one with: agent-worker daemon");
  }
  return info;
}

function baseUrl(info: DaemonInfo): string {
  return `http://${info.host}:${info.port}`;
}

// ── Low-level HTTP ─────────────────────────────────────────────────

async function request(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const daemon = requireDaemon();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";

      const res = await fetch(`${baseUrl(daemon)}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });

      return (await res.json()) as ApiResponse;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
      } else {
        break;
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  return { error: `Connection failed: ${msg}` };
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
  system?: string;
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

/** POST /send — inject message into channel */
export function send(body: {
  agent: string;
  message: string;
  sender?: string;
  workflow?: string;
  tag?: string;
}): Promise<ApiResponse> {
  return request("POST", "/send", body);
}

/** GET /peek — read channel messages */
export function peek(workflow?: string, tag?: string, limit?: number): Promise<ApiResponse> {
  const params = new URLSearchParams();
  if (workflow) params.set("workflow", workflow);
  if (tag) params.set("tag", tag);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return request("GET", `/peek${qs ? `?${qs}` : ""}`);
}

/** POST /workflows — start a workflow */
export function startWorkflow(body: {
  workflow: unknown;
  tag?: string;
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

/** GET /workflows/:name/:tag/status — check workflow completion */
export function workflowStatus(name: string, tag: string = "main"): Promise<ApiResponse> {
  return request("GET", `/workflows/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/status`);
}

/** Check if daemon is running */
export function isDaemonActive(): boolean {
  return findDaemon() !== null;
}
