/**
 * OpenAI Codex CLI backend
 * Uses `codex exec` for non-interactive mode
 *
 * @see https://developers.openai.com/codex/noninteractive/
 */

import { spawn } from 'node:child_process'
import type { Backend, BackendResponse } from './types.ts'

export interface CodexCliOptions {
  /** Model to use (e.g., 'gpt-5.2-codex') */
  model?: string
  /** Output as JSON events */
  json?: boolean
  /** Working directory */
  cwd?: string
  /** Skip git repo check */
  skipGitRepoCheck?: boolean
  /** Approval mode: 'suggest' | 'auto-edit' | 'full-auto' */
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto'
  /** Resume a previous session */
  resume?: string
}

export class CodexCliBackend implements Backend {
  readonly type = 'codex' as const
  private options: CodexCliOptions

  constructor(options: CodexCliOptions = {}) {
    this.options = options
  }

  async send(message: string, _options?: { system?: string }): Promise<BackendResponse> {
    const args = this.buildArgs(message)

    return new Promise((resolve, reject) => {
      const proc = spawn('codex', args, {
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
          reject(new Error(`codex exited with code ${code}: ${stderr}`))
          return
        }

        // Parse response based on output format
        if (this.options.json) {
          try {
            // Codex outputs newline-delimited JSON events
            const lines = stdout.trim().split('\n')
            const lastEvent = JSON.parse(lines[lines.length - 1])
            resolve({
              content: lastEvent.message || lastEvent.content || stdout,
              toolCalls: lastEvent.toolCalls,
              usage: lastEvent.usage,
            })
          } catch {
            resolve({ content: stdout.trim() })
          }
        } else {
          resolve({ content: stdout.trim() })
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn codex: ${err.message}`))
      })
    })
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('codex', ['--version'], { stdio: 'pipe' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  getInfo(): { name: string; version?: string; model?: string } {
    return {
      name: 'OpenAI Codex CLI',
      model: this.options.model,
    }
  }

  private buildArgs(message: string): string[] {
    const args: string[] = ['exec', message]

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
