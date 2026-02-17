/**
 * Workflow file parser — YAML → ParsedWorkflow.
 *
 * Reads workflow YAML, validates structure, resolves agent system
 * prompts (file → inline), and extracts schedule config.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  WorkflowFile,
  ParsedWorkflow,
  ResolvedAgent,
  AgentDefinition,
  ValidationResult,
  ValidationError,
} from "./types.ts";

export interface ParseOptions {
  /** Workflow name override */
  workflow?: string;
  /** Workflow tag (default: 'main') */
  tag?: string;
}

/**
 * Parse a workflow YAML file.
 */
export async function parseWorkflowFile(
  filePath: string,
  _options?: ParseOptions,
): Promise<ParsedWorkflow> {
  const absolutePath = resolve(filePath);

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

  // Validate structure
  const validation = validateWorkflow(raw);
  if (!validation.valid) {
    const messages = validation.errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    throw new Error(`Invalid workflow file:\n${messages}`);
  }

  // Extract name from YAML or filename
  const name = raw.name || basename(absolutePath, ".yml").replace(".yaml", "");

  // Resolve agents
  const agents: Record<string, ResolvedAgent> = {};
  for (const [agentName, agentDef] of Object.entries(raw.agents)) {
    agents[agentName] = resolveAgent(agentDef, workflowDir);
  }

  return {
    name,
    filePath: absolutePath,
    agents,
    setup: raw.setup || [],
    kickoff: raw.kickoff,
  };
}

/**
 * Resolve agent — load system prompt from file if needed,
 * transform wakeup/wakeup_prompt into schedule config.
 */
function resolveAgent(agent: AgentDefinition, workflowDir: string): ResolvedAgent {
  let resolvedSystemPrompt = agent.system_prompt;

  // Load from file if path-like
  if (resolvedSystemPrompt?.endsWith(".txt") || resolvedSystemPrompt?.endsWith(".md")) {
    const promptPath = resolvedSystemPrompt.startsWith("/")
      ? resolvedSystemPrompt
      : join(workflowDir, resolvedSystemPrompt);

    if (existsSync(promptPath)) {
      resolvedSystemPrompt = readFileSync(promptPath, "utf-8");
    }
  }

  // Build schedule config
  let schedule: { wakeup: string | number; prompt?: string } | undefined;
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
 * Validate workflow structure.
 */
export function validateWorkflow(workflow: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!workflow || typeof workflow !== "object") {
    errors.push({ path: "", message: "Workflow must be an object" });
    return { valid: false, errors };
  }

  const w = workflow as Record<string, unknown>;

  // agents (required)
  if (!w.agents || typeof w.agents !== "object") {
    errors.push({ path: "agents", message: 'Required field "agents" must be an object' });
  } else {
    for (const [name, agent] of Object.entries(w.agents as Record<string, unknown>)) {
      validateAgent(name, agent, errors);
    }
  }

  // setup (optional)
  if (w.setup !== undefined) {
    if (!Array.isArray(w.setup)) {
      errors.push({ path: "setup", message: "Setup must be an array" });
    } else {
      for (let i = 0; i < w.setup.length; i++) {
        const task = w.setup[i];
        if (!task || typeof task !== "object" || !task.shell || typeof task.shell !== "string") {
          errors.push({ path: `setup[${i}]`, message: 'Setup task requires "shell" as string' });
        }
      }
    }
  }

  // kickoff (optional)
  if (w.kickoff !== undefined && typeof w.kickoff !== "string") {
    errors.push({ path: "kickoff", message: "Kickoff must be a string" });
  }

  return { valid: errors.length === 0, errors };
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

  // model validation
  if (a.model !== undefined && typeof a.model !== "string") {
    errors.push({ path: `${path}.model`, message: '"model" must be a string' });
  } else if (!a.model && !CLI_BACKENDS.includes(backend)) {
    errors.push({ path: `${path}.model`, message: '"model" is required for default backend' });
  }

  // system_prompt (optional)
  if (a.system_prompt !== undefined && typeof a.system_prompt !== "string") {
    errors.push({ path: `${path}.system_prompt`, message: '"system_prompt" must be a string' });
  }

  // tools (optional)
  if (a.tools !== undefined && !Array.isArray(a.tools)) {
    errors.push({ path: `${path}.tools`, message: '"tools" must be an array' });
  }

  // wakeup validation
  if (a.wakeup !== undefined) {
    if (typeof a.wakeup !== "string" && typeof a.wakeup !== "number") {
      errors.push({ path: `${path}.wakeup`, message: '"wakeup" must be a string or number' });
    }
  }

  if (a.wakeup_prompt !== undefined) {
    if (typeof a.wakeup_prompt !== "string") {
      errors.push({ path: `${path}.wakeup_prompt`, message: '"wakeup_prompt" must be a string' });
    }
    if (a.wakeup === undefined) {
      errors.push({ path: `${path}.wakeup_prompt`, message: '"wakeup_prompt" requires "wakeup"' });
    }
  }
}

/**
 * Get all agent names mentioned in kickoff string.
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
