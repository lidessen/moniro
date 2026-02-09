/**
 * Daemon Handler Unit Tests
 *
 * Tests the request dispatch logic in handler.ts.
 * Every CLI command goes through handleRequest() — this is the
 * gateway between IPC and session methods.
 *
 * Previously only tested indirectly through CLI integration tests.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { handleRequest, type ServerState } from '../../src/daemon/handler.ts'
import { AgentSession } from '../../src/agent/session.ts'
import type { Backend } from '../../src/backends/types.ts'
import type { SessionInfo } from '../../src/daemon/registry.ts'
// ==================== Test Setup ====================

function createTestState(overrides?: Partial<ServerState>): ServerState {
  const backend: Backend = {
    type: 'claude' as const,
    async send(message: string) {
      return { content: `Response to: ${message}` }
    },
  }

  const session = new AgentSession({
    model: 'test/model',
    system: 'Test system prompt',
    backend,
  })

  const info: SessionInfo = {
    id: 'test-session-id',
    name: 'test-agent',
    workflow: 'test',
    tag: 'main',
    contextDir: '/tmp/test',
    port: 0,
    pid: process.pid,
    backend: 'claude',
    model: 'test/model',
    system: 'Test system prompt',
    pidFile: '/tmp/test.pid',
    readyFile: '/tmp/test.ready',
    createdAt: new Date().toISOString(),
  }

  return {
    session,
    server: { stop: () => {} },
    info,
    lastActivity: Date.now(),
    pendingRequests: 0,
    ...overrides,
  }
}

function getState(state: ServerState) {
  return () => state
}

const noopResetTimer = () => {}
const noopShutdown = async () => {}

// ==================== Tests ====================

describe('handleRequest', () => {
  let state: ServerState

  beforeEach(() => {
    state = createTestState()
  })

  test('returns error when no active session', async () => {
    const result = await handleRequest(
      () => null,
      { action: 'ping' },
      noopResetTimer,
      noopShutdown,
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('No active session')
  })

  describe('ping', () => {
    test('returns session info', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'ping' },
        noopResetTimer,
        noopShutdown,
      )
      expect(result.success).toBe(true)
      const data = result.data as Record<string, unknown>
      expect(data.id).toBe('test-session-id')
      expect(data.model).toBe('test/model')
      expect(data.backend).toBe('claude')
      expect(data.name).toBe('test-agent')
    })
  })

  describe('send', () => {
    test('synchronous send returns response', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'send',
          payload: { message: 'Hello', async: false },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const data = result.data as Record<string, unknown>
      expect(data.content).toBe('Response to: Hello')
    })

    test('async send returns immediately', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'send',
          payload: { message: 'Hello', async: true },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const data = result.data as Record<string, unknown>
      expect(data.async).toBe(true)
      expect(data.message).toContain('background')
    })

    test('send with options', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'send',
          payload: {
            message: 'Test',
            options: { autoApprove: false },
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
    })

    test('send error propagated', async () => {
      const failingBackend: Backend = {
        type: 'claude' as const,
        async send() {
          throw new Error('Model error')
        },
      }

      const failState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
          backend: failingBackend,
        }),
      })

      const result = await handleRequest(
        getState(failState),
        {
          action: 'send',
          payload: { message: 'Hello' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Model error')
    })
  })

  describe('tool_add', () => {
    test('adds tool to SDK session', async () => {
      // Need SDK session (no backend) for tool management
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
          // no backend → SDK session
        }),
      })

      const result = await handleRequest(
        getState(sdkState),
        {
          action: 'tool_add',
          payload: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: { input: { type: 'string' } },
              required: ['input'],
            },
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const data = result.data as Record<string, unknown>
      expect(data.name).toBe('test_tool')

      // Verify tool was added
      const tools = sdkState.session.getTools()
      expect(tools.map((t) => t.name)).toContain('test_tool')
    })

    test('tool_add with needsApproval', async () => {
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
        }),
      })

      const result = await handleRequest(
        getState(sdkState),
        {
          action: 'tool_add',
          payload: {
            name: 'dangerous_tool',
            description: 'Needs approval',
            parameters: { type: 'object', properties: {} },
            needsApproval: true,
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)

      const tools = sdkState.session.getTools()
      const dangerous = tools.find((t) => t.name === 'dangerous_tool')
      expect(dangerous?.needsApproval).toBe(true)
    })

    test('tool_add fails for backend session', async () => {
      // state has a backend session
      const result = await handleRequest(
        getState(state),
        {
          action: 'tool_add',
          payload: {
            name: 'test_tool',
            description: 'Test',
            parameters: { type: 'object', properties: {} },
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not supported')
    })
  })

  describe('tool_mock', () => {
    test('sets mock response for existing tool', async () => {
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
        }),
      })

      // First add a tool
      await handleRequest(
        getState(sdkState),
        {
          action: 'tool_add',
          payload: {
            name: 'api_call',
            description: 'Makes API call',
            parameters: { type: 'object', properties: {} },
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      // Then mock it
      const result = await handleRequest(
        getState(sdkState),
        {
          action: 'tool_mock',
          payload: {
            name: 'api_call',
            response: { status: 200, body: 'mocked' },
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
    })

    test('tool_mock fails for non-existent tool', async () => {
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
        }),
      })

      const result = await handleRequest(
        getState(sdkState),
        {
          action: 'tool_mock',
          payload: { name: 'nonexistent', response: 'mock' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Tool not found')
    })
  })

  describe('tool_list', () => {
    test('returns empty list for session with no tools', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'tool_list' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      expect(result.data).toEqual([])
    })

    test('returns tools after adding', async () => {
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
        }),
      })

      await handleRequest(
        getState(sdkState),
        {
          action: 'tool_add',
          payload: {
            name: 'my_tool',
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        noopResetTimer,
        noopShutdown,
      )

      const result = await handleRequest(
        getState(sdkState),
        { action: 'tool_list' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const tools = result.data as Array<{ name: string }>
      expect(tools.map((t) => t.name)).toContain('my_tool')
    })
  })

  describe('tool_import', () => {
    test('rejects for backend sessions', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'tool_import',
          payload: { filePath: '/some/tools.ts' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not supported')
    })

    test('rejects missing filePath', async () => {
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
        }),
      })

      const result = await handleRequest(
        getState(sdkState),
        {
          action: 'tool_import',
          payload: { filePath: '' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('File path is required')
    })

    test('handles import failure gracefully', async () => {
      const sdkState = createTestState({
        session: new AgentSession({
          model: 'test/model',
          system: 'Test',
        }),
      })

      const result = await handleRequest(
        getState(sdkState),
        {
          action: 'tool_import',
          payload: { filePath: '/nonexistent/tools.ts' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to import')
    })
  })

  describe('history / stats / export / clear', () => {
    test('history returns empty for new session', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'history' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      expect(result.data).toEqual([])
    })

    test('history returns messages after send', async () => {
      await handleRequest(
        getState(state),
        { action: 'send', payload: { message: 'Hello' } },
        noopResetTimer,
        noopShutdown,
      )

      const result = await handleRequest(
        getState(state),
        { action: 'history' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const messages = result.data as Array<{ role: string; content: string }>
      expect(messages).toHaveLength(2)
    })

    test('stats returns message count and usage', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'stats' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const stats = result.data as { messageCount: number; usage: Record<string, number> }
      expect(stats.messageCount).toBe(0)
      expect(stats.usage).toBeDefined()
    })

    test('export returns transcript', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'export' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      const transcript = result.data as Record<string, unknown>
      expect(transcript.sessionId).toBeDefined()
      expect(transcript.model).toBe('test/model')
      expect(transcript.system).toBe('Test system prompt')
    })

    test('clear resets session state', async () => {
      // Send a message first
      await handleRequest(
        getState(state),
        { action: 'send', payload: { message: 'Hello' } },
        noopResetTimer,
        noopShutdown,
      )

      // Clear
      const clearResult = await handleRequest(
        getState(state),
        { action: 'clear' },
        noopResetTimer,
        noopShutdown,
      )
      expect(clearResult.success).toBe(true)

      // Verify cleared
      const historyResult = await handleRequest(
        getState(state),
        { action: 'history' },
        noopResetTimer,
        noopShutdown,
      )
      expect((historyResult.data as any[]).length).toBe(0)
    })
  })

  describe('approval actions', () => {
    test('pending returns empty when no approvals', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'pending' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(true)
      expect(result.data).toEqual([])
    })

    test('approve with invalid id returns error', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'approve',
          payload: { id: 'nonexistent' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Approval not found')
    })

    test('deny with invalid id returns error', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'deny',
          payload: { id: 'nonexistent', reason: 'test' },
        },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Approval not found')
    })
  })

  describe('shutdown', () => {
    test('shutdown triggers graceful shutdown', async () => {
      let shutdownCalled = false
      const shutdown = async () => {
        shutdownCalled = true
      }

      const result = await handleRequest(
        getState(state),
        { action: 'shutdown' },
        noopResetTimer,
        shutdown,
      )

      expect(result.success).toBe(true)
      expect(result.data).toBe('Shutting down')

      // Shutdown is scheduled via setTimeout, so wait briefly
      await new Promise((r) => setTimeout(r, 200))
      expect(shutdownCalled).toBe(true)
    })
  })

  describe('schedule actions', () => {
    test('schedule_get returns null when no schedule configured', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'schedule_get' },
        noopResetTimer,
        noopShutdown,
      )
      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })

    test('schedule_set with ms number', async () => {
      const resetAllCalled: boolean[] = []
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: { wakeup: 60000 },
        },
        noopResetTimer,
        noopShutdown,
        () => { resetAllCalled.push(true) },
      )
      expect(result.success).toBe(true)
      const data = result.data as { wakeup: number }
      expect(data.wakeup).toBe(60000)
      expect(state.info.schedule?.wakeup).toBe(60000)
      expect(resetAllCalled.length).toBe(1)
    })

    test('schedule_set with duration string', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: { wakeup: '5m' },
        },
        noopResetTimer,
        noopShutdown,
        noopResetTimer,
      )
      expect(result.success).toBe(true)
      const data = result.data as { wakeup: string }
      expect(data.wakeup).toBe('5m')
    })

    test('schedule_set with cron expression', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: { wakeup: '0 */2 * * *' },
        },
        noopResetTimer,
        noopShutdown,
        noopResetTimer,
      )
      expect(result.success).toBe(true)
      const data = result.data as { wakeup: string }
      expect(data.wakeup).toBe('0 */2 * * *')
    })

    test('schedule_set with prompt', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: { wakeup: '30s', prompt: 'Check tasks' },
        },
        noopResetTimer,
        noopShutdown,
        noopResetTimer,
      )
      expect(result.success).toBe(true)
      const data = result.data as { wakeup: string; prompt: string }
      expect(data.wakeup).toBe('30s')
      expect(data.prompt).toBe('Check tasks')
    })

    test('schedule_set rejects empty payload', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: {},
        },
        noopResetTimer,
        noopShutdown,
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('wakeup')
    })

    test('schedule_get returns schedule after set', async () => {
      state.info.schedule = { wakeup: '0 * * * *', prompt: 'wake up' }
      const result = await handleRequest(
        getState(state),
        { action: 'schedule_get' },
        noopResetTimer,
        noopShutdown,
      )
      expect(result.success).toBe(true)
      const data = result.data as { wakeup: string; prompt: string }
      expect(data.wakeup).toBe('0 * * * *')
      expect(data.prompt).toBe('wake up')
    })

    test('schedule_set rejects invalid cron expression', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: { wakeup: 'not a cron' },
        },
        noopResetTimer,
        noopShutdown,
        noopResetTimer,
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('expected 5 fields')
    })

    test('schedule_set rejects negative number', async () => {
      const result = await handleRequest(
        getState(state),
        {
          action: 'schedule_set',
          payload: { wakeup: -100 },
        },
        noopResetTimer,
        noopShutdown,
        noopResetTimer,
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('positive')
    })

    test('schedule_clear removes schedule', async () => {
      state.info.schedule = { wakeup: 60000 }
      const resetAllCalled: boolean[] = []
      const result = await handleRequest(
        getState(state),
        { action: 'schedule_clear' },
        noopResetTimer,
        noopShutdown,
        () => { resetAllCalled.push(true) },
      )
      expect(result.success).toBe(true)
      expect(state.info.schedule).toBeUndefined()
      expect(resetAllCalled.length).toBe(1)
    })
  })

  describe('unknown action', () => {
    test('returns error for unknown action', async () => {
      const result = await handleRequest(
        getState(state),
        { action: 'does_not_exist' },
        noopResetTimer,
        noopShutdown,
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unknown action: does_not_exist')
    })
  })

  describe('request tracking', () => {
    test('pendingRequests incremented and decremented', async () => {
      expect(state.pendingRequests).toBe(0)

      await handleRequest(
        getState(state),
        { action: 'ping' },
        noopResetTimer,
        noopShutdown,
      )

      // After completion, pendingRequests should be back to 0
      expect(state.pendingRequests).toBe(0)
    })

    test('resetIdleTimer called on each request', async () => {
      let resetCount = 0
      const countingReset = () => {
        resetCount++
      }

      await handleRequest(getState(state), { action: 'ping' }, countingReset, noopShutdown)
      await handleRequest(getState(state), { action: 'stats' }, countingReset, noopShutdown)

      expect(resetCount).toBe(2)
    })
  })
})
