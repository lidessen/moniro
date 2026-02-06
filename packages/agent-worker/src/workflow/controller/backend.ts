/**
 * Agent Backend Implementations
 * Different ways to run agents (SDK, CLI, etc.)
 */

import { spawn } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentBackend, AgentRunContext, AgentRunResult, ParsedModel } from './types.ts'
import { parseModel } from './types.ts'
import { buildAgentPrompt } from './prompt.ts'
import { CursorBackend as CursorCLI } from '../../backends/cursor.ts'
import { ClaudeCodeBackend as ClaudeCLI } from '../../backends/claude-code.ts'
import { CodexBackend as CodexCLI } from '../../backends/codex.ts'
import { createMockBackend } from '../../backends/mock.ts'
import { getModelForBackend } from '../../backends/types.ts'

// ==================== SDK Backend ====================

/**
 * SDK Backend - uses Anthropic SDK directly
 *
 * This is the most capable backend, with full MCP tool support.
 * Requires ANTHROPIC_API_KEY environment variable.
 */
export class SDKBackend implements AgentBackend {
  readonly name = 'sdk'

  constructor(
    private getClient: () => Promise<AnthropicLike>,
    private getMCPTools?: (mcpUrl: string) => Promise<Tool[]>
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()

    try {
      const client = await this.getClient()
      if (!ctx.agent.model) {
        throw new Error('SDK backend requires a model to be specified')
      }
      const { model } = parseModel(ctx.agent.model)

      // Build initial messages
      const messages: Message[] = [{ role: 'user', content: buildAgentPrompt(ctx) }]

      // Get MCP tools if available
      const tools = this.getMCPTools ? await this.getMCPTools(ctx.mcpUrl) : []

      // Agentic loop
      while (true) {
        const response = await client.messages.create({
          model,
          system: ctx.agent.resolvedSystemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          max_tokens: 4096,
        })

        // Check for end of turn
        if (response.stop_reason === 'end_turn') {
          break
        }

        // Handle tool use
        if (response.stop_reason === 'tool_use') {
          const toolResults = await this.handleToolCalls(response.content)
          messages.push({ role: 'assistant', content: response.content })
          messages.push({ role: 'user', content: toolResults })
        } else {
          // Other stop reasons (max_tokens, etc.)
          break
        }
      }

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  private async handleToolCalls(
    content: ContentBlock[]
  ): Promise<ContentBlock[]> {
    const results: ContentBlock[] = []

    for (const block of content) {
      if (block.type === 'tool_use') {
        // TODO: Connect to MCP server and execute tool
        // For now, return placeholder
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Tool execution not implemented',
        })
      }
    }

    return results
  }
}

// Minimal type definitions for Anthropic SDK compatibility
interface AnthropicLike {
  messages: {
    create(params: {
      model: string
      system: string
      messages: Message[]
      tools?: Tool[]
      max_tokens: number
    }): Promise<{
      stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
      content: ContentBlock[]
    }>
  }
}

interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

interface Tool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

// ==================== CLI Backend ====================

/** Error patterns to detect CLI failures */
const CLI_ERROR_PATTERNS = [
  /\bError:/i,
  /\bFailed to\b/i,
  /\bException:/i,
  /\brate limit/i,
  /\bAPI error/i,
  /\bconnection refused/i,
  /\bUnauthorized/i,
  /\bForbidden/i,
]

/**
 * Detect error in CLI output
 */
export function detectCLIError(stdout: string, stderr: string, exitCode: number): string | undefined {
  if (exitCode !== 0) {
    return `Process exited with code ${exitCode}`
  }

  for (const pattern of CLI_ERROR_PATTERNS) {
    const match = stderr.match(pattern) || stdout.match(pattern)
    if (match) {
      return `Error detected: ${match[0]}`
    }
  }

  return undefined
}

/**
 * Generate MCP config JSON for workflow context server
 * Used internally by CLIBackend to connect agents to the workflow MCP server
 */
/** MCP config format for workflow context */
export interface WorkflowMCPConfig {
  mcpServers: Record<string, unknown>
}

/**
 * Generate MCP config for workflow context server.
 *
 * Uses HTTP transport — CLI agents connect directly via URL:
 *   { type: "http", url: "http://127.0.0.1:<port>/mcp?agent=<name>" }
 */
export function generateWorkflowMCPConfig(
  mcpUrl: string,
  agentName: string
): WorkflowMCPConfig {
  const url = `${mcpUrl}?agent=${encodeURIComponent(agentName)}`
  return {
    mcpServers: {
      'workflow-context': {
        type: 'http',
        url,
      },
    },
  }
}

/**
 * CLI Backend - runs agent via command line tool
 *
 * Base class for CLI-based agent runners (Claude CLI, Codex, etc.)
 */
export class CLIBackend implements AgentBackend {
  constructor(
    public readonly name: string,
    private command: string,
    private buildArgs: (ctx: AgentRunContext, mcpConfigPath: string) => string[],
    private options?: {
      env?: Record<string, string>
      cwd?: string
    }
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()

    // Write MCP config to temp file
    const mcpConfigPath = join(tmpdir(), `agent-${ctx.name}-${Date.now()}-mcp.json`)

    try {
      writeFileSync(mcpConfigPath, JSON.stringify(generateWorkflowMCPConfig(ctx.mcpUrl, ctx.name), null, 2))

      const args = this.buildArgs(ctx, mcpConfigPath)
      const { stdout, stderr, exitCode } = await this.exec(this.command, args)

      const error = detectCLIError(stdout, stderr, exitCode)
      if (error) {
        return { success: false, error, duration: Date.now() - startTime }
      }

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    } finally {
      // Cleanup temp file
      if (existsSync(mcpConfigPath)) {
        try {
          unlinkSync(mcpConfigPath)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private exec(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        env: { ...process.env, ...this.options?.env },
        cwd: this.options?.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('error', reject)

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 0 })
      })

      // Send prompt to stdin
      // Note: This assumes the CLI tool reads from stdin
      // Some tools may need different input methods
    })
  }
}

// ==================== Specific CLI Backends ====================

/**
 * Create Claude CLI backend
 */
export function createClaudeCLIBackend(): CLIBackend {
  return new CLIBackend('claude', 'claude', (ctx, mcpConfigPath) => [
    '-p', // Print mode (non-interactive)
    '--mcp-config',
    mcpConfigPath,
    '--system-prompt',
    ctx.agent.resolvedSystemPrompt,
    buildAgentPrompt(ctx),
  ])
}

/**
 * Create Codex CLI backend
 */
export function createCodexCLIBackend(): CLIBackend {
  return new CLIBackend(
    'codex',
    'codex',
    (ctx, _mcpConfigPath) => [
      // Codex uses project-level config, not per-invocation
      buildAgentPrompt(ctx),
    ],
    {
      // Codex needs project directory as cwd
      cwd: process.cwd(),
    }
  )
}

// ==================== Backend Selection ====================

export interface BackendOptions {
  getClient?: () => Promise<AnthropicLike>
  getMCPTools?: (mcpUrl: string) => Promise<Tool[]>
}

/**
 * Get backend by explicit backend type
 */
export function getBackendByType(
  backendType: 'sdk' | 'claude' | 'cursor' | 'codex' | 'mock',
  options?: BackendOptions & { model?: string; debugLog?: (msg: string) => void }
): AgentBackend {
  switch (backendType) {
    case 'sdk':
      if (!options?.getClient) {
        throw new Error('SDK backend requires getClient function')
      }
      return new SDKBackend(options.getClient, options.getMCPTools)

    case 'claude':
      return createClaudeCodeBackend(options?.model, options?.debugLog)

    case 'codex':
      return createCodexBackend(options?.model, options?.debugLog)

    case 'cursor':
      return createCursorBackend(options?.model, options?.debugLog)

    case 'mock':
      return createMockBackend(options?.debugLog)

    default:
      throw new Error(`Unknown backend type: ${backendType}`)
  }
}

/**
 * Get appropriate backend for a model (legacy, use getBackendByType when backend field is specified)
 */
export function getBackendForModel(
  model: string,
  options?: BackendOptions & { debugLog?: (msg: string) => void }
): AgentBackend {
  const { provider } = parseModel(model)

  switch (provider) {
    case 'anthropic':
      if (!options?.getClient) {
        throw new Error('SDK backend requires getClient function')
      }
      return new SDKBackend(options.getClient, options.getMCPTools)

    case 'claude':
      return createClaudeCLIBackend()

    case 'codex':
      return createCodexCLIBackend()

    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

// ==================== CLI Adapter Backends ====================

/**
 * CLI backend interface with workspace and MCP support
 */
interface CLIWithWorkspace {
  send: (message: string, options?: { system?: string }) => Promise<{ content: string }>
  setWorkspace: (workspaceDir: string, mcpConfig: WorkflowMCPConfig) => void
}

/**
 * Adapter that wraps CLI backends for workflow controller
 *
 * All CLI backends now use setWorkspace() to:
 * 1. Set the working directory to an isolated workspace (not the user's project)
 * 2. Configure MCP via project-level config files (.cursor/mcp.json, etc.)
 *
 * The agent prompt includes the project directory so the agent knows what to work on.
 */
class CLIAdapterBackend implements AgentBackend {
  constructor(
    public readonly name: string,
    private cli: CLIWithWorkspace,
    private debugLog?: (message: string) => void
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()
    const log = this.debugLog || (() => {})

    try {
      // Set up workspace with MCP config (HTTP transport)
      const mcpConfig = generateWorkflowMCPConfig(ctx.mcpUrl, ctx.name)
      this.cli.setWorkspace(ctx.workspaceDir, mcpConfig)

      const prompt = buildAgentPrompt(ctx)

      // Log what we're sending to the agent
      log(`[${ctx.name}] Sending prompt to ${this.name} backend (${prompt.length} chars)`)
      log(`[${ctx.name}] System prompt: ${(ctx.agent.resolvedSystemPrompt || '(none)').slice(0, 100)}`)
      log(`[${ctx.name}] Workspace: ${ctx.workspaceDir}`)

      const response = await this.cli.send(prompt, { system: ctx.agent.resolvedSystemPrompt })

      // Log response summary
      const responsePreview = response.content.length > 200
        ? response.content.slice(0, 200) + '...'
        : response.content
      log(`[${ctx.name}] Response (${response.content.length} chars): ${responsePreview}`)

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      log(`[${ctx.name}] Backend error: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      }
    }
  }
}

/**
 * Create a Cursor backend using cursor-agent CLI
 * Uses workspace directory with .cursor/mcp.json for MCP config
 */
function createCursorBackend(model?: string, debugLog?: (msg: string) => void): AgentBackend {
  const translatedModel = model ? getModelForBackend(model, 'cursor') : undefined
  const cli = new CursorCLI({ model: translatedModel })
  return new CLIAdapterBackend('cursor', cli, debugLog)
}

/**
 * Create a Claude Code backend using claude CLI
 * Uses workspace directory with mcp-config.json for MCP config
 */
function createClaudeCodeBackend(model?: string, debugLog?: (msg: string) => void): AgentBackend {
  const translatedModel = model ? getModelForBackend(model, 'claude') : undefined
  const cli = new ClaudeCLI({ model: translatedModel })
  return new CLIAdapterBackend('claude', cli, debugLog)
}

/**
 * Create a Codex backend using codex CLI
 * Uses workspace directory with .codex/config.yaml for MCP config
 */
function createCodexBackend(model?: string, debugLog?: (msg: string) => void): AgentBackend {
  const translatedModel = model ? getModelForBackend(model, 'codex') : undefined
  const cli = new CodexCLI({ model: translatedModel })
  return new CLIAdapterBackend('codex', cli, debugLog)
}
