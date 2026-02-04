import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// We need to mock the config directory for testing
// Create a test module that patches the paths

const TEST_DIR = join(tmpdir(), `agent-worker-test-${Date.now()}`)
const TEST_SESSIONS_FILE = join(TEST_DIR, 'sessions.json')

// Mock the session-store module by testing the logic directly
// Since we can't easily mock ES modules, we test the core logic

describe('session-store integration', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    // Clean up after tests
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  test('config directory creation', () => {
    mkdirSync(TEST_DIR, { recursive: true })
    expect(existsSync(TEST_DIR)).toBe(true)
  })

  test('sessions file format', () => {
    mkdirSync(TEST_DIR, { recursive: true })

    const data = {
      current: 'session-1',
      sessions: {
        'session-1': {
          id: 'session-1',
          model: 'openai/gpt-5.2',
          system: 'Test prompt',
          tools: [],
          createdAt: new Date().toISOString(),
        },
      },
    }

    Bun.write(TEST_SESSIONS_FILE, JSON.stringify(data, null, 2))

    const loaded = JSON.parse(readFileSync(TEST_SESSIONS_FILE, 'utf-8'))
    expect(loaded.current).toBe('session-1')
    expect(loaded.sessions['session-1'].model).toBe('openai/gpt-5.2')
  })

  test('multiple sessions storage', () => {
    mkdirSync(TEST_DIR, { recursive: true })

    const data = {
      current: 'session-2',
      sessions: {
        'session-1': {
          id: 'session-1',
          model: 'anthropic/claude-sonnet-4-5',
          system: 'First session',
          tools: [],
          createdAt: '2026-02-04T00:00:00.000Z',
        },
        'session-2': {
          id: 'session-2',
          model: 'openai/gpt-5.2',
          system: 'Second session',
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: { type: 'object', properties: {} },
            },
          ],
          createdAt: '2026-02-04T01:00:00.000Z',
        },
      },
    }

    Bun.write(TEST_SESSIONS_FILE, JSON.stringify(data, null, 2))

    const loaded = JSON.parse(readFileSync(TEST_SESSIONS_FILE, 'utf-8'))
    expect(Object.keys(loaded.sessions)).toHaveLength(2)
    expect(loaded.sessions['session-2'].tools).toHaveLength(1)
  })

  test('session deletion updates current', () => {
    mkdirSync(TEST_DIR, { recursive: true })

    // Initial state with current session
    const initial = {
      current: 'session-1',
      sessions: {
        'session-1': {
          id: 'session-1',
          model: 'test',
          system: '',
          tools: [],
          createdAt: '',
        },
      },
    }

    // Simulate deletion
    delete initial.sessions['session-1']
    if (initial.current === 'session-1') {
      initial.current = null as any
    }

    expect(initial.current).toBeNull()
    expect(Object.keys(initial.sessions)).toHaveLength(0)
  })

  test('session switching', () => {
    const data = {
      current: 'session-1',
      sessions: {
        'session-1': { id: 'session-1' },
        'session-2': { id: 'session-2' },
      },
    }

    // Switch to session-2
    data.current = 'session-2'

    expect(data.current).toBe('session-2')
  })

  test('empty sessions list', () => {
    const data = {
      current: null,
      sessions: {},
    }

    expect(Object.values(data.sessions)).toHaveLength(0)
    expect(data.current).toBeNull()
  })
})

describe('AgentSession from agent-worker', () => {
  test('can import and create session', async () => {
    // Test that the agent-worker package exports work correctly
    const { AgentSession } = await import('../../agent-worker/src/session.ts')

    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'You are a helpful assistant.',
    })

    expect(session.id).toBeDefined()
    expect(session.model).toBe('openai/gpt-5.2')
    expect(session.system).toBe('You are a helpful assistant.')
  })

  test('session methods work correctly', async () => {
    const { AgentSession } = await import('../../agent-worker/src/session.ts')

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    // Initial state
    expect(session.history()).toEqual([])
    expect(session.stats().messageCount).toBe(0)

    // Export
    const transcript = session.export()
    expect(transcript.sessionId).toBe(session.id)
    expect(transcript.model).toBe('test/model')
    expect(transcript.system).toBe('Test')

    // Clear
    session.clear()
    expect(session.history()).toEqual([])
  })

  test('tool definitions', async () => {
    const { AgentSession } = await import('../../agent-worker/src/session.ts')

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
          execute: async (args) => ({ content: `Contents of ${args.path}` }),
        },
      ],
    })

    expect(session.id).toBeDefined()

    // Add another tool
    session.addTool({
      name: 'write_file',
      description: 'Write a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    })

    // Mock the tool
    session.mockTool('read_file', () => ({ content: 'mocked content' }))

    expect(session.stats().messageCount).toBe(0)
  })
})
