/**
 * AgentSession.send() Tests
 *
 * Tests the core user flow: create session → send message → get response.
 * This is the BIGGEST gap in current test coverage.
 *
 * Two paths tested:
 * 1. Backend delegation path (session created with backend option)
 * 2. SDK path (session with mock model via module mocking)
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { MockLanguageModelV3, mockValues } from 'ai/test'
import { tool, jsonSchema } from 'ai'
import { textModel, sequenceModel, failingModel, toolCallModel } from '../helpers/mock-model.ts'
import { recordingBackend } from '../helpers/mock-backend.ts'
import type { Backend, BackendResponse } from '../../src/backends/types.ts'

// ==================== Backend Delegation Path ====================
// When session has a backend, send() delegates to backend.send()

describe('AgentSession.send() via backend', () => {
  // Lazy import to allow mock.module to take effect
  let AgentSession: typeof import('../../src/agent/session.ts').AgentSession

  beforeEach(async () => {
    const mod = await import('../../src/agent/session.ts')
    AgentSession = mod.AgentSession
  })

  test('basic send: message forwarded to backend, response returned', async () => {
    const backend = recordingBackend({ content: 'Hello from backend!' })

    const session = new AgentSession({
      model: 'test/model',
      system: 'You are helpful.',
      backend,
    })

    const response = await session.send('Hello')

    expect(response.content).toBe('Hello from backend!')
    expect(response.latency).toBeGreaterThanOrEqual(0)
    expect(response.toolCalls).toEqual([])
    expect(response.pendingApprovals).toEqual([])

    // Backend received the message
    const calls = backend.getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.message).toBe('Hello')
    expect((calls[0]!.options as any)?.system).toBe('You are helpful.')
  })

  test('multi-turn: messages accumulate in history', async () => {
    let callCount = 0
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        callCount++
        return { content: `Response ${callCount}` }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    const r1 = await session.send('First')
    expect(r1.content).toBe('Response 1')

    const r2 = await session.send('Second')
    expect(r2.content).toBe('Response 2')

    const history = session.history()
    expect(history).toHaveLength(4)
    expect(history[0]!.role).toBe('user')
    expect(history[0]!.content).toBe('First')
    expect(history[1]!.role).toBe('assistant')
    expect(history[1]!.content).toBe('Response 1')
    expect(history[2]!.role).toBe('user')
    expect(history[2]!.content).toBe('Second')
    expect(history[3]!.role).toBe('assistant')
    expect(history[3]!.content).toBe('Response 2')
  })

  test('usage tracking accumulates across sends', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return {
          content: 'ok',
          usage: { input: 100, output: 50, total: 150 },
        }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    await session.send('First')
    await session.send('Second')

    const stats = session.stats()
    expect(stats.messageCount).toBe(4)
    expect(stats.usage.input).toBe(200)
    expect(stats.usage.output).toBe(100)
    expect(stats.usage.total).toBe(300)
  })

  test('backend tool calls mapped to response', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return {
          content: 'Result with tools',
          toolCalls: [
            {
              name: 'read_file',
              arguments: { path: '/foo.txt' },
              result: 'file contents',
            },
          ],
        }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    const response = await session.send('Read the file')
    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls[0]!.name).toBe('read_file')
    expect(response.toolCalls[0]!.result).toBe('file contents')
  })

  test('backend error propagates', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        throw new Error('Backend unavailable')
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    await expect(session.send('Hello')).rejects.toThrow('Backend unavailable')

    // User message was still added before error
    const history = session.history()
    expect(history).toHaveLength(1)
    expect(history[0]!.role).toBe('user')
  })

  test('backend with no usage reports zero usage', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return { content: 'ok' } // no usage field
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    const response = await session.send('Hello')
    expect(response.usage.input).toBe(0)
    expect(response.usage.output).toBe(0)
    expect(response.usage.total).toBe(0)
  })

  test('tool management not supported for backend sessions', () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return { content: 'ok' }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    expect(session.supportsTools).toBe(false)

    expect(() => {
      session.addTool('test', {})
    }).toThrow('Tool management not supported')

    expect(() => {
      session.mockTool('test', () => 'mocked')
    }).toThrow('Tool management not supported')

    expect(() => {
      session.setMockResponse('test', 'mocked')
    }).toThrow('Tool management not supported')
  })
})

// ==================== Session State Management ====================

describe('AgentSession state management', () => {
  let AgentSession: typeof import('../../src/agent/session.ts').AgentSession

  beforeEach(async () => {
    const mod = await import('../../src/agent/session.ts')
    AgentSession = mod.AgentSession
  })

  test('clear resets all state', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return { content: 'ok', usage: { input: 10, output: 5, total: 15 } }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    await session.send('Hello')
    expect(session.history()).toHaveLength(2)
    expect(session.stats().usage.total).toBe(15)

    session.clear()

    expect(session.history()).toHaveLength(0)
    expect(session.stats().messageCount).toBe(0)
    expect(session.stats().usage.total).toBe(0)
    expect(session.getPendingApprovals()).toHaveLength(0)
  })

  test('export returns full transcript', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return { content: 'Hello!' }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'You are helpful.',
      backend,
    })

    await session.send('Hi')

    const transcript = session.export()
    expect(transcript.sessionId).toBe(session.id)
    expect(transcript.model).toBe('test/model')
    expect(transcript.system).toBe('You are helpful.')
    expect(transcript.messages).toHaveLength(2)
    expect(transcript.createdAt).toBeDefined()
  })

  test('getState for session persistence', async () => {
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        return { content: 'ok' }
      },
    }

    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    await session.send('Hello')

    const state = session.getState()
    expect(state.id).toBe(session.id)
    expect(state.messages).toHaveLength(2)

    // Restore from state
    const restored = new AgentSession(
      { model: 'test/model', system: 'Test', backend },
      state,
    )

    expect(restored.id).toBe(session.id)
    expect(restored.history()).toHaveLength(2)
    expect(restored.history()[0]!.content).toBe('Hello')
  })

  test('send after restore continues conversation', async () => {
    let callCount = 0
    const backend: Backend = {
      type: 'claude' as const,
      async send() {
        callCount++
        return { content: `Response ${callCount}` }
      },
    }

    const session1 = new AgentSession({
      model: 'test/model',
      system: 'Test',
      backend,
    })

    await session1.send('First')
    const state = session1.getState()

    // Restore and continue
    const session2 = new AgentSession(
      { model: 'test/model', system: 'Test', backend },
      state,
    )

    await session2.send('Second')

    const history = session2.history()
    expect(history).toHaveLength(4)
    expect(history[2]!.content).toBe('Second')
    expect(history[3]!.content).toBe('Response 2')
  })
})

// ==================== SDK Path (with module mocking) ====================
// When no backend, session uses ToolLoopAgent with createModelAsync

describe('AgentSession.send() via SDK (mock model)', () => {
  // Mock createModelAsync to return our mock model
  let mockModel: MockLanguageModelV3

  beforeEach(() => {
    mockModel = textModel('Hello from SDK!')
  })

  test('basic SDK send with mock model', async () => {
    // Mock the models module before importing session
    mock.module('../../src/agent/models.ts', () => ({
      createModelAsync: async () => mockModel,
      createModel: () => mockModel,
      FRONTIER_MODELS: { anthropic: ['mock-model'] },
      SUPPORTED_PROVIDERS: ['anthropic'],
      DEFAULT_PROVIDER: 'anthropic',
      getDefaultModel: () => 'anthropic/mock-model',
    }))

    // Fresh import after mocking
    const { AgentSession } = await import('../../src/agent/session.ts')

    const session = new AgentSession({
      model: 'anthropic/mock-model',
      system: 'You are helpful.',
    })

    expect(session.supportsTools).toBe(true)

    const response = await session.send('Hello')
    expect(response.content).toBe('Hello from SDK!')
    expect(response.toolCalls).toEqual([])

    // History updated
    const history = session.history()
    expect(history).toHaveLength(2)
    expect(history[0]!.role).toBe('user')
    expect(history[1]!.role).toBe('assistant')
  })

  test('SDK send with tool calling', async () => {
    const model = toolCallModel(
      'get_weather',
      { location: 'Tokyo' },
      'The weather in Tokyo is sunny.',
    )

    mock.module('../../src/agent/models.ts', () => ({
      createModelAsync: async () => model,
      createModel: () => model,
      FRONTIER_MODELS: { anthropic: ['mock-model'] },
      SUPPORTED_PROVIDERS: ['anthropic'],
      DEFAULT_PROVIDER: 'anthropic',
      getDefaultModel: () => 'anthropic/mock-model',
    }))

    const { AgentSession } = await import('../../src/agent/session.ts')

    const weatherTool = tool({
      description: 'Get weather',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      }),
      execute: async (args) => ({ temperature: 25, location: (args as any).location }),
    })

    const session = new AgentSession({
      model: 'anthropic/mock-model',
      system: 'Test',
      tools: { get_weather: weatherTool },
    })

    const response = await session.send('What is the weather in Tokyo?')

    expect(response.content).toBe('The weather in Tokyo is sunny.')
    expect(response.toolCalls.length).toBeGreaterThanOrEqual(1)
    expect(response.toolCalls[0]!.name).toBe('get_weather')
  })

  test('SDK send multi-turn accumulates context', async () => {
    const model = sequenceModel(['First response', 'Second response'])

    mock.module('../../src/agent/models.ts', () => ({
      createModelAsync: async () => model,
      createModel: () => model,
      FRONTIER_MODELS: { anthropic: ['mock-model'] },
      SUPPORTED_PROVIDERS: ['anthropic'],
      DEFAULT_PROVIDER: 'anthropic',
      getDefaultModel: () => 'anthropic/mock-model',
    }))

    const { AgentSession } = await import('../../src/agent/session.ts')

    const session = new AgentSession({
      model: 'anthropic/mock-model',
      system: 'Test',
    })

    const r1 = await session.send('First')
    expect(r1.content).toBe('First response')

    const r2 = await session.send('Second')
    expect(r2.content).toBe('Second response')

    expect(session.history()).toHaveLength(4)
    expect(session.stats().messageCount).toBe(4)
  })

  test('SDK send with onStepFinish callback', async () => {
    const model = textModel('Done', 100, 50)

    mock.module('../../src/agent/models.ts', () => ({
      createModelAsync: async () => model,
      createModel: () => model,
      FRONTIER_MODELS: { anthropic: ['mock-model'] },
      SUPPORTED_PROVIDERS: ['anthropic'],
      DEFAULT_PROVIDER: 'anthropic',
      getDefaultModel: () => 'anthropic/mock-model',
    }))

    const { AgentSession } = await import('../../src/agent/session.ts')

    const session = new AgentSession({
      model: 'anthropic/mock-model',
      system: 'Test',
    })

    const steps: Array<{ stepNumber: number }> = []
    await session.send('Hello', {
      onStepFinish: (info) => {
        steps.push({ stepNumber: info.stepNumber })
      },
    })

    expect(steps.length).toBeGreaterThanOrEqual(1)
    expect(steps[0]!.stepNumber).toBe(1)
  })

  test('addTool and mockTool affect subsequent send calls', async () => {
    const model = toolCallModel(
      'calculator',
      { expression: '2+2' },
      'The answer is 4.',
    )

    mock.module('../../src/agent/models.ts', () => ({
      createModelAsync: async () => model,
      createModel: () => model,
      FRONTIER_MODELS: { anthropic: ['mock-model'] },
      SUPPORTED_PROVIDERS: ['anthropic'],
      DEFAULT_PROVIDER: 'anthropic',
      getDefaultModel: () => 'anthropic/mock-model',
    }))

    const { AgentSession } = await import('../../src/agent/session.ts')

    const calcTool = tool({
      description: 'Calculate expression',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      }),
      execute: async () => ({ result: 4 }),
    })

    const session = new AgentSession({
      model: 'anthropic/mock-model',
      system: 'Test',
    })

    // Add tool dynamically
    session.addTool('calculator', calcTool)

    const tools = session.getTools()
    expect(tools.map((t) => t.name)).toContain('calculator')

    // Mock tool response
    session.setMockResponse('calculator', { result: 42 })

    const response = await session.send('Calculate 2+2')
    expect(response.content).toBe('The answer is 4.')
  })
})

// ==================== Approval Workflow ====================

describe('AgentSession approval workflow', () => {
  let AgentSession: typeof import('../../src/agent/session.ts').AgentSession

  beforeEach(async () => {
    const mod = await import('../../src/agent/session.ts')
    AgentSession = mod.AgentSession
  })

  test('setApproval configures tool approval', () => {
    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    const testTool = tool({
      description: 'Dangerous tool',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: {},
      }),
      execute: async () => 'executed',
    })

    session.addTool('dangerous', testTool)
    session.setApproval('dangerous', true)

    const tools = session.getTools()
    const dangerous = tools.find((t) => t.name === 'dangerous')
    expect(dangerous?.needsApproval).toBe(true)
  })

  test('approve executes the tool', async () => {
    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    let executed = false
    const testTool = tool({
      description: 'Dangerous tool',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: { target: { type: 'string' } },
      }),
      execute: async (args) => {
        executed = true
        return { deleted: (args as any).target }
      },
    })

    session.addTool('delete_file', testTool)
    session.setApproval('delete_file', true)

    // Manually create a pending approval (simulating what send() does)
    const state = session.getState()
    const approval = {
      id: 'test-approval-1',
      toolName: 'delete_file',
      toolCallId: 'call-1',
      arguments: { target: '/tmp/test.txt' },
      requestedAt: new Date().toISOString(),
      status: 'pending' as const,
    }
    ;(session as any).pendingApprovals.push(approval)

    const result = await session.approve('test-approval-1')
    expect(executed).toBe(true)
    expect(result).toEqual({ deleted: '/tmp/test.txt' })
  })

  test('deny marks approval as denied', () => {
    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    const testTool = tool({
      description: 'Dangerous',
      parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
      execute: async () => 'executed',
    })

    session.addTool('danger', testTool)

    // Manually add pending approval
    const approval = {
      id: 'deny-test-1',
      toolName: 'danger',
      toolCallId: 'call-1',
      arguments: {},
      requestedAt: new Date().toISOString(),
      status: 'pending' as const,
    }
    ;(session as any).pendingApprovals.push(approval)

    session.deny('deny-test-1', 'Too risky')

    const pending = session.getPendingApprovals()
    expect(pending).toHaveLength(0) // No longer pending

    const all = (session as any).pendingApprovals
    const denied = all.find((p: any) => p.id === 'deny-test-1')
    expect(denied.status).toBe('denied')
    expect(denied.denyReason).toBe('Too risky')
  })

  test('approve non-existent approval throws', async () => {
    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    await expect(session.approve('nonexistent')).rejects.toThrow('Approval not found')
  })

  test('deny non-existent approval throws', () => {
    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    expect(() => session.deny('nonexistent')).toThrow('Approval not found')
  })

  test('cannot approve already approved', async () => {
    const session = new AgentSession({
      model: 'test/model',
      system: 'Test',
    })

    const testTool = tool({
      description: 'Test',
      parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
      execute: async () => 'ok',
    })
    session.addTool('test', testTool)

    const approval = {
      id: 'double-approve',
      toolName: 'test',
      toolCallId: 'call-1',
      arguments: {},
      requestedAt: new Date().toISOString(),
      status: 'pending' as const,
    }
    ;(session as any).pendingApprovals.push(approval)

    await session.approve('double-approve')
    await expect(session.approve('double-approve')).rejects.toThrow('already approved')
  })
})
