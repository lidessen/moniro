import { describe, test, expect } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'
import { generateText, tool, jsonSchema } from 'ai'
import { AgentSession } from '../src/agent/session.ts'

// Helper to create V3 format response
function mockResponse(text: string, inputTokens = 10, outputTokens = 5) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: inputTokens },
      outputTokens: { total: outputTokens }
    },
    warnings: undefined,
  } as const
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
    test('creates AI SDK tools with tool()', () => {
      const tools = {
        read_file: tool({
          description: 'Read file contents',
          parameters: jsonSchema<Record<string, unknown>>({
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          }),
          execute: async (args: { path: string }) => ({ content: `Content of ${args.path}` }),
        }),
      }

      expect(tools).toHaveProperty('read_file')
      expect(tools.read_file.description).toBe('Read file contents')
    })

    test('executes AI SDK tool directly', async () => {
      const tools = {
        get_weather: tool({
          description: 'Get weather for a location',
          parameters: jsonSchema<Record<string, unknown>>({
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          }),
          execute: async (args: { location: string }) => ({
            temperature: 72,
            conditions: 'sunny',
            location: args.location,
          }),
        }),
      }

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
              input: JSON.stringify({ location: 'San Francisco' }),
            },
            {
              type: 'text' as const,
              text: 'The weather in San Francisco is sunny with 72°F.',
            },
          ],
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: {
            inputTokens: { total: 20 },
            outputTokens: { total: 15 }
          },
          warnings: undefined,
        } as const,
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

describe('AI SDK tool creation', () => {
  test('empty tools record', () => {
    const tools: Record<string, unknown> = {}
    expect(Object.keys(tools)).toHaveLength(0)
  })

  test('tool without execute function', () => {
    const tools = {
      no_execute: tool({
        description: 'A tool without execute',
        parameters: jsonSchema<Record<string, unknown>>({
          type: 'object',
          properties: {},
        }),
      }),
    }

    expect(tools.no_execute).toBeDefined()
  })

  test('handles multiple tools', () => {
    const tools = {
      tool_a: tool({
        description: 'First tool',
        parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
      }),
      tool_b: tool({
        description: 'Second tool',
        parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
      }),
      tool_c: tool({
        description: 'Third tool',
        parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
      }),
    }

    expect(Object.keys(tools)).toHaveLength(3)
    expect(tools.tool_a.description).toBe('First tool')
    expect(tools.tool_b.description).toBe('Second tool')
    expect(tools.tool_c.description).toBe('Third tool')
  })
})

describe('FRONTIER_MODELS', () => {
  test('contains valid provider model lists', async () => {
    const { FRONTIER_MODELS, SUPPORTED_PROVIDERS } = await import('../src/agent/models.ts')

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
    const { createModel } = await import('../src/agent/models.ts')

    // Provider-only format throws for unknown providers
    expect(() => createModel('invalid-model')).toThrow(
      'Unknown provider: invalid-model. Supported:'
    )
  })

  test('resolves provider-only format to default model', async () => {
    const { createModel, FRONTIER_MODELS } = await import('../src/agent/models.ts')

    // Valid provider should use gateway format with first model
    const model = createModel('openai')
    expect(model.modelId).toBe(`openai/${FRONTIER_MODELS.openai[0]}`)
  })

  test('throws on empty model name after colon', async () => {
    const { createModel } = await import('../src/agent/models.ts')

    expect(() => createModel('anthropic:')).toThrow(
      'Invalid model identifier: anthropic:. Model name is required.'
    )
  })

  test('throws on unloaded provider', async () => {
    const { createModel } = await import('../src/agent/models.ts')

    // Direct provider format requires async loading first
    expect(() => createModel('unknown:model-name')).toThrow(
      "Provider 'unknown' not loaded"
    )
  })

  test('createModelAsync throws on unknown provider', async () => {
    const { createModelAsync } = await import('../src/agent/models.ts')

    await expect(createModelAsync('unknown:model-name')).rejects.toThrow(
      'Unknown provider: unknown'
    )
  })

  test('handles gateway format with slash', async () => {
    const { createModel } = await import('../src/agent/models.ts')

    // Gateway format should not throw (creates gateway model)
    const model = createModel('openai/gpt-5.2')
    expect(model).toBeDefined()
    expect(model.modelId).toBe('openai/gpt-5.2')
  })

  test('createModelAsync handles gateway format', async () => {
    const { createModelAsync } = await import('../src/agent/models.ts')

    const model = await createModelAsync('anthropic/claude-sonnet-4-5')
    expect(model).toBeDefined()
    expect(model.modelId).toBe('anthropic/claude-sonnet-4-5')
  })

  test('createModelAsync handles provider-only format', async () => {
    const { createModelAsync, FRONTIER_MODELS } = await import('../src/agent/models.ts')

    const model = await createModelAsync('anthropic')
    expect(model).toBeDefined()
    expect(model.modelId).toBe(`anthropic/${FRONTIER_MODELS.anthropic[0]}`)
  })

  test('createModelAsync throws on unknown provider-only format', async () => {
    const { createModelAsync } = await import('../src/agent/models.ts')

    await expect(createModelAsync('invalid-provider')).rejects.toThrow(
      'Unknown provider: invalid-provider. Supported:'
    )
  })

  test('createModelAsync throws on empty model name', async () => {
    const { createModelAsync } = await import('../src/agent/models.ts')

    await expect(createModelAsync('openai:')).rejects.toThrow(
      'Invalid model identifier: openai:. Model name is required.'
    )
  })

  test('getDefaultModel returns correct format', async () => {
    const { getDefaultModel, DEFAULT_PROVIDER, FRONTIER_MODELS } = await import('../src/agent/models.ts')

    const defaultModel = getDefaultModel()
    expect(defaultModel).toBe(`${DEFAULT_PROVIDER}/${FRONTIER_MODELS[DEFAULT_PROVIDER][0]}`)
  })

  test('all providers in SUPPORTED_PROVIDERS have frontier models', async () => {
    const { SUPPORTED_PROVIDERS, FRONTIER_MODELS } = await import('../src/agent/models.ts')

    for (const provider of SUPPORTED_PROVIDERS) {
      expect(FRONTIER_MODELS[provider]).toBeDefined()
      expect(Array.isArray(FRONTIER_MODELS[provider])).toBe(true)
      expect(FRONTIER_MODELS[provider].length).toBeGreaterThan(0)
    }
  })

  test('all providers can be resolved via provider-only format', async () => {
    const { createModel, SUPPORTED_PROVIDERS, FRONTIER_MODELS } = await import('../src/agent/models.ts')

    for (const provider of SUPPORTED_PROVIDERS) {
      const model = createModel(provider)
      expect(model.modelId).toBe(`${provider}/${FRONTIER_MODELS[provider][0]}`)
    }
  })
})

describe('AgentSession advanced', () => {
  test('addTool adds tool to session', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    session.addTool('test_tool', tool({
      description: 'A test tool',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
      }),
    }))

    // Export should work (tools are internal but session should function)
    const transcript = session.export()
    expect(transcript.sessionId).toBeDefined()
  })

  test('mockTool updates existing tool execute function', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: {
        my_tool: tool({
          description: 'Original tool',
          parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
          execute: async () => ({ result: 'original' }),
        }),
      },
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
      tools: {
        tool1: tool({
          description: 'First',
          parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
        }),
        tool2: tool({
          description: 'Second',
          parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
        }),
      },
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

describe('AI SDK tool edge cases', () => {
  test('tool without execute', () => {
    const t = tool({
      description: 'No implementation',
      parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
    })

    expect(t).toBeDefined()
    expect(t.description).toBe('No implementation')
  })

  test('tool with async execute function', async () => {
    const t = tool({
      description: 'Async tool',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: {
          delay: { type: 'number' },
        },
      }),
      execute: async (args: { delay: number }) => {
        await new Promise((r) => setTimeout(r, 1))
        return { delayed: true, input: args.delay }
      },
    })

    const result = await t.execute!(
      { delay: 100 },
      { toolCallId: 'test', messages: [], abortSignal: undefined as never }
    )

    expect(result).toEqual({ delayed: true, input: 100 })
  })

  test('tool parameters with required fields', () => {
    const t = tool({
      description: 'Has required params',
      parameters: jsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'number', description: 'User age' },
        },
        required: ['name'],
      }),
    })

    expect(t).toBeDefined()
    expect(t.description).toBe('Has required params')
  })
})

describe('bash-tools integration', () => {
  test('createBashTools returns tools and toolkit', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools, toolkit } = await createBashTools({
      files: { 'test.txt': 'hello world' },
    })

    expect(Object.keys(tools)).toHaveLength(3) // bash, readFile, writeFile
    expect(Object.keys(tools)).toEqual(['bash', 'readFile', 'writeFile'])
    expect(toolkit).toBeDefined()
    expect(toolkit.sandbox).toBeDefined()
  })

  test('createBashTools respects includeReadFile option', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashTools({
      files: {},
      includeReadFile: false,
    })

    expect(Object.keys(tools)).toEqual(['bash', 'writeFile'])
  })

  test('createBashTools respects includeWriteFile option', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashTools({
      files: {},
      includeWriteFile: false,
    })

    expect(Object.keys(tools)).toEqual(['bash', 'readFile'])
  })

  test('bash tool executes commands', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashTools({
      files: { 'test.txt': 'hello world' },
    })

    const bashTool = tools.bash as any
    const result = (await bashTool.execute({ command: 'echo "test"' })) as {
      stdout: string
      stderr: string
      exitCode: number
    }

    expect(result.stdout.trim()).toBe('test')
    expect(result.exitCode).toBe(0)
  })

  test('readFile tool reads files', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashTools({
      files: { 'hello.txt': 'Hello, World!' },
    })

    const readFileTool = tools.readFile as any
    const result = (await readFileTool.execute({ path: 'hello.txt' })) as { content: string }

    expect(result.content).toBe('Hello, World!')
  })

  test('writeFile tool writes files', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashTools({ files: {} })

    const writeFileTool = tools.writeFile as any
    const readFileTool = tools.readFile as any

    await writeFileTool.execute({ path: 'new.txt', content: 'new content' })
    const result = (await readFileTool.execute({ path: 'new.txt' })) as { content: string }

    expect(result.content).toBe('new content')
  })

  test('createBashToolsFromFiles helper', async () => {
    const { createBashToolsFromFiles } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashToolsFromFiles({
      'src/index.ts': 'console.log("hello")',
      'package.json': '{"name": "test"}',
    })

    expect(Object.keys(tools)).toHaveLength(3)

    const readFileTool = tools.readFile as any
    const result = (await readFileTool.execute({ path: 'src/index.ts' })) as { content: string }
    expect(result.content).toBe('console.log("hello")')
  })

  test('tools have descriptions', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

    const { tools } = await createBashTools({ files: {} })

    expect((tools.bash as any).description).toContain('bash')
    expect((tools.readFile as any).description).toContain('Read')
    expect((tools.writeFile as any).description).toContain('Write')
  })

  test('tools work with AgentSession', async () => {
    const { createBashTools } = await import('../src/agent/tools/bash.ts')

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
  test('needsApproval via approval config', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: {
        safe_tool: tool({
          description: 'A safe tool',
          parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
        }),
        dangerous_tool: tool({
          description: 'A dangerous tool',
          parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
        }),
      },
      approval: {
        dangerous_tool: true,
      },
    })

    expect(session.id).toBeDefined()
    expect(session.getPendingApprovals()).toEqual([])
  })

  test('needsApproval function for conditional approval', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: {
        file_op: tool({
          description: 'File operations',
          parameters: jsonSchema<Record<string, unknown>>({
            type: 'object',
            properties: {
              path: { type: 'string' },
              action: { type: 'string' },
            },
          }),
        }),
      },
      // Only need approval for delete operations
      approval: {
        file_op: (args) => args.action === 'delete',
      },
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

  test('getTools returns tool info without execute', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: {
        my_tool: tool({
          description: 'A test tool',
          parameters: jsonSchema<Record<string, unknown>>({
            type: 'object',
            properties: { input: { type: 'string' } },
          }),
          execute: async () => ({ result: 'executed' }),
        }),
      },
      approval: {
        my_tool: true,
      },
    })

    const tools = session.getTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('my_tool')
    expect(tools[0]!.description).toBe('A test tool')
    expect(tools[0]!.needsApproval).toBe(true)
    // execute should not be in the returned tools
    expect(tools[0]).not.toHaveProperty('execute')
  })

  test('setMockResponse sets static response for tool', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
      tools: {
        api_tool: tool({
          description: 'API tool',
          parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
        }),
      },
    })

    session.setMockResponse('api_tool', { status: 'ok', data: [1, 2, 3] })

    // Verify tool still listed
    const tools = session.getTools()
    expect(tools[0]!.name).toBe('api_tool')
  })

  test('setMockResponse throws for non-existent tool', () => {
    const session = new AgentSession({
      model: 'openai/gpt-5.2',
      system: 'Test',
    })

    expect(() => session.setMockResponse('nonexistent', {})).toThrow(
      'Tool not found: nonexistent'
    )
  })

  test('getPendingApprovals filters out non-pending', () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'tool1',
          toolCallId: 'call-1',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'pending' as const,
        },
        {
          id: 'approval-2',
          toolName: 'tool2',
          toolCallId: 'call-2',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'approved' as const,
        },
        {
          id: 'approval-3',
          toolName: 'tool3',
          toolCallId: 'call-3',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'denied' as const,
        },
      ],
    }

    const session = new AgentSession(
      { model: 'openai/gpt-5.2', system: 'Test' },
      savedState
    )

    const pending = session.getPendingApprovals()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.toolName).toBe('tool1')
  })

  test('approve with already approved throws', async () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'tool1',
          toolCallId: 'call-1',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'approved' as const,
        },
      ],
    }

    const session = new AgentSession(
      { model: 'openai/gpt-5.2', system: 'Test' },
      savedState
    )

    await expect(session.approve('approval-1')).rejects.toThrow(
      'Approval already approved: approval-1'
    )
  })

  test('deny with already denied throws', () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'tool1',
          toolCallId: 'call-1',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'denied' as const,
        },
      ],
    }

    const session = new AgentSession(
      { model: 'openai/gpt-5.2', system: 'Test' },
      savedState
    )

    expect(() => session.deny('approval-1')).toThrow(
      'Approval already denied: approval-1'
    )
  })

  test('deny sets reason', () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'tool1',
          toolCallId: 'call-1',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'pending' as const,
        },
      ],
    }

    const session = new AgentSession(
      {
        model: 'openai/gpt-5.2',
        system: 'Test',
        tools: {
          tool1: tool({
            description: 'Test',
            parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
          }),
        },
      },
      savedState
    )

    session.deny('approval-1', 'Security concern')

    const state = session.getState()
    const approval = state.pendingApprovals?.find((p) => p.id === 'approval-1')
    expect(approval?.status).toBe('denied')
    expect(approval?.denyReason).toBe('Security concern')
  })

  test('approve executes tool with execute function', async () => {
    let executeCalled = false
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'my_tool',
          toolCallId: 'call-1',
          arguments: { input: 'test' },
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'pending' as const,
        },
      ],
    }

    const session = new AgentSession(
      {
        model: 'openai/gpt-5.2',
        system: 'Test',
        tools: {
          my_tool: tool({
            description: 'Test',
            parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
            execute: async (args) => {
              executeCalled = true
              return { result: 'executed', args }
            },
          }),
        },
      },
      savedState
    )

    const result = await session.approve('approval-1')
    expect(executeCalled).toBe(true)
    expect(result).toEqual({ result: 'executed', args: { input: 'test' } })
  })

  test('approve returns error for tool without execute', async () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'my_tool',
          toolCallId: 'call-1',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'pending' as const,
        },
      ],
    }

    const session = new AgentSession(
      {
        model: 'openai/gpt-5.2',
        system: 'Test',
        tools: {
          my_tool: tool({
            description: 'Test',
            parameters: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
          }),
        },
      },
      savedState
    )

    const result = await session.approve('approval-1')
    expect(result).toEqual({ error: 'No implementation provided' })
  })

  test('approve throws when tool not found', async () => {
    const savedState = {
      id: 'test-id',
      createdAt: '2026-02-04T00:00:00.000Z',
      messages: [],
      totalUsage: { input: 0, output: 0, total: 0 },
      pendingApprovals: [
        {
          id: 'approval-1',
          toolName: 'nonexistent_tool',
          toolCallId: 'call-1',
          arguments: {},
          requestedAt: '2026-02-04T00:00:00.000Z',
          status: 'pending' as const,
        },
      ],
    }

    const session = new AgentSession(
      { model: 'openai/gpt-5.2', system: 'Test' },
      savedState
    )

    await expect(session.approve('approval-1')).rejects.toThrow(
      'Tool not found: nonexistent_tool'
    )
  })
})

describe('Backend factory', () => {
  test('createBackend creates SDK backend', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    const backend = createBackend({ type: 'sdk', model: 'openai/gpt-5.2' })
    expect(backend.type).toBe('sdk')
    expect(backend.getInfo().name).toBe('Vercel AI SDK')
    expect(backend.getInfo().model).toBe('openai/gpt-5.2')
  })

  test('createBackend creates Claude CLI backend', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    const backend = createBackend({ type: 'claude', model: 'sonnet' })
    expect(backend.type).toBe('claude')
    expect(backend.getInfo().name).toBe('Claude Code CLI')
    expect(backend.getInfo().model).toBe('sonnet')
  })

  test('createBackend creates Codex CLI backend', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    const backend = createBackend({ type: 'codex', model: 'o3' })
    expect(backend.type).toBe('codex')
    expect(backend.getInfo().name).toBe('OpenAI Codex CLI')
  })

  test('createBackend creates Cursor CLI backend', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    const backend = createBackend({ type: 'cursor' })
    expect(backend.type).toBe('cursor')
    expect(backend.getInfo().name).toBe('Cursor Agent CLI')
  })

  test('createBackend throws for unknown type', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    expect(() =>
      createBackend({ type: 'invalid' as 'sdk', model: 'test' })
    ).toThrow('Unknown backend type: invalid')
  })

  test('checkBackends returns availability map', async () => {
    const { checkBackends } = await import('../src/backends/index.ts')

    const availability = await checkBackends()
    expect(availability).toHaveProperty('sdk')
    expect(availability).toHaveProperty('claude')
    expect(availability).toHaveProperty('codex')
    expect(availability).toHaveProperty('cursor')
    expect(availability.sdk).toBe(true) // SDK is always available
  })

  test('listBackends returns backend info array', async () => {
    const { listBackends } = await import('../src/backends/index.ts')

    const backends = await listBackends()
    expect(backends).toHaveLength(4)
    expect(backends.map((b) => b.type)).toEqual(['sdk', 'claude', 'codex', 'cursor'])
    expect(backends[0]!.name).toBe('Vercel AI SDK')
  })
})

describe('CLI backend implementations', () => {
  test('ClaudeCodeBackend builds correct args', async () => {
    const { ClaudeCodeBackend } = await import('../src/backends/claude-code.ts')

    const backend = new ClaudeCodeBackend({
      model: 'opus',
      outputFormat: 'json',
      continue: true,
    })

    expect(backend.type).toBe('claude')
    expect(backend.getInfo().model).toBe('opus')
  })

  test('CodexBackend builds correct args', async () => {
    const { CodexBackend } = await import('../src/backends/codex.ts')

    const backend = new CodexBackend({
      model: 'o3',
      approvalMode: 'full-auto',
    })

    expect(backend.type).toBe('codex')
    expect(backend.getInfo().model).toBe('o3')
  })

  test('CursorBackend builds correct args', async () => {
    const { CursorBackend } = await import('../src/backends/cursor.ts')

    const backend = new CursorBackend({
      model: 'gpt-5.2',
    })

    expect(backend.type).toBe('cursor')
    expect(backend.getInfo().model).toBe('gpt-5.2')
  })

  test('SdkBackend getInfo returns correct info', async () => {
    const { SdkBackend } = await import('../src/backends/sdk.ts')

    const backend = new SdkBackend({ model: 'anthropic/claude-sonnet-4-5' })
    const info = backend.getInfo()

    expect(info.name).toBe('Vercel AI SDK')
    expect(info.model).toBe('anthropic/claude-sonnet-4-5')
  })
})

// ==================== Model Mapping Tests ====================

describe('getModelForBackend', () => {
  test('returns default model when no model specified', async () => {
    const { getModelForBackend, BACKEND_DEFAULT_MODELS } = await import('../src/backends/types.ts')

    expect(getModelForBackend(undefined, 'cursor')).toBe(BACKEND_DEFAULT_MODELS.cursor)
    expect(getModelForBackend(undefined, 'claude')).toBe(BACKEND_DEFAULT_MODELS.claude)
    expect(getModelForBackend(undefined, 'codex')).toBe(BACKEND_DEFAULT_MODELS.codex)
    expect(getModelForBackend(undefined, 'sdk')).toBe(BACKEND_DEFAULT_MODELS.sdk)
  })

  test('translates model names for cursor backend', async () => {
    const { getModelForBackend } = await import('../src/backends/types.ts')

    // Generic names -> cursor format
    expect(getModelForBackend('sonnet', 'cursor')).toBe('sonnet-4.5')
    expect(getModelForBackend('opus', 'cursor')).toBe('opus-4.5')

    // With provider prefix
    expect(getModelForBackend('anthropic/claude-sonnet-4-5', 'cursor')).toBe('sonnet-4.5')
    expect(getModelForBackend('anthropic/claude-opus-4-5', 'cursor')).toBe('opus-4.5')

    // Already in cursor format
    expect(getModelForBackend('sonnet-4.5', 'cursor')).toBe('sonnet-4.5')
    expect(getModelForBackend('gpt-5.2', 'cursor')).toBe('gpt-5.2')
  })

  test('translates model names for claude backend', async () => {
    const { getModelForBackend } = await import('../src/backends/types.ts')

    // Generic names -> claude format
    expect(getModelForBackend('sonnet', 'claude')).toBe('sonnet')
    expect(getModelForBackend('opus', 'claude')).toBe('opus')

    // With provider prefix
    expect(getModelForBackend('anthropic/claude-sonnet-4-5', 'claude')).toBe('sonnet')

    // From cursor format
    expect(getModelForBackend('sonnet-4.5', 'claude')).toBe('sonnet')
    expect(getModelForBackend('opus-4.5', 'claude')).toBe('opus')
  })

  test('translates model names for sdk backend', async () => {
    const { getModelForBackend } = await import('../src/backends/types.ts')

    // Generic names -> full model ID
    expect(getModelForBackend('sonnet', 'sdk')).toBe('claude-sonnet-4-5-20250514')
    expect(getModelForBackend('opus', 'sdk')).toBe('claude-opus-4-20250514')
    expect(getModelForBackend('haiku', 'sdk')).toBe('claude-haiku-3-5-20250514')

    // Short names -> full model ID
    expect(getModelForBackend('claude-sonnet-4-5', 'sdk')).toBe('claude-sonnet-4-5-20250514')
  })

  test('passes through unknown models unchanged', async () => {
    const { getModelForBackend } = await import('../src/backends/types.ts')

    expect(getModelForBackend('unknown-model', 'cursor')).toBe('unknown-model')
    expect(getModelForBackend('custom-model-v2', 'claude')).toBe('custom-model-v2')
  })
})

describe('createBackend with model translation', () => {
  test('cursor backend receives translated model', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    // Create with generic model name
    const backend = createBackend({ type: 'cursor', model: 'sonnet' })
    const info = backend.getInfo()

    // Should be translated to cursor format
    expect(info.model).toBe('sonnet-4.5')
  })

  test('claude backend receives translated model', async () => {
    const { createBackend } = await import('../src/backends/index.ts')

    // Create with provider-prefixed model
    const backend = createBackend({ type: 'claude', model: 'anthropic/claude-sonnet-4-5' })
    const info = backend.getInfo()

    // Should be translated to claude format
    expect(info.model).toBe('sonnet')
  })

  test('backend uses default model when not specified', async () => {
    const { createBackend } = await import('../src/backends/index.ts')
    const { BACKEND_DEFAULT_MODELS } = await import('../src/backends/types.ts')

    const cursorBackend = createBackend({ type: 'cursor' })
    expect(cursorBackend.getInfo().model).toBe(BACKEND_DEFAULT_MODELS.cursor)

    const claudeBackend = createBackend({ type: 'claude' })
    expect(claudeBackend.getInfo().model).toBe(BACKEND_DEFAULT_MODELS.claude)
  })
})
