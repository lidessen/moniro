/**
 * Agent YAML Parser — Load agent definitions from .agents/*.yaml files.
 *
 * Handles:
 *   - Single file: parseAgentFile("path/to/alice.yaml")
 *   - Directory:   discoverAgents("path/to/project") → scans .agents/*.yaml
 *   - Validation:  Zod schema + semantic checks (system XOR system_file)
 *   - Resolution:  system_file → reads content into system (relative to YAML dir)
 *
 * The name field is optional in YAML — defaults to filename (without .yaml).
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { AgentDefinitionSchema, type AgentDefinition } from "./definition.ts";

// ── Constants ─────────────────────────────────────────────────────

/** Default directory for agent definitions (relative to project root) */
export const AGENTS_DIR = ".agents";

// ── Parse Single File ─────────────────────────────────────────────

/**
 * Parse an agent definition from a YAML file.
 *
 * Validates the schema, resolves system_file to inline content,
 * and infers name from filename if not specified.
 *
 * @throws Error if file doesn't exist, YAML is malformed, or validation fails.
 */
export function parseAgentFile(filePath: string): AgentDefinition {
  if (!existsSync(filePath)) {
    throw new Error(`Agent file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const data = parseYaml(raw);

  if (!data || typeof data !== "object") {
    throw new Error(`Invalid YAML in ${filePath}: expected an object`);
  }

  // Infer name from filename if not specified
  const obj = data as Record<string, unknown>;
  if (!obj.name) {
    const filename = basename(filePath);
    obj.name = filename.replace(/\.ya?ml$/i, "");
  }

  // Validate with Zod
  const result = AgentDefinitionSchema.safeParse(obj);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid agent definition in ${filePath}:\n${issues}`);
  }

  const def = result.data as AgentDefinition;

  // Resolve system_file → system (read file content)
  if (def.prompt.system_file) {
    const promptPath = join(dirname(filePath), def.prompt.system_file);
    if (!existsSync(promptPath)) {
      throw new Error(
        `system_file not found: ${def.prompt.system_file} (resolved: ${promptPath})`,
      );
    }
    const content = readFileSync(promptPath, "utf-8");
    // Replace system_file with resolved system content
    return {
      ...def,
      prompt: { system: content },
    };
  }

  return def;
}

// ── Parse from Raw Object ─────────────────────────────────────────

/**
 * Parse an agent definition from a plain object (e.g., from CLI input).
 * No system_file resolution — expects inline system prompt.
 *
 * @throws Error if validation fails.
 */
export function parseAgentObject(data: Record<string, unknown>): AgentDefinition {
  const result = AgentDefinitionSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid agent definition:\n${issues}`);
  }
  return result.data as AgentDefinition;
}

// ── Discover Agents in Directory ──────────────────────────────────

/**
 * Discover all agent YAML files in a project's .agents/ directory.
 * Returns parsed and validated definitions.
 *
 * Non-fatal: logs warnings for invalid files, skips them.
 *
 * @param projectDir - Project root directory
 * @param log - Optional warning logger (default: console.warn)
 * @returns Array of valid agent definitions
 */
export function discoverAgents(
  projectDir: string,
  log?: (msg: string) => void,
): AgentDefinition[] {
  const agentsDir = join(projectDir, AGENTS_DIR);
  if (!existsSync(agentsDir)) return [];

  const warn = log ?? console.warn;
  const agents: AgentDefinition[] = [];

  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;

    const filePath = join(agentsDir, entry);
    try {
      agents.push(parseAgentFile(filePath));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Skipping ${entry}: ${msg}`);
    }
  }

  return agents;
}

// ── Serialize to YAML ─────────────────────────────────────────────

/**
 * Serialize an agent definition to YAML string.
 * Used by CLI `agent create` to write .agents/<name>.yaml.
 */
export function serializeAgent(def: AgentDefinition): string {
  // Build a clean object (omit undefined fields)
  const obj: Record<string, unknown> = {
    name: def.name,
    model: def.model,
  };

  if (def.backend) obj.backend = def.backend;
  if (def.provider) obj.provider = def.provider;

  obj.prompt = def.prompt;

  if (def.soul) obj.soul = def.soul;
  if (def.context) obj.context = def.context;
  if (def.max_tokens) obj.max_tokens = def.max_tokens;
  if (def.max_steps) obj.max_steps = def.max_steps;
  if (def.schedule) obj.schedule = def.schedule;

  return stringifyYaml(obj, { lineWidth: 120 });
}
