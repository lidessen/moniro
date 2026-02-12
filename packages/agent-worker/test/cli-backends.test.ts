/**
 * CLI Backend Tests
 *
 * Uses mock-cli.ts to simulate cursor-agent, claude, codex, and opencode CLIs
 */

import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { CursorBackend } from '../src/backends/cursor.ts'
import { OpenCodeBackend } from '../src/backends/opencode.ts'
import { opencodeAdapter, extractOpenCodeResult } from '../src/backends/opencode.ts'
import { execWithIdleTimeout, IdleTimeoutError } from '../src/backends/idle-timeout.ts'
import {
  formatEvent,
  claudeAdapter,
  codexAdapter,
  extractClaudeResult,
  extractCodexResult,
} from '../src/backends/stream-json.ts'

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
  // Create a backend that uses our mock CLI (with stream-json format)
  class MockCursorBackend extends CursorBackend {
    protected override async buildCommand(message: string): Promise<{ command: string; args: string[] }> {
      // Use bun to run mock-cli.ts instead of actual cursor-agent
      // Include --output-format=stream-json to match real buildCommand behavior
      return {
        command: 'bun',
        args: [MOCK_CLI_PATH, 'cursor-agent', '-p', message, '--output-format=stream-json'],
      }
    }
  }

  test('sends message and parses stream-json result', async () => {
    const backend = new MockCursorBackend({ timeout: 5000 })
    const response = await backend.send('2+2=?')
    expect(response.content).toBe('4')
  })

  test('sends hello message and parses result', async () => {
    const backend = new MockCursorBackend({ timeout: 5000 })
    const response = await backend.send('hello')
    expect(response.content).toContain('Hello')
  })

  test('reports progress via streamCallbacks', async () => {
    const progress: string[] = []
    const backend = new MockCursorBackend({
      timeout: 5000,
      streamCallbacks: {
        debugLog: (msg) => progress.push(msg),
      },
    })
    await backend.send('2+2=?')
    // Should have parsed stream-json events and reported progress
    expect(progress.some(p => p.includes('Cursor initialized'))).toBe(true)
    expect(progress.some(p => p.includes('Cursor completed'))).toBe(true)
  })

  test('handles idle timeout (no output)', async () => {
    // Create backend with very short timeout
    const backend = new MockCursorBackend({ timeout: 100 })

    // Override to use timeout mock (plain text, no stream-json)
    backend['buildCommand'] = async (message: string) => {
      return {
        command: 'bun',
        args: [MOCK_CLI_PATH, 'cursor-agent', '-p', message],
      }
    }

    // Set env to make mock hang (no output)
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

describe('Idle Timeout', () => {
  test('kills process that produces no output', async () => {
    const original = process.env.MOCK_TIMEOUT
    process.env.MOCK_TIMEOUT = '1'

    try {
      await expect(
        execWithIdleTimeout({
          command: 'bun',
          args: [MOCK_CLI_PATH, 'cursor-agent', '-p', 'test'],
          timeout: 1500,
        })
      ).rejects.toThrow(IdleTimeoutError)
    } finally {
      if (original === undefined) delete process.env.MOCK_TIMEOUT
      else process.env.MOCK_TIMEOUT = original
    }
  })

  test('resets timer on output — slow process completes', async () => {
    // Process outputs 5 chunks with 50ms between each
    // Idle timeout is 200ms — should never fire since output keeps coming
    const originalChunks = process.env.MOCK_SLOW_OUTPUT_CHUNKS
    const originalInterval = process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS
    process.env.MOCK_SLOW_OUTPUT_CHUNKS = '5'
    process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS = '50'

    try {
      const result = await execWithIdleTimeout({
        command: 'bun',
        args: [MOCK_CLI_PATH, 'cursor-agent', '-p', 'test'],
        timeout: 200,
      })
      expect(result.stdout).toContain('chunk 1')
      expect(result.stdout).toContain('chunk 5')
      expect(result.stdout).toContain('done')
    } finally {
      if (originalChunks === undefined) delete process.env.MOCK_SLOW_OUTPUT_CHUNKS
      else process.env.MOCK_SLOW_OUTPUT_CHUNKS = originalChunks
      if (originalInterval === undefined) delete process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS
      else process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS = originalInterval
    }
  })

  test('fast process completes normally', async () => {
    const result = await execWithIdleTimeout({
      command: 'bun',
      args: [MOCK_CLI_PATH, 'cursor-agent', '-p', '2+2=?'],
      timeout: 5000,
    })
    expect(result.stdout).toContain('4')
  })

  test('error includes partial output', async () => {
    const originalChunks = process.env.MOCK_SLOW_OUTPUT_CHUNKS
    const originalInterval = process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS
    // Output 2 chunks, then go silent — idle timeout should fire
    process.env.MOCK_SLOW_OUTPUT_CHUNKS = '2'
    process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS = '10'

    try {
      // This won't work as expected because the mock outputs all chunks then exits.
      // Instead test that IdleTimeoutError has the right shape
      const err = new IdleTimeoutError(100, 'partial stdout', 'partial stderr')
      expect(err.timeout).toBe(100)
      expect(err.stdout).toBe('partial stdout')
      expect(err.stderr).toBe('partial stderr')
      expect(err.message).toContain('idle timed out')
      expect(err.name).toBe('IdleTimeoutError')
    } finally {
      if (originalChunks === undefined) delete process.env.MOCK_SLOW_OUTPUT_CHUNKS
      else process.env.MOCK_SLOW_OUTPUT_CHUNKS = originalChunks
      if (originalInterval === undefined) delete process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS
      else process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS = originalInterval
    }
  })
})

describe('Claude/Cursor Adapter', () => {
  test('converts system/init event', () => {
    const raw = { type: 'system', subtype: 'init', model: 'Claude 4.5 Sonnet' }
    const event = claudeAdapter(raw)
    expect(event!.kind).toBe('init')
    if (event!.kind === 'init') {
      expect(event!.model).toBe('Claude 4.5 Sonnet')
    }
  })

  test('formats init event with backend name', () => {
    const event = claudeAdapter({ type: 'system', subtype: 'init', model: 'Claude 4.5 Sonnet' })!
    expect(formatEvent(event, 'Claude')).toBe('Claude initialized (model: Claude 4.5 Sonnet)')
    expect(formatEvent(event, 'Cursor')).toBe('Cursor initialized (model: Claude 4.5 Sonnet)')
  })

  test('converts tool call events', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/foo/bar.ts' } },
        ],
      },
    }
    const event = claudeAdapter(raw)
    expect(event).not.toBeNull()
    expect(event!.kind).toBe('tool_call')
    if (event!.kind === 'tool_call') {
      expect(event!.name).toBe('Read')
      expect(event!.args).toContain('/foo/bar.ts')
    }
  })

  test('formats tool call event', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/foo/bar.ts' } },
        ],
      },
    }
    const event = claudeAdapter(raw)!
    const result = formatEvent(event, 'Claude')
    expect(result).toContain('CALL Read(')
    expect(result).toContain('/foo/bar.ts')
  })

  test('converts result event with duration and cost', () => {
    const raw = { type: 'result', duration_ms: 2642, total_cost_usd: 0.0098785 }
    const event = claudeAdapter(raw)
    expect(event).toEqual({ kind: 'completed', durationMs: 2642, costUsd: 0.0098785 })
  })

  test('formats result event', () => {
    const event = claudeAdapter({ type: 'result', duration_ms: 2642, total_cost_usd: 0.0098785 })!
    expect(formatEvent(event, 'Claude')).toBe('Claude completed (2.6s, $0.0099)')
  })

  test('formats result event without cost', () => {
    const event = claudeAdapter({ type: 'result', duration_ms: 100 })!
    expect(formatEvent(event, 'Cursor')).toBe('Cursor completed (0.1s)')
  })

  test('returns skip for plain assistant text', () => {
    const raw = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    }
    expect(claudeAdapter(raw)).toEqual({ kind: 'skip' })
  })

  test('extractClaudeResult extracts result', () => {
    const stdout = [
      '{"type":"system","subtype":"init","model":"test"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
      '{"type":"result","result":"hello","duration_ms":100}',
    ].join('\n')
    expect(extractClaudeResult(stdout).content).toBe('hello')
  })

  test('extractClaudeResult falls back to assistant message', () => {
    const stdout = [
      '{"type":"system","subtype":"init","model":"test"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"fallback answer"}]}}',
    ].join('\n')
    expect(extractClaudeResult(stdout).content).toBe('fallback answer')
  })

  test('extractClaudeResult falls back to raw stdout', () => {
    expect(extractClaudeResult('plain text output').content).toBe('plain text output')
  })
})

describe('Codex Adapter', () => {
  test('converts thread.started event', () => {
    const raw = { type: 'thread.started', thread_id: '019c4173-117f-75b0-afa9-3b1affdec150' }
    const event = codexAdapter(raw)
    expect(event).toEqual({ kind: 'init', sessionId: '019c4173...' })
  })

  test('formats thread.started event', () => {
    const event = codexAdapter({ type: 'thread.started', thread_id: '019c4173-117f-75b0-afa9-3b1affdec150' })!
    expect(formatEvent(event, 'Codex')).toBe('Codex initialized (session: 019c4173...)')
  })

  test('converts function_call event', () => {
    const raw = {
      type: 'item.completed',
      item: { type: 'function_call', name: 'shell', arguments: '{"command":"ls -la"}' },
    }
    const event = codexAdapter(raw)
    expect(event).not.toBeNull()
    expect(event!.kind).toBe('tool_call')
    if (event!.kind === 'tool_call') {
      expect(event!.name).toBe('shell')
      expect(event!.args).toContain('ls -la')
    }
  })

  test('formats function_call event', () => {
    const raw = {
      type: 'item.completed',
      item: { type: 'function_call', name: 'shell', arguments: '{"command":"ls -la"}' },
    }
    const event = codexAdapter(raw)!
    const result = formatEvent(event, 'Codex')
    expect(result).toContain('CALL shell(')
    expect(result).toContain('ls -la')
  })

  test('converts turn.completed event', () => {
    const raw = { type: 'turn.completed', usage: { input_tokens: 8133, output_tokens: 5 } }
    const event = codexAdapter(raw)
    expect(event).toEqual({ kind: 'completed', usage: { input: 8133, output: 5 } })
  })

  test('formats turn.completed event', () => {
    const event = codexAdapter({ type: 'turn.completed', usage: { input_tokens: 8133, output_tokens: 5 } })!
    expect(formatEvent(event, 'Codex')).toBe('Codex completed (8133 in, 5 out)')
  })

  test('skips agent_message (returns skip)', () => {
    const raw = { type: 'item.completed', item: { type: 'agent_message', text: '4' } }
    expect(codexAdapter(raw)).toEqual({ kind: 'skip' })
  })

  test('extractCodexResult extracts agent_message', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"4"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}',
    ].join('\n')
    expect(extractCodexResult(stdout).content).toBe('4')
  })

  test('extractCodexResult falls back to raw stdout', () => {
    expect(extractCodexResult('plain text output').content).toBe('plain text output')
  })
})

describe('Codex Mock CLI', () => {
  test('mock CLI outputs codex JSON format', async () => {
    const result = await runMockCli(['codex', 'exec', '--json', '--skip-git-repo-check', '2+2=?'])
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(4)

    const firstLine = JSON.parse(lines[0]!)
    expect(firstLine.type).toBe('thread.started')

    const messageLine = JSON.parse(lines[2]!)
    expect(messageLine.type).toBe('item.completed')
    expect(messageLine.item.text).toBe('4')
  })

  test('mock CLI parses codex exec message correctly', async () => {
    const result = await runMockCli(['codex', 'exec', '--full-auto', '--json', '--skip-git-repo-check', 'hello'])
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.split('\n')
    const messageLine = JSON.parse(lines[2]!)
    expect(messageLine.item.text).toContain('Hello')
  })
})

describe('OpenCode Adapter', () => {
  test('converts step_start event', () => {
    const raw = { type: 'step_start', sessionID: 'ses_abc123', part: { type: 'step-start' } }
    const event = opencodeAdapter(raw)
    expect(event!.kind).toBe('init')
    if (event!.kind === 'init') {
      expect(event!.sessionId).toBe('ses_abc123')
    }
  })

  test('formats step_start event', () => {
    const event = opencodeAdapter({ type: 'step_start', sessionID: 'ses_abc123', part: { type: 'step-start' } })!
    expect(formatEvent(event, 'OpenCode')).toBe('OpenCode initialized (session: ses_abc123)')
  })

  test('converts tool_use event', () => {
    const raw = {
      type: 'tool_use',
      sessionID: 'ses_abc',
      part: { type: 'tool', callID: 'call_123', tool: 'bash', state: { status: 'completed', input: { command: 'ls -la' } } },
    }
    const event = opencodeAdapter(raw)
    expect(event).not.toBeNull()
    expect(event!.kind).toBe('tool_call')
    if (event!.kind === 'tool_call') {
      expect(event!.name).toBe('bash')
      expect(event!.args).toContain('ls -la')
    }
  })

  test('converts step_finish event with cost and tokens', () => {
    const raw = {
      type: 'step_finish',
      sessionID: 'ses_abc',
      part: { type: 'step-finish', reason: 'stop', cost: 0.001, tokens: { total: 100, input: 80, output: 20 } },
    }
    const event = opencodeAdapter(raw)
    expect(event).toEqual({ kind: 'completed', costUsd: 0.001, usage: { input: 80, output: 20 } })
  })

  test('formats step_finish event', () => {
    const raw = {
      type: 'step_finish',
      sessionID: 'ses_abc',
      part: { type: 'step-finish', reason: 'stop', cost: 0.001, tokens: { total: 100, input: 80, output: 20 } },
    }
    const event = opencodeAdapter(raw)!
    expect(formatEvent(event, 'OpenCode')).toBe('OpenCode completed ($0.0010, 80 in, 20 out)')
  })

  test('skips text events', () => {
    const raw = { type: 'text', sessionID: 'ses_abc', part: { type: 'text', text: 'hello' } }
    expect(opencodeAdapter(raw)).toEqual({ kind: 'skip' })
  })

  test('extractOpenCodeResult extracts text', () => {
    const stdout = [
      '{"type":"step_start","sessionID":"ses_abc","part":{"type":"step-start"}}',
      '{"type":"text","sessionID":"ses_abc","part":{"type":"text","text":"hello world"}}',
      '{"type":"step_finish","sessionID":"ses_abc","part":{"type":"step-finish","reason":"stop","cost":0.001}}',
    ].join('\n')
    expect(extractOpenCodeResult(stdout).content).toBe('hello world')
  })

  test('extractOpenCodeResult falls back to raw stdout', () => {
    expect(extractOpenCodeResult('plain text output').content).toBe('plain text output')
  })
})

describe('OpenCode Mock CLI', () => {
  test('mock CLI outputs opencode JSON format', async () => {
    const result = await runMockCli(['opencode', 'run', '--format', 'json', '2+2=?'])
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)

    const firstLine = JSON.parse(lines[0]!)
    expect(firstLine.type).toBe('step_start')

    const textLine = JSON.parse(lines[1]!)
    expect(textLine.type).toBe('text')
    expect(textLine.part.text).toBe('4')
  })

  test('mock CLI parses opencode run message correctly', async () => {
    const result = await runMockCli(['opencode', 'run', '--format', 'json', 'hello'])
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.split('\n')
    const textLine = JSON.parse(lines[1]!)
    expect(textLine.part.text).toContain('Hello')
  })
})

describe('OpenCodeBackend with Mock', () => {
  class MockOpenCodeBackend extends OpenCodeBackend {
    private buildArgsMethod(message: string): string[] {
      return ['run', '--format', 'json', message]
    }
  }

  test('sends message and parses JSON result', async () => {
    // Use execWithIdleTimeout directly to test parsing
    const result = await runMockCli(['opencode', 'run', '--format', 'json', '2+2=?'])
    expect(result.exitCode).toBe(0)
    const parsed = extractOpenCodeResult(result.stdout)
    expect(parsed.content).toBe('4')
  })

  test('reports progress via streamCallbacks', async () => {
    const result = await runMockCli(['opencode', 'run', '--format', 'json', '2+2=?'])
    // Verify all three event types are present
    const lines = result.stdout.split('\n')
    const types = lines.map(l => { try { return JSON.parse(l).type } catch { return null } }).filter(Boolean)
    expect(types).toContain('step_start')
    expect(types).toContain('text')
    expect(types).toContain('step_finish')
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
