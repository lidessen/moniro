/**
 * Cursor CLI backend
 * Uses `cursor-agent -p` for non-interactive mode
 *
 * MCP Configuration:
 * Cursor uses project-level MCP config via .cursor/mcp.json in the workspace.
 * Use setWorkspace() to set up a dedicated workspace with MCP config.
 *
 * @see https://docs.cursor.com/context/model-context-protocol
 */

import { execa, ExecaError } from 'execa'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Backend, BackendResponse } from './types.ts'
import type { AgentRunContext, AgentRunResult } from '../workflow/controller/types.ts'
import { runCLIBackend } from './cli-run.ts'

export interface CursorOptions {
  /** Model to use */
  model?: string
  /** Working directory (defaults to workspace if set, otherwise cwd) */
  cwd?: string
  /** Workspace directory for agent isolation (contains .cursor/mcp.json) */
  workspace?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Debug log function (for workflow diagnostics) */
  debugLog?: (message: string) => void
}

export class CursorBackend implements Backend {
  readonly type = 'cursor' as const
  private options: CursorOptions

  constructor(options: CursorOptions = {}) {
    this.options = {
      timeout: 120000, // 2 minute default
      ...options,
    }
  }

  /**
   * Set up workspace directory with MCP config
   * Creates .cursor/mcp.json in the workspace
   */
  setWorkspace(workspaceDir: string, mcpConfig: { mcpServers: Record<string, unknown> }): void {
    this.options.workspace = workspaceDir

    // Create .cursor directory
    const cursorDir = join(workspaceDir, '.cursor')
    if (!existsSync(cursorDir)) {
      mkdirSync(cursorDir, { recursive: true })
    }

    // Write MCP config
    const mcpConfigPath = join(cursorDir, 'mcp.json')
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2))
  }

  /**
   * Run with full workflow context (for multi-agent mode).
   * Sets up workspace, builds prompt, and calls send().
   */
  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    return runCLIBackend(this, ctx, 'cursor', this.options.debugLog)
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const { command, args } = this.buildCommand(message)
    // Use workspace as cwd if set, otherwise fall back to cwd option
    const cwd = this.options.workspace || this.options.cwd

    try {
      // IMPORTANT: stdin must be 'ignore' to prevent cursor-agent from hanging
      // See: https://forum.cursor.com/t/node-js-spawn-with-cursor-agent-hangs-and-exits-with-code-143-after-timeout/133709
      const { stdout } = await execa(command, args, {
        cwd,
        stdin: 'ignore',
        timeout: this.options.timeout,
      })

      return { content: stdout.trim() }
    } catch (error) {
      if (error instanceof ExecaError) {
        if (error.timedOut) {
          throw new Error(`cursor-agent timed out after ${this.options.timeout}ms`)
        }
        throw new Error(`cursor-agent failed (exit ${error.exitCode}): ${error.stderr || error.shortMessage}`)
      }
      throw error
    }
  }

  async isAvailable(): Promise<boolean> {
    // Try both 'agent' and 'cursor-agent' commands
    const commands = ['cursor-agent', 'agent']

    for (const cmd of commands) {
      try {
        await execa(cmd, ['--version'], { stdin: 'ignore', timeout: 5000 })
        return true
      } catch {
        // Try next command
      }
    }

    return false
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'Cursor Agent CLI',
      model: this.options.model,
    }
  }

  protected buildCommand(message: string): { command: string; args: string[] } {
    // Use 'cursor-agent -p' command
    // --force: auto-approve all operations (required for non-interactive)
    // --approve-mcps: auto-approve MCP servers (required for workflow MCP tools)
    const args: string[] = ['-p', '--force', '--approve-mcps', message]

    if (this.options.model) {
      args.push('--model', this.options.model)
    }

    return { command: 'cursor-agent', args }
  }
}
