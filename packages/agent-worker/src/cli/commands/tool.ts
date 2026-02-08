import type { Command } from "commander";

/**
 * Tool commands have been simplified and moved:
 * - `tool add` and `tool import` → Use `--tool` parameter with `new` command
 * - `tool mock` → Moved to `mock tool` (top-level command)
 * - `tool feedback` → Moved to `feedback` (top-level command)
 * - `tool list` → Removed (no replacement)
 *
 * This function is kept for backward compatibility but does nothing.
 * It will be removed in a future version.
 */
export function registerToolCommands(_program: Command) {
  // No-op: All tool commands have been deprecated or moved
}
