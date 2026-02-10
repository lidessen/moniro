/**
 * CLI Integration Tests
 *
 * Tests CLI commands against the new 9-endpoint daemon architecture.
 * Agent lifecycle tests require a running daemon and are marked accordingly.
 */

import { describe, test, expect, afterAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const CLI_PATH = join(import.meta.dir, '../src/cli/index.ts')

// Helper to run CLI command
async function runCli(
  args: string[],
  options: { timeout?: number; env?: Record<string, string> } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeout = 10000, env = {} } = options

  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
    }, timeout)

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 })
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: err.message, exitCode: -1 })
    })
  })
}

// Helper to stop daemon
async function stopDaemon() {
  try {
    await runCli(['stop', '--all'], { timeout: 3000 })
  } catch {
    // Ignore — daemon may not be running
  }
}

describe('CLI Integration', () => {
  afterAll(async () => {
    await stopDaemon()
  })

  describe('help and version', () => {
    test('shows help', async () => {
      const result = await runCli(['--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage')
      expect(result.stdout).toContain('Commands')
    })

    test('shows version', async () => {
      const result = await runCli(['--version'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
    })

    test('shows help for new command', async () => {
      const result = await runCli(['new', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--model')
      expect(result.stdout).toContain('--backend')
    })

    test('shows help for send command', async () => {
      const result = await runCli(['send', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('<target>')
      expect(result.stdout).toContain('<message>')
    })

    test('shows help for daemon command', async () => {
      const result = await runCli(['daemon', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--port')
      expect(result.stdout).toContain('--host')
    })

    test('shows help for run command', async () => {
      const result = await runCli(['run', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('<agent>')
      expect(result.stdout).toContain('<message>')
    })

    test('shows help for serve command', async () => {
      const result = await runCli(['serve', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('<agent>')
      expect(result.stdout).toContain('<message>')
    })
  })

  describe('ls command', () => {
    test('shows no daemon when none running', async () => {
      // Stop any running daemon first
      await stopDaemon()
      await new Promise(resolve => setTimeout(resolve, 200))

      const result = await runCli(['ls'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/No daemon running|No agents/)
    })
  })

  describe('status command', () => {
    test('shows not running when no daemon', async () => {
      await stopDaemon()
      await new Promise(resolve => setTimeout(resolve, 200))

      const result = await runCli(['status'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('not running')
    })
  })

  describe('send command', () => {
    test('posts to channel successfully', async () => {
      const result = await runCli(['send', '@global', 'hello'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/broadcast/)
    })
  })

  describe('peek command', () => {
    test('shows empty channel when no messages', async () => {
      const result = await runCli(['peek', `@empty-${Date.now()}`])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/No messages/)
    })

    test('shows help with --help', async () => {
      const result = await runCli(['peek', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--last')
    })
  })

  describe('backends command', () => {
    test('lists available backends', async () => {
      const result = await runCli(['backends'], { timeout: 15000 })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('default')
    }, 20000)
  })

  describe('providers command', () => {
    test('lists available providers', async () => {
      const result = await runCli(['providers'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('anthropic')
    })
  })
})

describe('CLI with Mock Backend', () => {
  test('backend flag is recognized', async () => {
    const result = await runCli(['new', '--help'])
    expect(result.stdout).toContain('-b, --backend')
    expect(result.stdout).toMatch(/sdk|claude|cursor|codex/i)
  })

  test('validates backend type', async () => {
    const result = await runCli(['new', 'test-agent', '-b', 'invalid-backend', '-m', 'test'])
    expect(result.exitCode).not.toBe(0)
  })
})
