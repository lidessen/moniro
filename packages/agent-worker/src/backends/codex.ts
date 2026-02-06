/**
 * OpenAI Codex CLI backend
 * Uses `codex exec` for non-interactive mode
 *
 * MCP Configuration:
 * Codex uses project-level MCP config. Use setWorkspace() to set up
 * a dedicated workspace directory with .codex/config.yaml for MCP settings.
 *
 * @see https://github.com/openai/codex
 */

import { execa, ExecaError } from 'execa'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import type { Backend, BackendResponse } from './types.ts'
import type { AgentRunContext, AgentRunResult } from '../workflow/controller/types.ts'
import { buildAgentPrompt } from '../workflow/controller/prompt.ts'
import { generateWorkflowMCPConfig } from '../workflow/controller/mcp-config.ts'

export interface CodexOptions {
  /** Model to use (e.g., 'gpt-5.2-codex') */
  model?: string
  /** Output as JSON events */
  json?: boolean
  /** Working directory (defaults to workspace if set) */
  cwd?: string
  /** Workspace directory for agent isolation */
  workspace?: string
  /** Skip git repo check */
  skipGitRepoCheck?: boolean
  /** Approval mode: 'suggest' | 'auto-edit' | 'full-auto' */
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto'
  /** Resume a previous session */
  resume?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Debug log function (for workflow diagnostics) */
  debugLog?: (message: string) => void
}

export class CodexBackend implements Backend {
  readonly type = 'codex' as const
  private options: CodexOptions

  constructor(options: CodexOptions = {}) {
    this.options = {
      timeout: 300000, // 5 minute default
      ...options,
    }
  }

  /**
   * Set up workspace directory with MCP config
   * Creates .codex/config.yaml in the workspace with MCP server config
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir

    // Create .codex directory
    const codexDir = join(workspaceDir, '.codex')
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true })
    }

    // Convert MCP config to codex format and write as YAML
    // Codex uses mcp_servers in its config
    const codexConfig = {
      mcp_servers: mcpConfig.mcpServers,
    }
    const configPath = join(codexDir, 'config.yaml')
    writeFileSync(configPath, yamlStringify(codexConfig))
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

      log(`[${ctx.name}] Sending prompt to codex backend (${prompt.length} chars)`)
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

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message)
    // Use workspace as cwd if set
    const cwd = this.options.workspace || this.options.cwd

    try {
      const { stdout } = await execa('codex', args, {
        cwd,
        stdin: 'ignore',
        timeout: this.options.timeout,
      })

      // Parse response based on output format
      if (this.options.json) {
        try {
          // Codex outputs newline-delimited JSON events
          const lines = stdout.trim().split('\n')
          const lastLine = lines[lines.length - 1]
          if (!lastLine) {
            return { content: stdout.trim() }
          }
          const lastEvent = JSON.parse(lastLine)
          return {
            content: lastEvent.message || lastEvent.content || stdout,
            toolCalls: lastEvent.toolCalls,
            usage: lastEvent.usage,
          }
        } catch {
          return { content: stdout.trim() }
        }
      }

      return { content: stdout.trim() }
    } catch (error) {
      if (error instanceof ExecaError) {
        throw new Error(`codex failed (exit ${error.exitCode}): ${error.stderr || error.shortMessage}`)
      }
      throw error
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa('codex', ['--version'], { stdin: 'ignore', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'OpenAI Codex CLI',
      model: this.options.model,
    }
  }

  private buildArgs(message: string): string[] {
    // exec: non-interactive mode
    // --dangerously-bypass-approvals-and-sandbox: auto-approve all operations (required for workflow MCP tools)
    const args: string[] = ['exec', '--dangerously-bypass-approvals-and-sandbox', message]

    if (this.options.model) {
      args.push('--model', this.options.model)
    }

    if (this.options.json) {
      args.push('--json')
    }

    if (this.options.skipGitRepoCheck) {
      args.push('--skip-git-repo-check')
    }

    if (this.options.approvalMode) {
      args.push('--approval-mode', this.options.approvalMode)
    }

    if (this.options.resume) {
      args.push('--resume', this.options.resume)
    }

    return args
  }
}
