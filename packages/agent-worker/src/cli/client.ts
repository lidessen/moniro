import { getSessionInfo, isSessionRunning } from "../daemon/server.ts";

interface Request {
  action: string;
  payload?: unknown;
}

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
 * Send a request to a daemon session via HTTP.
 * @param req - The request to send
 * @param target - Session ID or name (optional, uses default if not specified)
 * @param options - Additional options (debug mode, etc.)
 */
export function sendRequest(
  req: Request,
  target?: string,
  options?: SendOptions,
): Promise<Response>;
export async function sendRequest(
  req: Request,
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

  if (debug) {
    console.error(`[DEBUG] Looking up session: ${target || "(default)"}`);
  }

  const info = getSessionInfo(target);

  if (!info) {
    if (target) {
      return { success: false, error: `Session not found: ${target}` };
    }
    return {
      success: false,
      error: "No active session. Start one with: agent-worker session start -m <model>",
    };
  }

  if (debug) {
    console.error(`[DEBUG] Found session: ${info.id} (${info.backend})`);
  }

  if (!info.port) {
    return { success: false, error: `Session has no port: ${info.id}` };
  }

  if (!isSessionRunning(target)) {
    return { success: false, error: `Session not running: ${target || info.id}` };
  }

  const url = `http://${info.host || "127.0.0.1"}:${info.port}`;

  if (debug) {
    console.error(`[DEBUG] Sending to ${url}`);
    console.error(`[DEBUG] ${JSON.stringify(req, null, 2)}`);
  }

  // Retry loop with exponential backoff for transient connection errors
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(60_000),
      });
      const result = (await res.json()) as Response;
      if (debug) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[DEBUG] Received response after ${elapsed}s`);
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

  // All retries exhausted
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  return { success: false, error: `Connection failed: ${message}` };
}

/**
 * Check if any session is active, or a specific session
 */
export function isSessionActive(target?: string): boolean {
  return isSessionRunning(target);
}
