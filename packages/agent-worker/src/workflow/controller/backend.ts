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
    private getMCPTools?: (socketPath: string) => Promise<Tool[]>
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
      const tools = this.getMCPTools ? await this.getMCPTools(ctx.mcpSocketPath) : []

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
          const toolResults = await this.handleToolCalls(response.content, ctx.mcpSocketPath)
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
    content: ContentBlock[],
    _socketPath: string
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
export function generateWorkflowMCPConfig(socketPath: string): object {
  return {
    mcpServers: {
      'workflow-context': {
        type: 'stdio',
        command: 'agent-worker',
        args: ['context', 'mcp-stdio', '--socket', socketPath],
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
      writeFileSync(mcpConfigPath, JSON.stringify(generateWorkflowMCPConfig(ctx.mcpSocketPath), null, 2))

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
  getMCPTools?: (socketPath: string) => Promise<Tool[]>
}

/**
 * Get backend by explicit backend type
 */
export function getBackendByType(
  backendType: 'sdk' | 'claude' | 'cursor' | 'codex',
  options?: BackendOptions & { model?: string }
): AgentBackend {
  switch (backendType) {
    case 'sdk':
      if (!options?.getClient) {
        throw new Error('SDK backend requires getClient function')
      }
      return new SDKBackend(options.getClient, options.getMCPTools)

    case 'claude':
      return createClaudeCodeBackend(options?.model)

    case 'codex':
      return createCodexBackend(options?.model)

    case 'cursor':
      return createCursorBackend(options?.model)

    default:
      throw new Error(`Unknown backend type: ${backendType}`)
  }
}

/**
 * Get appropriate backend for a model (legacy, use getBackendByType when backend field is specified)
 */
export function getBackendForModel(
  model: string,
  options?: BackendOptions
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
 * Adapter that wraps new CLI backends for workflow controller
 */
class CLIAdapterBackend implements AgentBackend {
  constructor(
    public readonly name: string,
    private cli: { send: (message: string, options?: { system?: string }) => Promise<{ content: string }> }
  ) {}

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()

    try {
      const prompt = buildAgentPrompt(ctx)
      await this.cli.send(prompt, { system: ctx.agent.resolvedSystemPrompt })

      return { success: true, duration: Date.now() - startTime }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }
}

/**
 * Create a Cursor backend using cursor-agent CLI
 */
function createCursorBackend(model?: string): AgentBackend {
  const translatedModel = model ? getModelForBackend(model, 'cursor') : undefined
  const cli = new CursorCLI({ model: translatedModel, cwd: process.cwd() })
  return new CLIAdapterBackend('cursor', cli)
}

/**
 * Create a Claude Code backend using claude CLI
 */
function createClaudeCodeBackend(model?: string): AgentBackend {
  const translatedModel = model ? getModelForBackend(model, 'claude') : undefined
  const cli = new ClaudeCLI({ model: translatedModel, cwd: process.cwd() })
  return new CLIAdapterBackend('claude', cli)
}

/**
 * Create a Codex backend using codex CLI
 */
function createCodexBackend(model?: string): AgentBackend {
  const translatedModel = model ? getModelForBackend(model, 'codex') : undefined
  const cli = new CodexCLI({ model: translatedModel, cwd: process.cwd() })
  return new CLIAdapterBackend('codex', cli)
}
