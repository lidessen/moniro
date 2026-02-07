/**
 * CLI Output Utilities
 *
 * Two audiences:
 * - AI agents: need machine-parseable output (--json), no colors, consistent structure
 * - Humans: need rich formatted output (colors, progress, visual hierarchy)
 *
 * Rules:
 * - --json mode: stdout = pure JSON data only, everything else to stderr
 * - Colors: only when stdout is a TTY (auto-detected, overridable)
 * - Errors: always to stderr, never mixed with data output
 * - Exit codes: 0 = success, 1 = failure (authoritative for agents)
 */

// ==================== TTY / Color Detection ====================

/** Whether stdout is a TTY (interactive terminal) */
export const isTTY = !!process.stdout.isTTY;

/** Whether ANSI colors should be used (respects NO_COLOR env) */
export const useColor = isTTY && !process.env.NO_COLOR;

// ==================== ANSI Helpers ====================

/** ANSI color codes — returns empty strings when colors are disabled */
export const c = {
  reset: useColor ? "\x1b[0m" : "",
  dim: useColor ? "\x1b[2m" : "",
  bold: useColor ? "\x1b[1m" : "",
  red: useColor ? "\x1b[31m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  blue: useColor ? "\x1b[34m" : "",
  magenta: useColor ? "\x1b[35m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  gray: useColor ? "\x1b[90m" : "",
  brightRed: useColor ? "\x1b[91m" : "",
};

// ==================== Output Helpers ====================

/**
 * Output JSON data to stdout.
 * Use this instead of raw console.log(JSON.stringify(...)) for consistency.
 */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Output an error and exit.
 * Error goes to stderr, exit code 1.
 */
export function exitError(message: string): never {
  console.error(`${c.red}Error:${c.reset} ${message}`);
  process.exit(1);
}

/**
 * Handle a command that returns data.
 * - json mode: output data as JSON
 * - text mode: call the formatter function
 */
export function outputResult(
  data: unknown,
  json: boolean,
  formatText: (data: unknown) => void,
): void {
  if (json) {
    outputJson(data);
  } else {
    formatText(data);
  }
}
