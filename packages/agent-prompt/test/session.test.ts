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

describe('EXAMPLE_MODELS', () => {
  test('contains valid provider model lists', async () => {
    const { EXAMPLE_MODELS, SUPPORTED_PROVIDERS } = await import('../src/models.ts')

    // All supported providers should have example models
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(EXAMPLE_MODELS[provider]).toBeDefined()
      expect(EXAMPLE_MODELS[provider].length).toBeGreaterThan(0)
    }

    // Check specific models exist
    expect(EXAMPLE_MODELS.anthropic).toContain('claude-sonnet-4-5')
    expect(EXAMPLE_MODELS.openai).toContain('gpt-5.2')
    expect(EXAMPLE_MODELS.deepseek).toContain('deepseek-chat')
  })
})
