/**
 * Cursor CLI backend
 * Uses `cursor-agent -p` or `agent chat` for non-interactive mode
 *
 * @see https://cursor.com/docs/cli/headless
 */

import { spawn } from 'node:child_process'
import type { Backend, BackendResponse } from './types.ts'

export interface CursorCliOptions {
  /** Model to use */
  model?: string
  /** Working directory */
  cwd?: string
  /** Use 'agent' command instead of 'cursor-agent' */
  useAgentCommand?: boolean
  /** Timeout in milliseconds (cursor CLI can hang) */
  timeout?: number
}

export class CursorCliBackend implements Backend {
  readonly type = 'cursor' as const
  private options: CursorCliOptions

  constructor(options: CursorCliOptions = {}) {
    this.options = {
      timeout: 120000, // 2 minute default timeout
      ...options,
    }
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const { command, args } = this.buildCommand(message)

    return new Promise((resolve, reject) => {
      // IMPORTANT: stdin must be 'ignore' to prevent cursor-agent from hanging
      // See: https://forum.cursor.com/t/node-js-spawn-with-cursor-agent-hangs-and-exits-with-code-143-after-timeout/133709
      const proc = spawn(command, args, {
        cwd: this.options.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false

      // Set timeout (cursor CLI can hang indefinitely)
      const timer = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
      }, this.options.timeout)

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        clearTimeout(timer)

        if (timedOut) {
          reject(new Error(`cursor-agent timed out after ${this.options.timeout}ms`))
          return
        }

        if (code !== 0 && code !== null) {
          reject(new Error(`cursor-agent exited with code ${code}: ${stderr}`))
          return
        }

        resolve({ content: stdout.trim() })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn cursor-agent: ${err.message}`))
      })
    })
  }

  async isAvailable(): Promise<boolean> {
    // Try both 'agent' and 'cursor-agent' commands
    const commands = ['cursor-agent', 'agent']

    for (const cmd of commands) {
      const available = await this.checkCommand(cmd)
      if (available) return true
    }

    return false
  }

  private async checkCommand(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(command, ['--version'], { stdio: 'pipe' })
      const timer = setTimeout(() => {
        proc.kill()
        resolve(false)
      }, 5000)

      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
      proc.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'Cursor Agent CLI',
      model: this.options.model,
    }
  }

  private buildCommand(message: string): { command: string; args: string[] } {
    if (this.options.useAgentCommand) {
      // Use 'agent chat' command
      return {
        command: 'agent',
        args: ['chat', message],
      }
    }

    // Use 'cursor-agent -p' command
    const args: string[] = ['-p', message]

    if (this.options.model) {
      args.push('--model', this.options.model)
    }

    return { command: 'cursor-agent', args }
  }
}
