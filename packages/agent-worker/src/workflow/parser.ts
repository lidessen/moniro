/**
 * Workflow file parser
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  WorkflowFile,
  ParsedWorkflow,
  ResolvedAgent,
  ResolvedContext,
  ValidationResult,
  ValidationError,
  AgentDefinition,
} from "./types.ts";
import { CONTEXT_DEFAULTS } from "./context/types.ts";
import { resolveContextDir } from "./context/file-provider.ts";

/**
 * Parse options
 */
export interface ParseOptions {
  /** Workflow name (default: 'global') */
  workflow?: string;
  /** Workflow tag (default: 'main') */
  tag?: string;
  /** @deprecated Use workflow instead. Instance name for context directory */
  instance?: string;
}

/**
 * Parse a workflow file
 */
export async function parseWorkflowFile(
  filePath: string,
  options?: ParseOptions,
): Promise<ParsedWorkflow> {
  const absolutePath = resolve(filePath);
  const workflow = options?.workflow ?? options?.instance ?? "global";
  const tag = options?.tag ?? "main";

  if (!existsSync(absolutePath)) {
    throw new Error(`Workflow file not found: ${absolutePath}`);
  }

  const content = readFileSync(absolutePath, "utf-8");
  const workflowDir = dirname(absolutePath);

  let raw: WorkflowFile;
  try {
    raw = parseYaml(content) as WorkflowFile;
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

  // Extract name from filename if not specified
  const name = raw.name || basename(absolutePath, ".yml").replace(".yaml", "");

  // Resolve agents
  const agents: Record<string, ResolvedAgent> = {};
  for (const [agentName, agentDef] of Object.entries(raw.agents)) {
    agents[agentName] = await resolveAgent(agentDef, workflowDir);
  }

  // Resolve context configuration
  const context = resolveContext(raw.context, workflowDir, name, workflow, tag);

  return {
    name,
    filePath: absolutePath,
    agents,
    context,
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
      instance: workflow, // Backward compat
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
 * Resolve agent definition (load system prompt from file if needed)
 */
async function resolveAgent(agent: AgentDefinition, workflowDir: string): Promise<ResolvedAgent> {
  let resolvedSystemPrompt = agent.system_prompt;

  // Check if system_prompt is a file path
  if (resolvedSystemPrompt?.endsWith(".txt") || resolvedSystemPrompt?.endsWith(".md")) {
    const promptPath = resolvedSystemPrompt.startsWith("/")
      ? resolvedSystemPrompt
      : join(workflowDir, resolvedSystemPrompt);

    if (existsSync(promptPath)) {
      resolvedSystemPrompt = readFileSync(promptPath, "utf-8");
    }
    // If file doesn't exist, use as-is (might be intentional literal)
  }

  return {
    ...agent,
    resolvedSystemPrompt,
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
