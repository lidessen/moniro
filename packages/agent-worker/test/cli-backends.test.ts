/**
 * CLI Backend Tests
 *
 * Uses mock-cli.ts to simulate cursor-agent, claude, and codex CLIs
 */

import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { CursorBackend } from '../src/backends/cursor.ts'

const MOCK_CLI_PATH = join(import.meta.dir, 'mock-cli.ts')

// Helper to run mock CLI directly
async function runMockCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', [MOCK_CLI_PATH, ...args], {
      env: { ...process.env, ...env },
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

    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 })
    })
  })
}

describe('Mock CLI', () => {
  test('responds to --version', async () => {
    const result = await runMockCli(['cursor-agent', '--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('1.0.0')
  })

  test('responds to simple message', async () => {
    const result = await runMockCli(['cursor-agent', '-p', '2+2=?'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('4')
  })

  test('handles custom response via env', async () => {
    const result = await runMockCli(['cursor-agent', '-p', 'anything'], {
      MOCK_RESPONSE: 'Custom response here',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Custom response here')
  })

  test('simulates failure', async () => {
    const result = await runMockCli(['cursor-agent', '-p', 'test'], {
      MOCK_FAIL: '1',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('simulated failure')
  })

  test('outputs JSON format', async () => {
    const result = await runMockCli(['cursor-agent', '-p', '2+2=?', '--output-format=stream-json'])
    expect(result.exitCode).toBe(0)

    const lines = result.stdout.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(4)

    const lastLine = JSON.parse(lines[lines.length - 1]!)
    expect(lastLine.type).toBe('result')
    expect(lastLine.result).toBe('4')
  })
})

describe('CursorBackend with Mock', () => {
  // Create a backend that uses our mock CLI
  class MockCursorBackend extends CursorBackend {
    protected override buildCommand(message: string): { command: string; args: string[] } {
      // Use bun to run mock-cli.ts instead of actual cursor-agent
      return {
        command: 'bun',
        args: [MOCK_CLI_PATH, 'cursor-agent', '-p', message],
      }
    }
  }

  test('sends message and gets response', async () => {
    const backend = new MockCursorBackend({ timeout: 5000 })
    const response = await backend.send('2+2=?')
    expect(response.content).toBe('4')
  })

  test('sends hello message', async () => {
    const backend = new MockCursorBackend({ timeout: 5000 })
    const response = await backend.send('hello')
    expect(response.content).toContain('Hello')
  })

  test('handles timeout', async () => {
    // Create backend with very short timeout
    const backend = new MockCursorBackend({ timeout: 100 })

    // Override to use timeout mock
    const originalBuild = backend['buildCommand'].bind(backend)
    backend['buildCommand'] = (message: string) => {
      originalBuild(message)
      return {
        command: 'bun',
        args: [MOCK_CLI_PATH, 'cursor-agent', '-p', message],
      }
    }

    // Set env to make mock timeout
    const originalEnv = process.env.MOCK_TIMEOUT
    process.env.MOCK_TIMEOUT = '1'

    try {
      await expect(backend.send('test')).rejects.toThrow(/timed out/)
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MOCK_TIMEOUT
      } else {
        process.env.MOCK_TIMEOUT = originalEnv
      }
    }
  })
})

describe('Backend Integration', () => {
  test('mock CLI behaves like real cursor-agent', async () => {
    // Test the exact command that CursorBackend would build
    const result = await runMockCli(['cursor-agent', '-p', 'What is 2+2?'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('4')
  })

  test('mock CLI handles various message formats', async () => {
    const testCases = [
      { message: '2+2=?', expected: '4' },
      { message: 'hello world', expected: 'Hello' },
      { message: 'random question', expected: 'Mock response to:' },
    ]

    for (const { message, expected } of testCases) {
      const result = await runMockCli(['cursor-agent', '-p', message])
      expect(result.stdout).toContain(expected)
    }
  })
})
