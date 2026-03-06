/**
 * Daemon Config — Parse ~/.agent-worker/config.yml
 *
 * The daemon config defines workspace-level settings shared by all
 * standalone agents: bridges, context options, etc.
 *
 * Agent identity (name, model, prompt, soul) is NOT here — that's in
 * .agents/*.yaml (AgentDefinition).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { BridgeConfig } from "@moniro/workspace";

// ── Types ──────────────────────────────────────────────────────────

/** Daemon workspace configuration from config.yml */
export interface DaemonConfig {
  /** Channel bridge configuration */
  bridges?: BridgeConfig[];
}

// ── Parsing ─────────────────────────────────────────────────────────

/**
 * Load daemon config from ~/.agent-worker/config.yml.
 * Returns empty config if file doesn't exist or is invalid.
 */
export function loadDaemonConfig(configDir: string): DaemonConfig {
  const configPath = join(configDir, "config.yml");
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, "utf-8");
    const data = parseYaml(raw);
    if (!data || typeof data !== "object") return {};
    return data as DaemonConfig;
  } catch {
    return {};
  }
}
