/**
 * Claude Code CLI backend
 * Uses `claude -p` for non-interactive mode
 *
 * @see https://code.claude.com/docs/en/headless
 */

import { spawn } from 'node:child_process'
import type { Backend, BackendResponse } from './types.ts'

export interface ClaudeCliOptions {
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
  /** Working directory */
  cwd?: string
}

export class ClaudeCliBackend implements Backend {
  readonly type = 'claude' as const
  private options: ClaudeCliOptions

  constructor(options: ClaudeCliOptions = {}) {
    this.options = options
  }

  async send(message: string, options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message, options)

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        cwd: this.options.cwd,
        env: process.env,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}: ${stderr}`))
          return
        }

        // Parse response based on output format
        if (this.options.outputFormat === 'json') {
          try {
            const parsed = JSON.parse(stdout)
            resolve({
              content: parsed.content || parsed.result || stdout,
              toolCalls: parsed.toolCalls,
              usage: parsed.usage,
            })
          } catch {
            resolve({ content: stdout.trim() })
          }
        } else {
          resolve({ content: stdout.trim() })
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude: ${err.message}`))
      })
    })
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { stdio: 'pipe' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'Claude Code CLI',
      model: this.options.model,
    }
  }

  private buildArgs(message: string, options?: { system?: string }): string[] {
    const args: string[] = ['-p', message]

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

    return args
  }
}
