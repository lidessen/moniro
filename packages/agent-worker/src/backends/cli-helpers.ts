/**
 * Shared helpers for CLI backends
 *
 * Eliminates duplicated error handling and availability check patterns
 * across claude-code, codex, cursor, and opencode backends.
 */

import { execa } from "execa";
import { IdleTimeoutError } from "./idle-timeout.ts";

/**
 * Handle errors from CLI backend execution.
 *
 * Standardizes the error handling pattern shared by all CLI backends:
 * 1. IdleTimeoutError → human-readable timeout message
 * 2. Process exit error → include exit code and stderr
 * 3. Everything else → re-throw
 */
export function handleCliBackendError(error: unknown, backendName: string, timeout: number): never {
  if (error instanceof IdleTimeoutError) {
    throw new Error(`${backendName} timed out after ${timeout}ms of inactivity`);
  }

  if (error && typeof error === "object" && "exitCode" in error) {
    const execError = error as { exitCode?: number; stderr?: string; shortMessage?: string };
    throw new Error(
      `${backendName} failed (exit ${execError.exitCode}): ${execError.stderr || execError.shortMessage}`,
    );
  }

  throw error;
}

/**
 * Check if a CLI command is available by running `command --version`.
 */
export async function checkCliAvailable(
  command: string,
  args: string[] = ["--version"],
  timeout = 5000,
): Promise<boolean> {
  try {
    await execa(command, args, { stdin: "ignore", timeout });
    return true;
  } catch {
    return false;
  }
}
