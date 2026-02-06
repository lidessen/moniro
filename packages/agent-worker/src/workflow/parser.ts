/**
 * Workflow file parser
 */

import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, isAbsolute } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  WorkflowFile,
  ParsedWorkflow,
  ResolvedAgent,
  ResolvedContext,
  ValidationResult,
  ValidationError,
  SetupTask,
  AgentDefinition,
} from './types.ts'
import { CONTEXT_DEFAULTS } from '../context/types.js'

/**
 * Parse options
 */
export interface ParseOptions {
  /** Instance name for context directory (default: 'default') */
  instance?: string
}

/**
 * Parse a workflow file
 */
export async function parseWorkflowFile(
  filePath: string,
  options?: ParseOptions
): Promise<ParsedWorkflow> {
  const absolutePath = resolve(filePath)
  const instance = options?.instance || 'default'

  if (!existsSync(absolutePath)) {
    throw new Error(`Workflow file not found: ${absolutePath}`)
  }

  const content = readFileSync(absolutePath, 'utf-8')
  const workflowDir = dirname(absolutePath)

  let raw: WorkflowFile
  try {
    raw = parseYaml(content) as WorkflowFile
  } catch (error) {
    throw new Error(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // Validate basic structure
  const validation = validateWorkflow(raw)
  if (!validation.valid) {
    const messages = validation.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')
    throw new Error(`Invalid workflow file:\n${messages}`)
  }

  // Extract name from filename if not specified
  const name = raw.name || basename(absolutePath, '.yml').replace('.yaml', '')

  // Resolve agents
  const agents: Record<string, ResolvedAgent> = {}
  for (const [agentName, agentDef] of Object.entries(raw.agents)) {
    agents[agentName] = await resolveAgent(agentDef, workflowDir)
  }

  // Resolve context configuration
  const context = resolveContext(raw.context, workflowDir, name, instance)

  return {
    name,
    filePath: absolutePath,
    agents,
    context,
    setup: raw.setup || [],
    kickoff: raw.kickoff,
  }
}

/**
 * Resolve context directory path with template substitution
 *
 * Handles:
 * - ~ expansion to home directory
 * - ${{ workflow.name }} substitution
 * - ${{ instance }} substitution
 * - Relative paths (resolved relative to workflowDir)
 * - Absolute paths (used as-is)
 */
function resolveContextDir(
  dirTemplate: string,
  workflowDir: string,
  workflowName: string,
  instance: string
): string {
  // Substitute templates
  let dir = dirTemplate
    .replace('${{ workflow.name }}', workflowName)
    .replace('${{ instance }}', instance)

  // Expand tilde to home directory
  if (dir.startsWith('~/')) {
    dir = join(homedir(), dir.slice(2))
  } else if (dir === '~') {
    dir = homedir()
  } else if (!isAbsolute(dir)) {
    // Relative path - resolve relative to workflow directory
    dir = join(workflowDir, dir)
  }

  return dir
}

/**
 * Resolve context configuration
 *
 * - undefined (not set): default file provider enabled
 * - null: default file provider enabled (YAML `context:` syntax)
 * - false: explicitly disabled
 * - { provider: 'file', config?: {...} }: file provider with config
 * - { provider: 'memory' }: memory provider (for testing)
 */
function resolveContext(
  config: WorkflowFile['context'] | null,
  workflowDir: string,
  workflowName: string,
  instance: string
): ResolvedContext | undefined {
  // false = explicitly disabled
  if (config === false) {
    return undefined
  }

  // undefined or null = default file provider enabled
  if (config === undefined || config === null) {
    const dir = resolveContextDir(CONTEXT_DEFAULTS.dir, workflowDir, workflowName, instance)
    return { provider: 'file', dir }
  }

  // Memory provider
  if (config.provider === 'memory') {
    return {
      provider: 'memory',
      documentOwner: config.documentOwner,
    }
  }

  // File provider with custom config
  const dirTemplate = config.config?.dir || CONTEXT_DEFAULTS.dir
  const dir = resolveContextDir(dirTemplate, workflowDir, workflowName, instance)

  return {
    provider: 'file',
    dir,
    documentOwner: config.documentOwner,
  }
}

/**
 * Resolve agent definition (load system prompt from file if needed)
 */
async function resolveAgent(agent: AgentDefinition, workflowDir: string): Promise<ResolvedAgent> {
  let resolvedSystemPrompt = agent.system_prompt

  // Check if system_prompt is a file path
  if (agent.system_prompt.endsWith('.txt') || agent.system_prompt.endsWith('.md')) {
    const promptPath = agent.system_prompt.startsWith('/')
      ? agent.system_prompt
      : join(workflowDir, agent.system_prompt)

    if (existsSync(promptPath)) {
      resolvedSystemPrompt = readFileSync(promptPath, 'utf-8')
    }
    // If file doesn't exist, use as-is (might be intentional literal)
  }

  return {
    ...agent,
    resolvedSystemPrompt,
  }
}

/**
 * Validate workflow structure
 */
export function validateWorkflow(workflow: unknown): ValidationResult {
  const errors: ValidationError[] = []

  if (!workflow || typeof workflow !== 'object') {
    errors.push({ path: '', message: 'Workflow must be an object' })
    return { valid: false, errors }
  }

  const w = workflow as Record<string, unknown>

  // Validate agents (required)
  if (!w.agents || typeof w.agents !== 'object') {
    errors.push({ path: 'agents', message: 'Required field "agents" must be an object' })
  } else {
    const agents = w.agents as Record<string, unknown>
    for (const [name, agent] of Object.entries(agents)) {
      validateAgent(name, agent, errors)
    }
  }

  // Validate context (optional)
  // null and undefined are valid (default enabled)
  // false is valid (disabled)
  if (w.context !== undefined && w.context !== null && w.context !== false) {
    validateContext(w.context, errors)
  }

  // Validate setup (optional)
  if (w.setup !== undefined) {
    if (!Array.isArray(w.setup)) {
      errors.push({ path: 'setup', message: 'Setup must be an array' })
    } else {
      for (let i = 0; i < w.setup.length; i++) {
        validateSetupTask(`setup[${i}]`, w.setup[i], errors)
      }
    }
  }

  // Validate kickoff (optional)
  if (w.kickoff !== undefined && typeof w.kickoff !== 'string') {
    errors.push({ path: 'kickoff', message: 'Kickoff must be a string' })
  }

  return { valid: errors.length === 0, errors }
}

function validateContext(context: unknown, errors: ValidationError[]): void {
  if (typeof context !== 'object' || context === null) {
    errors.push({ path: 'context', message: 'Context must be an object or false' })
    return
  }

  const c = context as Record<string, unknown>

  // Validate provider field
  if (!c.provider || typeof c.provider !== 'string') {
    errors.push({ path: 'context.provider', message: 'Context requires "provider" field (file or memory)' })
    return
  }

  if (c.provider !== 'file' && c.provider !== 'memory') {
    errors.push({ path: 'context.provider', message: 'Context provider must be "file" or "memory"' })
    return
  }

  // Validate documentOwner (optional, valid for both providers)
  if (c.documentOwner !== undefined && typeof c.documentOwner !== 'string') {
    errors.push({ path: 'context.documentOwner', message: 'Context documentOwner must be a string' })
  }

  // Validate file provider config
  if (c.provider === 'file' && c.config !== undefined) {
    if (typeof c.config !== 'object' || c.config === null) {
      errors.push({ path: 'context.config', message: 'Context config must be an object' })
      return
    }

    const cfg = c.config as Record<string, unknown>
    if (cfg.dir !== undefined && typeof cfg.dir !== 'string') {
      errors.push({ path: 'context.config.dir', message: 'Context config dir must be a string' })
    }
  }
}

function validateSetupTask(path: string, task: unknown, errors: ValidationError[]): void {
  if (!task || typeof task !== 'object') {
    errors.push({ path, message: 'Setup task must be an object' })
    return
  }

  const t = task as Record<string, unknown>

  if (!t.shell || typeof t.shell !== 'string') {
    errors.push({ path: `${path}.shell`, message: 'Setup task requires "shell" field as string' })
  }

  if (t.as !== undefined && typeof t.as !== 'string') {
    errors.push({ path: `${path}.as`, message: 'Setup task "as" field must be a string' })
  }
}

/** Backends that don't require an explicit model field */
const CLI_BACKENDS = ['claude', 'cursor', 'codex', 'mock']

function validateAgent(name: string, agent: unknown, errors: ValidationError[]): void {
  const path = `agents.${name}`

  if (!agent || typeof agent !== 'object') {
    errors.push({ path, message: 'Agent must be an object' })
    return
  }

  const a = agent as Record<string, unknown>
  const backend = typeof a.backend === 'string' ? a.backend : 'sdk'

  // model is required for SDK backend, optional for CLI backends (they have defaults)
  if (a.model !== undefined && typeof a.model !== 'string') {
    errors.push({ path: `${path}.model`, message: 'Field "model" must be a string' })
  } else if (!a.model && !CLI_BACKENDS.includes(backend)) {
    errors.push({ path: `${path}.model`, message: 'Required field "model" must be a string (required for sdk backend)' })
  }

  if (!a.system_prompt || typeof a.system_prompt !== 'string') {
    errors.push({
      path: `${path}.system_prompt`,
      message: 'Required field "system_prompt" must be a string',
    })
  }

  if (a.tools !== undefined && !Array.isArray(a.tools)) {
    errors.push({ path: `${path}.tools`, message: 'Optional field "tools" must be an array' })
  }
}

/**
 * Get all agent names mentioned in kickoff
 */
export function getKickoffMentions(kickoff: string, validAgents: string[]): string[] {
  const mentions: string[] = []
  const pattern = /@([a-zA-Z][a-zA-Z0-9_-]*)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(kickoff)) !== null) {
    const agent = match[1]
    if (agent && validAgents.includes(agent) && !mentions.includes(agent)) {
      mentions.push(agent)
    }
  }

  return mentions
}
