import { createConnection } from "node:net";
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

/** Attempt a single socket request. Rejects on connection errors. */
function attemptRequest(
  socketPath: string,
  req: Request,
  debug: boolean,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    const startTime = Date.now();

    socket.on("connect", () => {
      if (debug) {
        console.error(`[DEBUG] Connected. Sending request:`);
        console.error(`[DEBUG] ${JSON.stringify(req, null, 2)}`);
      }
      socket.write(JSON.stringify(req) + "\n");
    });

    socket.on("data", (data) => {
      if (debug) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(
          `[DEBUG] Received data after ${elapsed}s: ${data.toString().substring(0, 100)}...`,
        );
      }

      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res: Response = JSON.parse(line);
          if (debug) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.error(`[DEBUG] Received response after ${elapsed}s`);
          }
          socket.end();
          resolve(res);
        } catch (error) {
          if (debug) {
            console.error(`[DEBUG] Parse error:`, error);
          }
          socket.end();
          reject(error);
        }
      }
    });

    socket.on("error", (error) => {
      if (debug) {
        console.error(`[DEBUG] Socket error:`, error);
      }
      reject(error);
    });

    socket.on("timeout", () => {
      if (debug) {
        console.error(`[DEBUG] Socket timeout after 60s`);
      }
      socket.end();
      reject(new Error("Connection timeout"));
    });

    socket.setTimeout(60000); // 60 second timeout for API calls

    if (debug) {
      console.error(`[DEBUG] Waiting for response (60s timeout)...`);
    }
  });
}

/** Check if an error is transient and worth retrying (connection refused, reset, etc.) */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOENT";
  }
  return false;
}

/**
 * Send a request to a specific session
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
    console.error(`[DEBUG] Socket path: ${info.socketPath}`);
  }

  if (!isSessionRunning(target)) {
    return { success: false, error: `Session not running: ${target || info.id}` };
  }

  if (debug) {
    console.error(`[DEBUG] Connecting to socket...`);
  }

  // Retry loop with exponential backoff for transient connection errors
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await attemptRequest(info.socketPath, req, debug);
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
