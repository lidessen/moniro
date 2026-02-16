/**
 * CLI Output Utilities
 *
 * Rules:
 * - --json mode: stdout = pure JSON data only, everything else to stderr
 * - Errors: always to stderr via console.error + process.exit(1)
 * - Exit codes: 0 = success, 1 = failure (authoritative for agent callers)
 */

/**
 * Output JSON data to stdout.
 * Use this instead of raw console.log(JSON.stringify(...)) for consistency.
 */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
