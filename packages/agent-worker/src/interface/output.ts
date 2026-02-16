/**
 * CLI output utilities.
 *
 * Rules:
 * - --json mode: stdout = pure JSON, everything else to stderr
 * - Errors: always to stderr via console.error + process.exit(1)
 * - Exit codes: 0 = success, 1 = failure
 */

/** Output JSON data to stdout. */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
