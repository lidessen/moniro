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

export interface IdleTimeoutOptions {
  /** Command to run */
  command: string;
  /** Command arguments */
  args: string[];
  /** Working directory */
  cwd?: string;
  /** Idle timeout in ms — kill process if no output for this duration */
  timeout: number;
  /** Callback for each stdout chunk (for progress reporting) */
  onStdout?: (chunk: string) => void;
}

export interface IdleTimeoutResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a command with idle timeout.
 *
 * The timeout resets every time the process writes to stdout or stderr.
 * If the process goes silent for longer than `timeout` ms, it's killed.
 */
export async function execWithIdleTimeout(options: IdleTimeoutOptions): Promise<IdleTimeoutResult> {
  const { command, args, cwd, timeout, onStdout } = options;

  let idleTimedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  let stdout = "";
  let stderr = "";

  // IMPORTANT: stdin must be 'ignore' to prevent CLI agents from hanging
  // See: https://forum.cursor.com/t/node-js-spawn-with-cursor-agent-hangs-and-exits-with-code-143-after-timeout/133709
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
    if (onStdout) onStdout(text);
    resetTimer();
  });

  subprocess.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    resetTimer();
  });

  // Start initial timer
  resetTimer();

  try {
    await subprocess;
    clearTimeout(timer);
    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
  } catch (error) {
    clearTimeout(timer);

    if (idleTimedOut) {
      throw new IdleTimeoutError(timeout, stdout, stderr);
    }

    // Re-throw original error
    throw error;
  }
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
