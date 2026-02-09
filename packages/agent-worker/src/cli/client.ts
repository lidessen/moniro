import { getSessionInfo, isSessionRunning } from "../daemon/server.ts";

interface Response {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface SendOptions {
  target?: string;
  debug?: boolean;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

/** Check if an error is transient and worth retrying */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // fetch throws TypeError for network errors (connection refused, etc.)
    return true;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ECONNREFUSED" || code === "ECONNRESET";
  }
  return false;
}

/**
 * Map legacy { action, payload } to RESTful { method, path, body }.
 */
function resolveRoute(req: {
  action: string;
  payload?: unknown;
}): { method: string; path: string; body?: unknown } {
  const p = req.payload as Record<string, unknown> | undefined;

  switch (req.action) {
    case "ping":
      return { method: "GET", path: "/session" };
    case "send":
      return { method: "POST", path: "/session/send", body: p };
    case "history":
      return { method: "GET", path: "/session/history" };
    case "stats":
      return { method: "GET", path: "/session/stats" };
    case "export":
      return { method: "GET", path: "/session/export" };
    case "clear":
      return { method: "POST", path: "/session/clear" };
    case "shutdown":
      return { method: "POST", path: "/session/shutdown" };
    case "tool_list":
      return { method: "GET", path: "/tools" };
    case "tool_add":
      return { method: "POST", path: "/tools", body: p };
    case "tool_import":
      return { method: "POST", path: "/tools/import", body: p };
    case "tool_mock":
      return { method: "POST", path: "/tools/mock", body: p };
    case "pending":
      return { method: "GET", path: "/approvals" };
    case "approve":
      return { method: "POST", path: `/approvals/${p?.id}/approve` };
    case "deny": {
      const { id, ...rest } = p ?? {};
      return { method: "POST", path: `/approvals/${id}/deny`, body: rest };
    }
    case "feedback_list":
      return { method: "GET", path: "/feedback" };
    case "schedule_get":
      return { method: "GET", path: "/schedule" };
    case "schedule_set":
      return { method: "PUT", path: "/schedule", body: p };
    case "schedule_clear":
      return { method: "DELETE", path: "/schedule" };
    default:
      throw new Error(`Unknown action: ${req.action}`);
  }
}

/**
 * Resolve session target → base URL.
 * Returns null with an error Response if the session is not reachable.
 */
function resolveBaseUrl(
  target: string | undefined,
  debug: boolean,
): { url: string } | { error: Response } {
  if (debug) {
    console.error(`[DEBUG] Looking up session: ${target || "(default)"}`);
  }

  const info = getSessionInfo(target);

  if (!info) {
    if (target) {
      return { error: { success: false, error: `Session not found: ${target}` } };
    }
    return {
      error: {
        success: false,
        error: "No active session. Start one with: agent-worker session start -m <model>",
      },
    };
  }

  if (debug) {
    console.error(`[DEBUG] Found session: ${info.id} (${info.backend})`);
  }

  if (!info.port) {
    return { error: { success: false, error: `Session has no port: ${info.id}` } };
  }

  if (!isSessionRunning(target)) {
    return { error: { success: false, error: `Session not running: ${target || info.id}` } };
  }

  return { url: `http://${info.host || "127.0.0.1"}:${info.port}` };
}

/**
 * Low-level HTTP request with retry logic.
 */
async function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  body: unknown | undefined,
  debug: boolean,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const init: RequestInit = {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      };

      if (debug) {
        console.error(`[DEBUG] ${method} ${baseUrl}${path}`);
        if (body) console.error(`[DEBUG] Body: ${JSON.stringify(body, null, 2)}`);
      }

      const res = await fetch(`${baseUrl}${path}`, init);
      const result = (await res.json()) as Response;

      if (debug) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[DEBUG] ${res.status} after ${elapsed}s`);
      }

      return result;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        if (debug) {
          console.error(`[DEBUG] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return { success: false, error: `Connection failed: ${message}` };
}

/**
 * Send a request to a daemon session via HTTP REST routes.
 * Maps action-based requests to the appropriate RESTful endpoint.
 */
export function sendRequest(
  req: { action: string; payload?: unknown },
  target?: string,
  options?: SendOptions,
): Promise<Response>;
export async function sendRequest(
  req: { action: string; payload?: unknown },
  targetOrOptions?: string | SendOptions,
  options?: SendOptions,
): Promise<Response> {
  // Handle overloaded signatures
  let target: string | undefined;
  let opts: SendOptions = {};

  if (typeof targetOrOptions === "string") {
    target = targetOrOptions;
    opts = options || {};
  } else if (targetOrOptions) {
    opts = targetOrOptions;
    target = opts.target;
  }
  const debug = opts.debug || false;

  const resolved = resolveBaseUrl(target, debug);
  if ("error" in resolved) return resolved.error;

  const route = resolveRoute(req);
  return httpRequest(resolved.url, route.method, route.path, route.body, debug);
}

/**
 * Check if any session is active, or a specific session
 */
export function isSessionActive(target?: string): boolean {
  return isSessionRunning(target);
}
