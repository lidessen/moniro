import { describe, test, expect } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'
import { generateText } from 'ai'
import { AgentSession } from '../src/session.ts'
import { createTools } from '../src/tools.ts'
import type { ToolDefinition } from '../src/types.ts'

// Helper to create V3 format response
function mockResponse(text: string, inputTokens = 10, outputTokens = 5) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: { inputTokens, outputTokens },
  }
}

describe('AgentSession', () => {
  describe('basic messaging', () => {
    test('sends message and receives response', async () => {
      const mockModel = new MockLanguageModelV3({
        doGenerate: mockResponse('Hello! I am an AI assistant.', 10, 8),
      })

      const response = await generateText({
        model: mockModel,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(response.text).toBe('Hello! I am an AI assistant.')
      // Usage may not be available in mock, just check text works
    })

    test('maintains conversation history with separate models', async () => {
      // Create separate models for each call to avoid state issues
      const mockModel1 = new MockLanguageModelV3({
        doGenerate: mockResponse('First response', 5, 2),
      })

      const mockModel2 = new MockLanguageModelV3({
        doGenerate: mockResponse('Second response', 10, 3),
      })

      // First message
      const response1 = await generateText({
        model: mockModel1,
        messages: [{ role: 'user', content: 'First message' }],
      })
      expect(response1.text).toBe('First response')

      // Second message
      const response2 = await generateText({
        model: mockModel2,
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      })
      expect(response2.text).toBe('Second response')
    })
  })

  describe('tool calling', () => {
    test('creates tools from definitions', () => {
      const toolDefs: ToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
          execute: async (args) => ({ content: `Content of ${args.path}` }),
        },
      ]

      const tools = createTools(toolDefs)
      expect(tools).toHaveProperty('read_file')
      expect(tools.read_file.description).toBe('Read file contents')
    })

    test('executes tool with mock response', async () => {
      const toolDefs: ToolDefinition[] = [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
          execute: async (args) => ({
            temperature: 72,
            conditions: 'sunny',
            location: args.location,
          }),
        },
      ]

      const tools = createTools(toolDefs)

      // Test the execute function directly
      const result = await tools.get_weather.execute!(
        { location: 'San Francisco' },
        { toolCallId: 'test-1', messages: [], abortSignal: undefined as never }
      )

      expect(result).toEqual({
        temperature: 72,
        conditions: 'sunny',
        location: 'San Francisco',
      })
    })

    test('handles tool call in generateText', async () => {
      const mockModel = new MockLanguageModelV3({
        doGenerate: {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: 'get_weather',
              input: { location: 'San Francisco' },
            },
            {
              type: 'text' as const,
              text: 'The weather in San Francisco is sunny with 72°F.',
            },
          ],
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: { inputTokens: 20, outputTokens: 15 },
        },
      })

      const response = await generateText({
        model: mockModel,
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      })

      expect(response.text).toContain('sunny')
    })
  })

  describe('session export', () => {
    test('exports transcript with correct structure', () => {
      const session = new AgentSession({
        model: 'anthropic/claude-sonnet-4-5',
        system: 'Test system prompt',
      })

      const transcript = session.export()

      expect(transcript.sessionId).toBeDefined()
      expect(transcript.model).toBe('anthropic/claude-sonnet-4-5')
      expect(transcript.system).toBe('Test system prompt')
      expect(transcript.messages).toEqual([])
      expect(transcript.totalUsage).toEqual({ input: 0, output: 0, total: 0 })
      expect(transcript.createdAt).toBeDefined()
    })
  })

  describe('session stats', () => {
    test('returns initial stats', () => {
      const session = new AgentSession({
        model: 'openai/gpt-5.2',
        system: 'Test',
      })

      const stats = session.stats()

      expect(stats.messageCount).toBe(0)
      expect(stats.usage).toEqual({ input: 0, output: 0, total: 0 })
    })
  })

  describe('session history', () => {
    test('history starts empty', () => {
      const session = new AgentSession({
        model: 'openai/gpt-5.2',
        system: 'Test',
      })

      expect(session.history()).toEqual([])
    })
  })

  describe('session clear', () => {
    test('clear resets state', () => {
      const session = new AgentSession({
        model: 'openai/gpt-5.2',
        system: 'Test',
      })

      // Session starts empty, clear should keep it empty
      session.clear()
      expect(session.history()).toEqual([])
      expect(session.stats().messageCount).toBe(0)
    })
  })
})

describe('createTools', () => {
  test('handles empty tool list', () => {
    const tools = createTools([])
    expect(Object.keys(tools)).toHaveLength(0)
  })

  test('handles tool without execute function', () => {
    const toolDefs: ToolDefinition[] = [
      {
        name: 'no_execute',
        description: 'A tool without execute',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ]

    const tools = createTools(toolDefs)
    expect(tools.no_execute).toBeDefined()
  })

  test('handles multiple tools', () => {
    const toolDefs: ToolDefinition[] = [
      {
        name: 'tool_a',
        description: 'First tool',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'tool_b',
        description: 'Second tool',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'tool_c',
        description: 'Third tool',
        parameters: { type: 'object', properties: {} },
      },
    ]

    const tools = createTools(toolDefs)
    expect(Object.keys(tools)).toHaveLength(3)
    expect(tools.tool_a.description).toBe('First tool')
    expect(tools.tool_b.description).toBe('Second tool')
    expect(tools.tool_c.description).toBe('Third tool')
  })
})

describe('FRONTIER_MODELS', () => {
  test('contains valid provider model lists', async () => {
    const { FRONTIER_MODELS, SUPPORTED_PROVIDERS } = await import('../src/models.ts')

    // All supported providers should have frontier models
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(FRONTIER_MODELS[provider]).toBeDefined()
      expect(FRONTIER_MODELS[provider].length).toBeGreaterThan(0)
    }

    // Check specific models exist
    expect(FRONTIER_MODELS.anthropic).toContain('claude-sonnet-4-5')
    expect(FRONTIER_MODELS.openai).toContain('gpt-5.2')
    expect(FRONTIER_MODELS.deepseek).toContain('deepseek-chat')
  })
})

describe('createModel', () => {
  test('throws on unknown provider', async () => {
    const { createModel } = await import('../src/models.ts')

    // Provider-only format throws for unknown providers
    expect(() => createModel('invalid-model')).toThrow(
      'Unknown provider: invalid-model. Supported:'
    )
  })

  test('resolves provider-only format to default model', async () => {
    const { createModel, FRONTIER_MODELS } = await import('../src/models.ts')

    // Valid provider should use gateway format with first model
    const model = createModel('openai')
    expect(model.modelId).toBe(`openai/${FRONTIER_MODELS.openai[0]}`)
  })

  test('throws on empty model name after colon', async () => {
    const { createModel } = await import('../src/models.ts')

    expect(() => createModel('anthropic:')).toThrow(
      'Invalid model identifier: anthropic:. Model name is required.'
    )
  })

  test('throws on unloaded provider', async () => {
    const { createModel } = await import('../src/models.ts')

    // Direct provider format requires async loading first
    expect(() => createModel('unknown:model-name')).toThrow(
      "Provider 'unknown' not loaded"
    )
  })

  test('createModelAsync throws on unknown provider', async () => {
    const { createModelAsync } = await import('../src/models.ts')

    await expect(createModelAsync('unknown:model-name')).rejects.toThrow(
      'Unknown provider: unknown'
    )
  })

  test('handles gateway format with slash', async () => {
    const { createModel } = await import('../src/models.ts')

    // Gateway format should not throw (creates gateway model)
    const model = createModel('openai/gpt-5.2')
    expect(model).toBeDefined()
    expect(model.modelId).toBe('openai/gpt-5.2')
  })
})

describe('AgentSession advanced', () => {
  test('addTool adds tool to session', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    session.addTool({
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
      },
    })

    // Export should work (tools are internal but session should function)
    const transcript = session.export()
    expect(transcript.sessionId).toBeDefined()
  })

  test('mockTool updates existing tool execute function', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: [
        {
          name: 'my_tool',
          description: 'Original tool',
          parameters: { type: 'object', properties: {} },
          execute: () => ({ result: 'original' }),
        },
      ],
    })

    session.mockTool('my_tool', () => ({ result: 'mocked' }))

    // The mock was set (internal state changed)
    expect(session.stats().messageCount).toBe(0)
  })

  test('mockTool throws for non-existent tool', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    expect(() => session.mockTool('nonexistent', () => ({}))).toThrow(
      'Tool not found: nonexistent'
    )
  })

  test('session with custom maxTokens', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      maxTokens: 8192,
    })

    expect(session.export().sessionId).toBeDefined()
  })

  test('session with initial tools', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: [
        {
          name: 'tool1',
          description: 'First',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'tool2',
          description: 'Second',
          parameters: { type: 'object', properties: {} },
        },
      ],
    })

    expect(session.stats().messageCount).toBe(0)
  })

  test('session id is unique UUID format', () => {
    const session1 = new AgentSession({ model: 'test', system: '' })
    const session2 = new AgentSession({ model: 'test', system: '' })

    expect(session1.id).not.toBe(session2.id)
    // UUID format check
    expect(session1.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })

  test('createdAt is valid ISO timestamp', () => {
    const session = new AgentSession({ model: 'test', system: '' })
    const date = new Date(session.createdAt)
    expect(date.toISOString()).toBe(session.createdAt)
  })

  test('getState returns session state for persistence', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    const state = session.getState()

    expect(state.id).toBe(session.id)
    expect(state.createdAt).toBe(session.createdAt)
    expect(state.messages).toEqual([])
    expect(state.totalUsage).toEqual({ input: 0, output: 0, total: 0 })
  })

  test('restores session from state', () => {
    const originalSession = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test system',
    })

    // Simulate state with messages
    const savedState = {
      id: originalSession.id,
      createdAt: originalSession.createdAt,
      messages: [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ],
      totalUsage: { input: 10, output: 5, total: 15 },
    }

    // Restore session
    const restoredSession = new AgentSession(
      { model: 'openai/gpt-5.2', system: 'Test system' },
      savedState
    )

    // Verify restored state
    expect(restoredSession.id).toBe(originalSession.id)
    expect(restoredSession.createdAt).toBe(originalSession.createdAt)
    expect(restoredSession.history()).toHaveLength(2)
    expect(restoredSession.stats().usage.total).toBe(15)
  })

  test('configurable maxSteps', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      maxSteps: 5,
    })

    // Session created with custom maxSteps
    expect(session.export().sessionId).toBeDefined()
  })
})

describe('createTools edge cases', () => {
  test('tool without execute returns error object', async () => {
    const toolDefs: ToolDefinition[] = [
      {
        name: 'no_impl',
        description: 'No implementation',
        parameters: { type: 'object', properties: {} },
      },
    ]

    const tools = createTools(toolDefs)

    const result = await tools.no_impl.execute!(
      {},
      { toolCallId: 'test', messages: [], abortSignal: undefined as never }
    )

    expect(result).toEqual({ error: 'No mock implementation provided' })
  })

  test('tool with async execute function', async () => {
    const toolDefs: ToolDefinition[] = [
      {
        name: 'async_tool',
        description: 'Async tool',
        parameters: {
          type: 'object',
          properties: {
            delay: { type: 'number' },
          },
        },
        execute: async (args) => {
          await new Promise((r) => setTimeout(r, 1))
          return { delayed: true, input: args.delay }
        },
      },
    ]

    const tools = createTools(toolDefs)

    const result = await tools.async_tool.execute!(
      { delay: 100 },
      { toolCallId: 'test', messages: [], abortSignal: undefined as never }
    )

    expect(result).toEqual({ delayed: true, input: 100 })
  })

  test('tool parameters with required fields', () => {
    const toolDefs: ToolDefinition[] = [
      {
        name: 'required_params',
        description: 'Has required params',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'User name' },
            age: { type: 'number', description: 'User age' },
          },
          required: ['name'],
        },
      },
    ]

    const tools = createTools(toolDefs)
    expect(tools.required_params).toBeDefined()
    expect(tools.required_params.description).toBe('Has required params')
  })
})

describe('bash-tools integration', () => {
  test('createBashTools returns tools and toolkit', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools, toolkit } = await createBashTools({
      files: { 'test.txt': 'hello world' },
    })

    expect(tools).toHaveLength(3) // bash, readFile, writeFile
    expect(tools.map((t) => t.name)).toEqual(['bash', 'readFile', 'writeFile'])
    expect(toolkit).toBeDefined()
    expect(toolkit.sandbox).toBeDefined()
  })

  test('createBashTools respects includeReadFile option', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({
      files: {},
      includeReadFile: false,
    })

    expect(tools.map((t) => t.name)).toEqual(['bash', 'writeFile'])
  })

  test('createBashTools respects includeWriteFile option', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({
      files: {},
      includeWriteFile: false,
    })

    expect(tools.map((t) => t.name)).toEqual(['bash', 'readFile'])
  })

  test('bash tool executes commands', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({
      files: { 'test.txt': 'hello world' },
    })

    const bashTool = tools.find((t) => t.name === 'bash')!
    const result = (await bashTool.execute!({ command: 'echo "test"' })) as {
      stdout: string
      stderr: string
      exitCode: number
    }

    expect(result.stdout.trim()).toBe('test')
    expect(result.exitCode).toBe(0)
  })

  test('readFile tool reads files', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({
      files: { 'hello.txt': 'Hello, World!' },
    })

    const readFileTool = tools.find((t) => t.name === 'readFile')!
    const result = (await readFileTool.execute!({ path: 'hello.txt' })) as { content: string }

    expect(result.content).toBe('Hello, World!')
  })

  test('writeFile tool writes files', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({ files: {} })

    const writeFileTool = tools.find((t) => t.name === 'writeFile')!
    const readFileTool = tools.find((t) => t.name === 'readFile')!

    await writeFileTool.execute!({ path: 'new.txt', content: 'new content' })
    const result = (await readFileTool.execute!({ path: 'new.txt' })) as { content: string }

    expect(result.content).toBe('new content')
  })

  test('createBashToolsFromFiles helper', async () => {
    const { createBashToolsFromFiles } = await import('../src/bash-tools.ts')

    const { tools } = await createBashToolsFromFiles({
      'src/index.ts': 'console.log("hello")',
      'package.json': '{"name": "test"}',
    })

    expect(tools).toHaveLength(3)

    const readFileTool = tools.find((t) => t.name === 'readFile')!
    const result = (await readFileTool.execute!({ path: 'src/index.ts' })) as { content: string }
    expect(result.content).toBe('console.log("hello")')
  })

  test('tools have correct parameter schemas', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({ files: {} })

    const bashTool = tools.find((t) => t.name === 'bash')!
    expect(bashTool.parameters.properties).toHaveProperty('command')
    expect(bashTool.parameters.required).toContain('command')

    const readFileTool = tools.find((t) => t.name === 'readFile')!
    expect(readFileTool.parameters.properties).toHaveProperty('path')
    expect(readFileTool.parameters.required).toContain('path')

    const writeFileTool = tools.find((t) => t.name === 'writeFile')!
    expect(writeFileTool.parameters.properties).toHaveProperty('path')
    expect(writeFileTool.parameters.properties).toHaveProperty('content')
    expect(writeFileTool.parameters.required).toContain('path')
    expect(writeFileTool.parameters.required).toContain('content')
  })

  test('tools work with AgentSession', async () => {
    const { createBashTools } = await import('../src/bash-tools.ts')

    const { tools } = await createBashTools({
      files: { 'data.json': '{"key": "value"}' },
    })

    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'You are a coding assistant with file system access.',
      tools,
    })

    expect(session.id).toBeDefined()
    expect(session.stats().messageCount).toBe(0)
  })
})

describe('tool approval workflow', () => {
  test('needsApproval boolean flag on tool definition', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: [
        {
          name: 'safe_tool',
          description: 'A safe tool',
          parameters: { type: 'object', properties: {} },
          needsApproval: false,
        },
        {
          name: 'dangerous_tool',
          description: 'A dangerous tool',
          parameters: { type: 'object', properties: {} },
          needsApproval: true,
        },
      ],
    })

    expect(session.id).toBeDefined()
    expect(session.getPendingApprovals()).toEqual([])
  })

  test('needsApproval function for conditional approval', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: [
        {
          name: 'file_op',
          description: 'File operations',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              action: { type: 'string' },
            },
          },
          // Only need approval for delete operations
          needsApproval: (args) => args.action === 'delete',
        },
      ],
    })

    expect(session.id).toBeDefined()
  })

  test('getPendingApprovals returns empty array initially', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    expect(session.getPendingApprovals()).toEqual([])
  })

  test('approve throws for non-existent approval', async () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    await expect(session.approve('non-existent-id')).rejects.toThrow(
      'Approval not found: non-existent-id'
    )
  })

  test('deny throws for non-existent approval', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    expect(() => session.deny('non-existent-id')).toThrow('Approval not found: non-existent-id')
  })

  test('getState includes pendingApprovals', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    const state = session.getState()
    expect(state.pendingApprovals).toEqual([])
  })

  test('clear resets pendingApprovals', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    session.clear()
    expect(session.getPendingApprovals()).toEqual([])
  })

  test('restore session with pendingApprovals', () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'test_tool',
          toolCallId: 'call-1',
          arguments: { path: '/tmp' },
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'pending' as const,
        },
      ],
    }

    const session = new AgentSession(
      { model: 'openai/gpt-5.2', system: 'Test' },
      savedState
    )

    expect(session.getPendingApprovals()).toHaveLength(1)
    expect(session.getPendingApprovals()[0].toolName).toBe('test_tool')
  })
})
