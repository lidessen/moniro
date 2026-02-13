/**
 * Idle timeout for CLI subprocess execution
 *
 * Unlike a hard timeout (kill after N ms total), an idle timeout only fires
 * when the process produces no stdout/stderr output for the configured duration.
 * This allows long-running agent tasks to continue as long as they're actively
 * producing output (tool calls, analysis, etc.).
 */

import { execa } from "execa";
import type { ResultPromise } from "execa";

/**
 * Default startup timeout (30 seconds).
 * If the process produces zero output within this window, it's killed.
 * This catches unresponsive backends (e.g., nested `claude -p` inside Claude Code).
 */
export const DEFAULT_STARTUP_TIMEOUT = 30_000;

export interface IdleTimeoutOptions {
  /** Command to run */
  command: string;
  /** Command arguments */
  args: string[];
  /** Working directory */
  cwd?: string;
  /** Idle timeout in ms — kill process if no output for this duration */
  timeout: number;
  /**
   * Startup timeout in ms — kill process if zero output within this window.
   * Shorter than idle timeout to fail fast on unresponsive backends.
   * Defaults to DEFAULT_STARTUP_TIMEOUT (30s). Set 0 to disable.
   */
  startupTimeout?: number;
  /** Callback for each stdout chunk (for progress reporting) */
  onStdout?: (chunk: string) => void;
}

export interface IdleTimeoutResult {
  stdout: string;
  stderr: string;
  /** Function to abort the running process */
  abort?: () => void;
}

/**
 * Execute a command with idle timeout.
 *
 * The timeout resets every time the process writes to stdout or stderr.
 * If the process goes silent for longer than `timeout` ms, it's killed.
 */
/** Minimum idle timeout to prevent accidental instant kills */
const MIN_TIMEOUT_MS = 1000;

export async function execWithIdleTimeout(options: IdleTimeoutOptions): Promise<IdleTimeoutResult> {
  const { command, args, cwd, onStdout } = options;
  const timeout = Math.max(options.timeout, MIN_TIMEOUT_MS);
  // Startup timeout: cap at idle timeout so short timeouts (e.g., tests) aren't overridden
  const rawStartup =
    options.startupTimeout !== undefined
      ? options.startupTimeout
      : DEFAULT_STARTUP_TIMEOUT;
  const startupTimeout = rawStartup > 0 ? Math.min(rawStartup, timeout) : 0;

  let idleTimedOut = false;
  let hasReceivedOutput = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stdout = "";
  let stderr = "";
  let isAborted = false;

  // IMPORTANT: stdin must be 'ignore' to prevent CLI agents from hanging
  // See: https://forum.cursor.com/t/node-js-spawn-with-cursor-agent-hangs/133709
  const subprocess: ResultPromise = execa(command, args, {
    cwd,
    stdin: "ignore",
    // No timeout — we manage it via idle detection
    // Use buffer: false so we get streaming data events
    buffer: false,
  });

  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idleTimedOut = true;
      subprocess.kill();
    }, timeout);
  };

  // Collect output and reset timer on each chunk
  subprocess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    hasReceivedOutput = true;
    // Reset timer BEFORE calling onStdout to ensure timeout is always reset
    // even if the callback throws an exception
    resetTimer();
    if (onStdout) {
      try {
        onStdout(text);
      } catch (err) {
        // Log callback errors but don't let them break the stream
        console.error("onStdout callback error:", err);
      }
    }
  });

  subprocess.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    hasReceivedOutput = true;
    resetTimer();
  });

  // Start with startup timeout (shorter) if configured, then switch to idle timeout on first output
  if (startupTimeout > 0) {
    timer = setTimeout(() => {
      if (!hasReceivedOutput) {
        idleTimedOut = true;
        subprocess.kill();
      }
    }, startupTimeout);
  } else {
    resetTimer();
  }

  try {
    await subprocess;
    clearTimeout(timer);
    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
  } catch (error) {
    clearTimeout(timer);

    if (isAborted) {
      throw new Error("Process aborted by user");
    }

    if (idleTimedOut) {
      const effectiveTimeout = hasReceivedOutput ? timeout : startupTimeout;
      throw new IdleTimeoutError(effectiveTimeout, stdout, stderr);
    }

    // Re-throw original error
    throw error;
  }
}

/**
 * Execute a command with idle timeout and return abort controller
 * This version returns both the promise and an abort function for external control
 */
export function execWithIdleTimeoutAbortable(options: IdleTimeoutOptions): {
  promise: Promise<IdleTimeoutResult>;
  abort: () => void;
} {
  const { command, args, cwd, onStdout } = options;
  const timeout = Math.max(options.timeout, MIN_TIMEOUT_MS);
  // Startup timeout: cap at idle timeout so short timeouts (e.g., tests) aren't overridden
  const rawStartup =
    options.startupTimeout !== undefined
      ? options.startupTimeout
      : DEFAULT_STARTUP_TIMEOUT;
  const startupTimeout = rawStartup > 0 ? Math.min(rawStartup, timeout) : 0;

  let idleTimedOut = false;
  let hasReceivedOutput = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stdout = "";
  let stderr = "";
  let isAborted = false;

  const subprocess: ResultPromise = execa(command, args, {
    cwd,
    stdin: "ignore",
    buffer: false,
  });

  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idleTimedOut = true;
      subprocess.kill();
    }, timeout);
  };

  subprocess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    hasReceivedOutput = true;
    // Reset timer BEFORE calling onStdout to ensure timeout is always reset
    // even if the callback throws an exception
    resetTimer();
    if (onStdout) {
      try {
        onStdout(text);
      } catch (err) {
        // Log callback errors but don't let them break the stream
        console.error("onStdout callback error:", err);
      }
    }
  });

  subprocess.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    hasReceivedOutput = true;
    resetTimer();
  });

  // Start with startup timeout (shorter) if configured
  if (startupTimeout > 0) {
    timer = setTimeout(() => {
      if (!hasReceivedOutput) {
        idleTimedOut = true;
        subprocess.kill();
      }
    }, startupTimeout);
  } else {
    resetTimer();
  }

  const abort = () => {
    if (!isAborted) {
      isAborted = true;
      clearTimeout(timer);
      subprocess.kill("SIGTERM");
      setTimeout(() => {
        if (!subprocess.killed) {
          subprocess.kill("SIGKILL");
        }
      }, 1000);
    }
  };

  const promise = (async () => {
    try {
      await subprocess;
      clearTimeout(timer);
      return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
    } catch (error) {
      clearTimeout(timer);

      if (isAborted) {
        throw new Error("Process aborted by user");
      }

      if (idleTimedOut) {
        const effectiveTimeout = hasReceivedOutput ? timeout : startupTimeout;
        throw new IdleTimeoutError(effectiveTimeout, stdout, stderr);
      }

      throw error;
    }
  })();

  return { promise, abort };
}

/**
 * Error thrown when a process is killed due to idle timeout
 */
export class IdleTimeoutError extends Error {
  readonly timeout: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(timeout: number, stdout: string, stderr: string) {
    super(`Process idle timed out after ${timeout}ms of inactivity`);
    this.name = "IdleTimeoutError";
    this.timeout = timeout;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}
