/**
 * Claude Code CLI backend
 * Uses `claude -p` for non-interactive mode
 *
 * MCP Configuration:
 * Claude supports per-invocation MCP config via --mcp-config flag.
 * Use setWorkspace() for workspace isolation, or setMcpConfigPath() directly.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code
 */

import { execa, ExecaError } from 'execa'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Backend, BackendResponse } from './types.ts'
import type { AgentRunContext, AgentRunResult } from '../workflow/controller/types.ts'
import { buildAgentPrompt } from '../workflow/controller/prompt.ts'
import { generateWorkflowMCPConfig } from '../workflow/controller/mcp-config.ts'

export interface ClaudeCodeOptions {
  /** Model to use (e.g., 'opus', 'sonnet') */
  model?: string
  /** Additional system prompt to append */
  appendSystemPrompt?: string
  /** Allowed tools (permission rule syntax) */
  allowedTools?: string[]
  /** Output format: 'text' | 'json' | 'stream-json' */
  outputFormat?: 'text' | 'json' | 'stream-json'
  /** Continue most recent conversation */
  continue?: boolean
  /** Resume specific session by ID */
  resume?: string
  /** Working directory (defaults to workspace if set) */
  cwd?: string
  /** Workspace directory for agent isolation */
  workspace?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** MCP config file path (for workflow context) */
  mcpConfigPath?: string
  /** Debug log function (for workflow diagnostics) */
  debugLog?: (message: string) => void
}

export class ClaudeCodeBackend implements Backend {
  readonly type = 'claude' as const
  private options: ClaudeCodeOptions

  constructor(options: ClaudeCodeOptions = {}) {
    this.options = {
      timeout: 300000, // 5 minute default
      ...options,
    }
  }

  /**
   * Set up workspace directory with MCP config
   * Claude uses --mcp-config flag, so we just write the config file
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir

    // Ensure workspace exists
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true })
    }

    // Write MCP config file in workspace
    const mcpConfigPath = join(workspaceDir, 'mcp-config.json')
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2))
    this.options.mcpConfigPath = mcpConfigPath
  }

  /**
   * Run with full workflow context (for multi-agent mode).
   * Sets up workspace, builds prompt, and calls send().
   */
  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const startTime = Date.now()
    const log = this.options.debugLog || (() => {})

    try {
      // Set up workspace with MCP config (HTTP transport)
      const mcpConfig = generateWorkflowMCPConfig(ctx.mcpUrl, ctx.name)
      this.setWorkspace(ctx.workspaceDir, mcpConfig)

      const prompt = buildAgentPrompt(ctx)

      log(`[${ctx.name}] Sending prompt to claude backend (${prompt.length} chars)`)
      log(`[${ctx.name}] System prompt: ${(ctx.agent.resolvedSystemPrompt || '(none)').slice(0, 100)}`)
      log(`[${ctx.name}] Workspace: ${ctx.workspaceDir}`)

      const response = await this.send(prompt, { system: ctx.agent.resolvedSystemPrompt })

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

  async send(message: string, options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message, options)
    // Use workspace as cwd if set
    const cwd = this.options.workspace || this.options.cwd

    try {
      const { stdout } = await execa('claude', args, {
        cwd,
        stdin: 'ignore',
        timeout: this.options.timeout,
      })

      // Parse response based on output format
      if (this.options.outputFormat === 'json') {
        try {
          const parsed = JSON.parse(stdout)
          return {
            content: parsed.content || parsed.result || stdout,
            toolCalls: parsed.toolCalls,
            usage: parsed.usage,
          }
        } catch {
          return { content: stdout.trim() }
        }
      }

      return { content: stdout.trim() }
    } catch (error) {
      if (error instanceof ExecaError) {
        throw new Error(`claude failed (exit ${error.exitCode}): ${error.stderr || error.shortMessage}`)
      }
      throw error
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa('claude', ['--version'], { stdin: 'ignore', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'Claude Code CLI',
      model: this.options.model,
    }
  }

  private buildArgs(message: string, options?: { system?: string }): string[] {
    // -p: non-interactive print mode
    // --dangerously-skip-permissions: auto-approve all operations (required for workflow MCP tools)
    const args: string[] = ['-p', '--dangerously-skip-permissions', message]

    if (this.options.model) {
      args.push('--model', this.options.model)
    }

    if (options?.system || this.options.appendSystemPrompt) {
      const system = options?.system || this.options.appendSystemPrompt
      args.push('--append-system-prompt', system!)
    }

    if (this.options.allowedTools?.length) {
      args.push('--allowed-tools', this.options.allowedTools.join(','))
    }

    if (this.options.outputFormat) {
      args.push('--output-format', this.options.outputFormat)
    }

    if (this.options.continue) {
      args.push('--continue')
    }

    if (this.options.resume) {
      args.push('--resume', this.options.resume)
    }

    if (this.options.mcpConfigPath) {
      args.push('--mcp-config', this.options.mcpConfigPath)
    }

    return args
  }

  /**
   * Set MCP config path (for workflow integration)
   */
  setMcpConfigPath(path: string): void {
    this.options.mcpConfigPath = path
  }
}
