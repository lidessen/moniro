/**
 * Workflow file parser
 */

import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseArgs } from "node:util";
import type {
  WorkflowFile,
  ParsedWorkflow,
  ResolvedWorkflowAgent,
  ResolvedContext,
  ValidationResult,
  ValidationError,
  WorkflowAgentDef,
  ParamDefinition,
} from "./types.ts";
import type { ScheduleConfig } from "../daemon/registry.ts";
import { CONTEXT_DEFAULTS } from "./context/types.ts";
import { resolveContextDir } from "./context/file-provider.ts";
import { resolveSource, isRemoteSource } from "./source.ts";

/**
 * Parse options
 */
export interface ParseOptions {
  /** Workflow name (default: 'global') */
  workflow?: string;
  /** Workflow tag (default: 'main') */
  tag?: string;
}

/**
 * Parse a workflow file (local or remote).
 *
 * Supports:
 *   Local:  review.yml, ./path/to/review.yml
 *   Remote: github:owner/repo@ref/path/file.yml
 *           github:owner/repo#name[@ref]
 */
export async function parseWorkflowFile(
  filePath: string,
  options?: ParseOptions,
): Promise<ParsedWorkflow> {
  const workflow = options?.workflow ?? "global";
  const tag = options?.tag ?? "main";

  // Resolve source (local file or remote GitHub reference)
  const source = await resolveSource(filePath);

  // For context resolution: remote workflows use CWD, local use the file's directory
  const contextBaseDir = isRemoteSource(filePath) ? process.cwd() : dirname(resolve(filePath));

  let raw: WorkflowFile;
  try {
    raw = parseYaml(source.content) as WorkflowFile;
  } catch (error) {
    throw new Error(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate basic structure
  const validation = validateWorkflow(raw);
  if (!validation.valid) {
    const messages = validation.errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    throw new Error(`Invalid workflow file:\n${messages}`);
  }

  // Extract name from YAML or infer from source path
  const name = raw.name || source.inferredName;

  // Resolve agents (using source's file reader for system_prompt resolution)
  const agents: Record<string, ResolvedWorkflowAgent> = {};
  for (const [agentName, agentDef] of Object.entries(raw.agents)) {
    agents[agentName] = await resolveAgent(agentDef, source.readRelativeFile);
  }

  // Resolve context configuration
  const context = resolveContext(raw.context, contextBaseDir, name, workflow, tag);

  return {
    name,
    filePath: source.displayPath,
    sourceDir: source.sourceDir,
    agents,
    context,
    params: raw.params,
    setup: raw.setup || [],
    kickoff: raw.kickoff,
  };
}

/**
 * Resolve context configuration
 *
 * - undefined (not set): default file provider enabled
 * - null: default file provider enabled (YAML `context:` syntax)
 * - false: explicitly disabled
 * - { provider: 'file', config?: { dir | bind } }: file provider (ephemeral or persistent)
 * - { provider: 'memory' }: memory provider (for testing)
 */
function resolveContext(
  config: WorkflowFile["context"] | null,
  workflowDir: string,
  workflowName: string,
  workflow: string,
  tag: string,
): ResolvedContext | undefined {
  const resolve = (template: string) =>
    resolveContextDir(template, {
      workflowName,
      workflow,
      tag,
      baseDir: workflowDir,
    });

  // false = explicitly disabled
  if (config === false) {
    return undefined;
  }

  // undefined or null = default file provider enabled
  if (config === undefined || config === null) {
    return { provider: "file", dir: resolve(CONTEXT_DEFAULTS.dir) };
  }

  // Memory provider
  if (config.provider === "memory") {
    return {
      provider: "memory",
      documentOwner: config.documentOwner,
    };
  }

  // File provider — check for bind (persistent) vs dir (ephemeral)
  const bindPath = config.config?.bind;
  if (bindPath) {
    return {
      provider: "file",
      dir: resolve(bindPath),
      persistent: true,
      documentOwner: config.documentOwner,
    };
  }

  const dirTemplate = config.config?.dir || CONTEXT_DEFAULTS.dir;
  const dir = resolve(dirTemplate);

  return {
    provider: "file",
    dir,
    documentOwner: config.documentOwner,
  };
}

/**
 * Resolve agent definition (load system prompt from file if needed).
 *
 * Uses a `readRelativeFile` function to abstract local vs remote file access.
 * Also transforms `wakeup` and `wakeup_prompt` fields into a `ScheduleConfig`
 * object, which is the format expected by the daemon and loop layers
 * for setting up periodic wakeup timers.
 */
async function resolveAgent(
  agent: WorkflowAgentDef,
  readRelativeFile: (path: string) => Promise<string | null>,
): Promise<ResolvedWorkflowAgent> {
  let resolvedSystemPrompt = agent.system_prompt;

  // Check if system_prompt is a file path
  if (resolvedSystemPrompt?.endsWith(".txt") || resolvedSystemPrompt?.endsWith(".md")) {
    const content = await readRelativeFile(resolvedSystemPrompt);
    if (content !== null) {
      resolvedSystemPrompt = content;
    }
    // If file doesn't exist, use as-is (might be intentional literal)
  }

  // Transform wakeup/wakeup_prompt into ScheduleConfig
  let schedule: ScheduleConfig | undefined;
  if (agent.wakeup !== undefined) {
    schedule = { wakeup: agent.wakeup };
    if (agent.wakeup_prompt) {
      schedule.prompt = agent.wakeup_prompt;
    }
  }

  return {
    ...agent,
    resolvedSystemPrompt,
    schedule,
  };
}

/**
 * Validate workflow structure
 */
export function validateWorkflow(workflow: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!workflow || typeof workflow !== "object") {
    errors.push({ path: "", message: "Workflow must be an object" });
    return { valid: false, errors };
  }

  const w = workflow as Record<string, unknown>;

  // Validate agents (required)
  if (!w.agents || typeof w.agents !== "object") {
    errors.push({ path: "agents", message: 'Required field "agents" must be an object' });
  } else {
    const agents = w.agents as Record<string, unknown>;
    for (const [name, agent] of Object.entries(agents)) {
      validateAgent(name, agent, errors);
    }
  }

  // Validate context (optional)
  // null and undefined are valid (default enabled)
  // false is valid (disabled)
  if (w.context !== undefined && w.context !== null && w.context !== false) {
    validateContext(w.context, errors);
  }

  // Validate params (optional)
  if (w.params !== undefined) {
    if (!Array.isArray(w.params)) {
      errors.push({ path: "params", message: "Params must be an array" });
    } else {
      const names = new Set<string>();
      const shorts = new Set<string>();
      for (let i = 0; i < w.params.length; i++) {
        validateParam(`params[${i}]`, w.params[i], errors, names, shorts);
      }
    }
  }

  // Validate setup (optional)
  if (w.setup !== undefined) {
    if (!Array.isArray(w.setup)) {
      errors.push({ path: "setup", message: "Setup must be an array" });
    } else {
      for (let i = 0; i < w.setup.length; i++) {
        validateSetupTask(`setup[${i}]`, w.setup[i], errors);
      }
    }
  }

  // Validate kickoff (optional)
  if (w.kickoff !== undefined && typeof w.kickoff !== "string") {
    errors.push({ path: "kickoff", message: "Kickoff must be a string" });
  }

  return { valid: errors.length === 0, errors };
}

function validateContext(context: unknown, errors: ValidationError[]): void {
  if (typeof context !== "object" || context === null) {
    errors.push({ path: "context", message: "Context must be an object or false" });
    return;
  }

  const c = context as Record<string, unknown>;

  // Validate provider field
  if (!c.provider || typeof c.provider !== "string") {
    errors.push({
      path: "context.provider",
      message: 'Context requires "provider" field (file or memory)',
    });
    return;
  }

  if (c.provider !== "file" && c.provider !== "memory") {
    errors.push({
      path: "context.provider",
      message: 'Context provider must be "file" or "memory"',
    });
    return;
  }

  // Validate documentOwner (optional, valid for both providers)
  if (c.documentOwner !== undefined && typeof c.documentOwner !== "string") {
    errors.push({
      path: "context.documentOwner",
      message: "Context documentOwner must be a string",
    });
  }

  // Validate file provider config
  if (c.provider === "file" && c.config !== undefined) {
    if (typeof c.config !== "object" || c.config === null) {
      errors.push({ path: "context.config", message: "Context config must be an object" });
      return;
    }

    const cfg = c.config as Record<string, unknown>;

    // dir and bind are mutually exclusive
    if (cfg.dir !== undefined && cfg.bind !== undefined) {
      errors.push({
        path: "context.config",
        message: '"dir" and "bind" are mutually exclusive — use one or the other',
      });
      return;
    }

    if (cfg.dir !== undefined && typeof cfg.dir !== "string") {
      errors.push({ path: "context.config.dir", message: "Context config dir must be a string" });
    }

    if (cfg.bind !== undefined && typeof cfg.bind !== "string") {
      errors.push({
        path: "context.config.bind",
        message: "Context config bind must be a string path",
      });
    }
  }
}

const RESERVED_NAMESPACES = ["env", "workflow", "params", "source"];
const VALID_PARAM_TYPES = ["string", "number", "boolean"];

function validateSetupTask(path: string, task: unknown, errors: ValidationError[]): void {
  if (!task || typeof task !== "object") {
    errors.push({ path, message: "Setup task must be an object" });
    return;
  }

  const t = task as Record<string, unknown>;

  if (!t.shell || typeof t.shell !== "string") {
    errors.push({ path: `${path}.shell`, message: 'Setup task requires "shell" field as string' });
  }

  if (t.as !== undefined && typeof t.as !== "string") {
    errors.push({ path: `${path}.as`, message: 'Setup task "as" field must be a string' });
  }

  if (typeof t.as === "string" && RESERVED_NAMESPACES.includes(t.as)) {
    errors.push({
      path: `${path}.as`,
      message: `"${t.as}" is a reserved namespace and cannot be used as a variable name`,
    });
  }
}

function validateParam(
  path: string,
  param: unknown,
  errors: ValidationError[],
  names: Set<string>,
  shorts: Set<string>,
): void {
  if (!param || typeof param !== "object") {
    errors.push({ path, message: "Param must be an object" });
    return;
  }

  const p = param as Record<string, unknown>;

  if (!p.name || typeof p.name !== "string") {
    errors.push({ path: `${path}.name`, message: 'Param requires "name" field as string' });
    return;
  }

  if (names.has(p.name)) {
    errors.push({ path: `${path}.name`, message: `Duplicate param name: "${p.name}"` });
  }
  names.add(p.name);

  if (p.description !== undefined && typeof p.description !== "string") {
    errors.push({ path: `${path}.description`, message: "Param description must be a string" });
  }

  if (p.type !== undefined) {
    if (typeof p.type !== "string" || !VALID_PARAM_TYPES.includes(p.type)) {
      errors.push({
        path: `${path}.type`,
        message: `Param type must be one of: ${VALID_PARAM_TYPES.join(", ")}`,
      });
    }
  }

  if (p.short !== undefined) {
    if (typeof p.short !== "string" || p.short.length !== 1) {
      errors.push({ path: `${path}.short`, message: "Param short must be a single character" });
    } else {
      if (shorts.has(p.short)) {
        errors.push({
          path: `${path}.short`,
          message: `Duplicate param short flag: "-${p.short}"`,
        });
      }
      shorts.add(p.short);
    }
  }

  if (p.required !== undefined && typeof p.required !== "boolean") {
    errors.push({ path: `${path}.required`, message: "Param required must be a boolean" });
  }
}

/** Backends that don't require an explicit model field */
const CLI_BACKENDS = ["claude", "cursor", "codex", "opencode", "mock"];

function validateAgent(name: string, agent: unknown, errors: ValidationError[]): void {
  const path = `agents.${name}`;

  if (!agent || typeof agent !== "object") {
    errors.push({ path, message: "Agent must be an object" });
    return;
  }

  const a = agent as Record<string, unknown>;
  const backend = typeof a.backend === "string" ? a.backend : "default";

  // model is required for default backend, optional for CLI backends (they have defaults)
  if (a.model !== undefined && typeof a.model !== "string") {
    errors.push({ path: `${path}.model`, message: 'Field "model" must be a string' });
  } else if (!a.model && !CLI_BACKENDS.includes(backend)) {
    errors.push({
      path: `${path}.model`,
      message: 'Required field "model" must be a string (required for default backend)',
    });
  }

  if (a.system_prompt !== undefined && typeof a.system_prompt !== "string") {
    errors.push({
      path: `${path}.system_prompt`,
      message: 'Optional field "system_prompt" must be a string',
    });
  }

  if (a.tools !== undefined && !Array.isArray(a.tools)) {
    errors.push({ path: `${path}.tools`, message: 'Optional field "tools" must be an array' });
  }

  // Validate wakeup field
  if (a.wakeup !== undefined) {
    if (typeof a.wakeup !== "string" && typeof a.wakeup !== "number") {
      errors.push({
        path: `${path}.wakeup`,
        message: 'Field "wakeup" must be a string (duration or cron) or number (ms)',
      });
    } else if (typeof a.wakeup === "number" && a.wakeup <= 0) {
      errors.push({
        path: `${path}.wakeup`,
        message: 'Field "wakeup" must be a positive number when specified as ms',
      });
    }
  }

  if (a.wakeup_prompt !== undefined) {
    if (typeof a.wakeup_prompt !== "string") {
      errors.push({
        path: `${path}.wakeup_prompt`,
        message: 'Field "wakeup_prompt" must be a string',
      });
    }
    if (a.wakeup === undefined) {
      errors.push({
        path: `${path}.wakeup_prompt`,
        message: 'Field "wakeup_prompt" can only be used when "wakeup" is also specified',
      });
    }
  }

  // Validate provider field
  if (a.provider !== undefined) {
    if (typeof a.provider === "string") {
      // string form is valid
    } else if (
      typeof a.provider === "object" &&
      a.provider !== null &&
      !Array.isArray(a.provider)
    ) {
      const p = a.provider as Record<string, unknown>;
      if (!p.name || typeof p.name !== "string") {
        errors.push({
          path: `${path}.provider.name`,
          message: 'Field "provider.name" is required and must be a string',
        });
      }
      if (p.base_url !== undefined && typeof p.base_url !== "string") {
        errors.push({
          path: `${path}.provider.base_url`,
          message: 'Field "provider.base_url" must be a string',
        });
      }
      if (p.api_key !== undefined && typeof p.api_key !== "string") {
        errors.push({
          path: `${path}.provider.api_key`,
          message: 'Field "provider.api_key" must be a string',
        });
      }
    } else {
      errors.push({
        path: `${path}.provider`,
        message: 'Field "provider" must be a string or object with { name, base_url?, api_key? }',
      });
    }

    // provider only works with default backend
    if (CLI_BACKENDS.includes(backend) && backend !== "mock") {
      errors.push({
        path: `${path}.provider`,
        message: `Field "provider" is ignored for CLI backend "${backend}" (only works with default backend)`,
      });
    }
  }
}

/**
 * Parse CLI arguments against workflow param definitions.
 * Uses Node's built-in util.parseArgs().
 *
 * @param defs  Param definitions from workflow YAML
 * @param argv  Raw CLI arguments (everything after the workflow file)
 * @returns     Resolved param values as string map
 * @throws      Error if required params are missing or types are invalid
 */
export function parseWorkflowParams(
  defs: ParamDefinition[],
  argv: string[],
): Record<string, string> {
  if (defs.length === 0) return {};

  // Build parseArgs options from param definitions
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const def of defs) {
    const type = def.type === "boolean" ? "boolean" : "string";
    const opt: { type: "string" | "boolean"; short?: string } = { type };
    if (def.short) opt.short = def.short;
    options[def.name] = opt;
  }

  const { values } = parseArgs({ args: argv, options, strict: true });

  // Resolve defaults, validate required, coerce types
  const result: Record<string, string> = {};
  const missing: string[] = [];

  for (const def of defs) {
    let raw = values[def.name];

    // Apply default (coerce to string since parseArgs values are string | boolean)
    if (raw === undefined && def.default !== undefined) {
      raw = String(def.default);
    }

    if (raw === undefined) {
      if (def.required) {
        const flag = def.short ? `-${def.short}/--${def.name}` : `--${def.name}`;
        missing.push(flag);
      }
      continue;
    }

    // Type validation for number params
    if (def.type === "number") {
      const num = Number(raw);
      if (isNaN(num)) {
        throw new Error(`Parameter --${def.name} must be a number, got: "${raw}"`);
      }
      result[def.name] = String(num);
    } else {
      result[def.name] = String(raw);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required parameter(s): ${missing.join(", ")}`);
  }

  return result;
}

/**
 * Format parameter help text for workflow params
 */
export function formatParamHelp(defs: ParamDefinition[]): string {
  if (defs.length === 0) return "";

  const lines = ["", "Workflow parameters:"];
  for (const def of defs) {
    const flags = def.short ? `-${def.short}, --${def.name}` : `    --${def.name}`;
    const type = def.type || "string";
    const req = def.required ? " (required)" : "";
    const dflt = def.default !== undefined ? ` [default: ${def.default}]` : "";
    const desc = def.description || "";
    lines.push(`  ${flags} <${type}>  ${desc}${req}${dflt}`);
  }
  return lines.join("\n");
}

/**
 * Get all agent names mentioned in kickoff
 */
export function getKickoffMentions(kickoff: string, validAgents: string[]): string[] {
  const mentions: string[] = [];
  const pattern = /@([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(kickoff)) !== null) {
    const agent = match[1];
    if (agent && validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent);
    }
  }

  return mentions;
}
