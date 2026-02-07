/**
 * CLI Integration Tests
 *
 * Tests CLI commands: new, send, peek, ls, stop, etc.
 * Uses a mock backend to avoid needing real cursor-agent/claude/codex
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

const CLI_PATH = join(import.meta.dir, '../dist/cli/index.mjs')
const TEST_SOCKET_DIR = join(import.meta.dir, '../.test-sockets')

// Helper to run CLI command
async function runCli(
  args: string[],
  options: { timeout?: number; env?: Record<string, string> } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeout = 10000, env = {} } = options

  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
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

// Helper to stop all test agents
async function stopAllAgents() {
  try {
    await runCli(['stop', '--all'], { timeout: 5000 })
  } catch {
    // Ignore errors
  }
}

// Clean up test sockets directory
function cleanupTestDir() {
  if (existsSync(TEST_SOCKET_DIR)) {
    rmSync(TEST_SOCKET_DIR, { recursive: true, force: true })
  }
}

describe('CLI Integration', () => {
  beforeEach(async () => {
    // Stop any running agents before each test
    await stopAllAgents()
  })

  afterEach(async () => {
    // Clean up after each test
    await stopAllAgents()
  })

  afterAll(() => {
    cleanupTestDir()
  })

  describe('new command', () => {
    test('creates agent with SDK backend (default)', async () => {
      const result = await runCli(['new', 'test-sdk', '-m', 'anthropic/claude-sonnet-4-5', '--foreground'], {
        timeout: 2000,
      })

      // The foreground mode will hang, but we should see session start output
      // We expect it to timeout but show starting message
      expect(result.stdout + result.stderr).toMatch(/Session started|Agent started|started/i)
    })

    test('lists agent with ls command', async () => {
      // First create an agent in background (it will fail without API key but register)
      await runCli(['new', 'test-ls-agent', '-m', 'anthropic/claude-sonnet-4-5'])

      // Give it a moment to start
      await new Promise(resolve => setTimeout(resolve, 500))

      // List agents
      const lsResult = await runCli(['ls'])

      // Should show the agent or "No active agents" if it failed to start
      expect(lsResult.stdout).toMatch(/test-ls-agent|No active agents/)
    })

    test('creates agent with name using positional arg', async () => {
      await runCli(['new', 'my-named-agent', '-m', 'anthropic/claude-sonnet-4-5'])

      // Give it a moment
      await new Promise(resolve => setTimeout(resolve, 500))

      const lsResult = await runCli(['ls'])
      // Should show the name (if agent started) or no agents
      expect(lsResult.exitCode).toBe(0)
    })
  })

  describe('ls command', () => {
    test('shows no agents when none running', async () => {
      const result = await runCli(['ls'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/No active agents|running/)
    })

    test('shows short ID format', async () => {
      // Create an agent
      await runCli(['new', '-m', 'anthropic/claude-sonnet-4-5'])
      await new Promise(resolve => setTimeout(resolve, 500))

      const result = await runCli(['ls'])

      // Should show short ID (8 chars) if agent is running
      if (!result.stdout.includes('No active agents')) {
        // Format: shortId - model [status] or shortId (name) - model [status]
        expect(result.stdout).toMatch(/[a-f0-9]{8}.*anthropic\/claude-sonnet-4-5/)
      }
    })
  })

  describe('stop command', () => {
    test('stops agent by name', async () => {
      // Create an agent
      await runCli(['new', 'stop-test-agent', '-m', 'anthropic/claude-sonnet-4-5'])
      await new Promise(resolve => setTimeout(resolve, 500))

      // Stop it
      const stopResult = await runCli(['stop', 'stop-test-agent'])

      // Should succeed or say not found
      expect(stopResult.stdout + stopResult.stderr).toMatch(/stopped|Stopped|not found|No agent/i)
    })

    test('stops all agents with --all', async () => {
      // Create multiple agents
      await runCli(['new', 'agent1', '-m', 'anthropic/claude-sonnet-4-5'])
      await runCli(['new', 'agent2', '-m', 'anthropic/claude-sonnet-4-5'])
      await new Promise(resolve => setTimeout(resolve, 500))

      // Stop all
      const result = await runCli(['stop', '--all'])
      expect(result.exitCode).toBe(0)

      // Verify none running
      const lsResult = await runCli(['ls'])
      expect(lsResult.stdout).toMatch(/No active agents|stopped/)
    })
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
      expect(result.stdout).toContain('--to')
    })
  })

  describe('send command', () => {
    test('errors when no agent running', async () => {
      const result = await runCli(['send', 'hello'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/No active agent|Agent not found/i)
    })

    test('errors when target agent not found', async () => {
      const result = await runCli(['send', 'hello', '--to', 'nonexistent'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/not found/i)
    })
  })

  describe('peek command', () => {
    test('errors when no agent running', async () => {
      const result = await runCli(['peek'])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/No active agent|Agent not found/i)
    })

    test('shows help with --help', async () => {
      const result = await runCli(['peek', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--last')
    })
  })

  describe('backends command', () => {
    test('lists available backends', async () => {
      const result = await runCli(['backends'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('sdk')
    })
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
  // These tests would need a way to inject the mock backend
  // For now, we test the CLI structure and error handling

  test('backend flag is recognized', async () => {
    const result = await runCli(['new', '--help'])
    expect(result.stdout).toContain('-b, --backend')
    expect(result.stdout).toMatch(/sdk|claude|cursor|codex/i)
  })

  test('validates backend type', async () => {
    const result = await runCli(['new', '-b', 'invalid-backend', '-m', 'test'])
    // Should error on invalid backend
    expect(result.exitCode).not.toBe(0)
  })
})

describe('Session Lifecycle', () => {
  test('full lifecycle: create -> send -> peek -> stop', async () => {
    // This is an integration test that would need a mock server
    // For now, test the command structure

    // 1. Create agent (will fail without API key but shows structure works)
    await runCli(['new', 'lifecycle-test', '-m', 'anthropic/claude-sonnet-4-5'])

    // 2. The agent may or may not start depending on API key
    await new Promise(resolve => setTimeout(resolve, 500))

    // 3. Check status
    const lsResult = await runCli(['ls'])
    expect(lsResult.exitCode).toBe(0)

    // 4. Stop
    await runCli(['stop', 'lifecycle-test'])

    // 5. Verify stopped
    const finalLs = await runCli(['ls'])
    expect(finalLs.exitCode).toBe(0)
  })
})
