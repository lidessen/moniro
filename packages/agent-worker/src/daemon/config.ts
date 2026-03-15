/**
 * Daemon Config — Parse ~/.agent-worker/config.yml
 *
 * The daemon config IS a workflow YAML file. It defines agents (identity +
 * model + prompt) and channels (external platforms) in the standard workflow
 * format.
 *
 * Example config.yml:
 *   agents:
 *     alice:
 *       model: anthropic/claude-sonnet-4-5
 *       system_prompt: "You are a helpful assistant."
 *       wakeup: "0 9 * * *"
 *   channels:
 *     - adapter: telegram
 *       bot_token: ${TELEGRAM_BOT_TOKEN}
 *       chat_id: ${TELEGRAM_CHAT_ID}
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedWorkflow } from "@moniro/workspace";

/**
 * Load daemon config from ~/.agent-worker/config.yml.
 * Returns null if file doesn't exist.
 * Throws on YAML syntax errors or invalid config — don't silently swallow.
 *
 * Uses the standard workflow parser — same format as workflow YAML files.
 */
export async function loadDaemonConfig(configDir: string): Promise<ParsedWorkflow | null> {
  const configPath = join(configDir, "config.yml");
  if (!existsSync(configPath)) return null;

  const { parseWorkflowFile } = await import("@moniro/workspace");
  return await parseWorkflowFile(configPath, {
    workflow: "global",
  });
}
