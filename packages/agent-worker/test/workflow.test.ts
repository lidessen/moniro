import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ==================== Interpolate Tests ====================

import {
  interpolate,
  hasVariables,
  extractVariables,
  evaluateCondition,
  createContext,
  type VariableContext,
} from '../src/workflow/interpolate.ts'

describe('interpolate', () => {
  test('interpolates simple variable', () => {
    const context: VariableContext = { name: 'world' }
    expect(interpolate('Hello ${{ name }}', context)).toBe('Hello world')
  })

  test('interpolates multiple variables', () => {
    const context: VariableContext = { first: 'John', last: 'Doe' }
    expect(interpolate('${{ first }} ${{ last }}', context)).toBe('John Doe')
  })

  test('handles missing variables by keeping original', () => {
    const context: VariableContext = {}
    expect(interpolate('Hello ${{ name }}', context)).toBe('Hello ${{ name }}')
  })

  test('handles whitespace in variable syntax', () => {
    const context: VariableContext = { name: 'test' }
    expect(interpolate('${{name}}', context)).toBe('test')
    expect(interpolate('${{  name  }}', context)).toBe('test')
    expect(interpolate('${{ name }}', context)).toBe('test')
  })

  test('interpolates env variables', () => {
    const context: VariableContext = { env: { MY_VAR: 'my-value' } }
    expect(interpolate('${{ env.MY_VAR }}', context)).toBe('my-value')
  })

  test('falls back to process.env for env variables', () => {
    const context: VariableContext = {}
    // PATH should always exist
    const result = interpolate('${{ env.PATH }}', context)
    expect(result).not.toBe('${{ env.PATH }}')
  })

  test('interpolates workflow.name', () => {
    const context: VariableContext = {
      workflow: { name: 'my-workflow', instance: 'default' },
    }
    expect(interpolate('Workflow: ${{ workflow.name }}', context)).toBe('Workflow: my-workflow')
  })

  test('interpolates workflow.instance', () => {
    const context: VariableContext = {
      workflow: { name: 'test', instance: 'prod' },
    }
    expect(interpolate('Instance: ${{ workflow.instance }}', context)).toBe('Instance: prod')
  })

  test('handles unknown workflow fields', () => {
    const context: VariableContext = {
      workflow: { name: 'test', instance: 'default' },
    }
    expect(interpolate('${{ workflow.unknown }}', context)).toBe('${{ workflow.unknown }}')
  })

  test('handles mixed variable types', () => {
    const context: VariableContext = {
      output: 'result',
      env: { USER: 'testuser' },
      workflow: { name: 'mixed', instance: 'dev' },
    }
    const template = 'Output: ${{ output }}, User: ${{ env.USER }}, Workflow: ${{ workflow.name }}'
    expect(interpolate(template, context)).toBe('Output: result, User: testuser, Workflow: mixed')
  })

  test('returns original string if no variables', () => {
    const context: VariableContext = { name: 'test' }
    expect(interpolate('Hello world', context)).toBe('Hello world')
  })
})

describe('hasVariables', () => {
  test('returns true for string with variables', () => {
    expect(hasVariables('Hello ${{ name }}')).toBe(true)
  })

  test('returns false for string without variables', () => {
    expect(hasVariables('Hello world')).toBe(false)
  })

  test('returns true for multiple variables', () => {
    expect(hasVariables('${{ a }} and ${{ b }}')).toBe(true)
  })
})

describe('extractVariables', () => {
  test('extracts single variable', () => {
    expect(extractVariables('Hello ${{ name }}')).toEqual(['name'])
  })

  test('extracts multiple variables', () => {
    expect(extractVariables('${{ a }} ${{ b }} ${{ c }}')).toEqual(['a', 'b', 'c'])
  })

  test('returns empty array for no variables', () => {
    expect(extractVariables('Hello world')).toEqual([])
  })

  test('extracts env and workflow variables', () => {
    const template = '${{ env.PATH }} ${{ workflow.name }} ${{ output }}'
    expect(extractVariables(template)).toEqual(['env.PATH', 'workflow.name', 'output'])
  })
})

describe('evaluateCondition', () => {
  test('evaluates .contains() true', () => {
    const context: VariableContext = { text: 'hello world' }
    expect(evaluateCondition('${{ text }}.contains("world")', context)).toBe(true)
  })

  test('evaluates .contains() false', () => {
    const context: VariableContext = { text: 'hello world' }
    expect(evaluateCondition('${{ text }}.contains("foo")', context)).toBe(false)
  })

  test('evaluates .startsWith() true', () => {
    const context: VariableContext = { text: 'hello world' }
    expect(evaluateCondition('${{ text }}.startsWith("hello")', context)).toBe(true)
  })

  test('evaluates .startsWith() false', () => {
    const context: VariableContext = { text: 'hello world' }
    expect(evaluateCondition('${{ text }}.startsWith("world")', context)).toBe(false)
  })

  test('evaluates .endsWith() true', () => {
    const context: VariableContext = { text: 'hello world' }
    expect(evaluateCondition('${{ text }}.endsWith("world")', context)).toBe(true)
  })

  test('evaluates .endsWith() false', () => {
    const context: VariableContext = { text: 'hello world' }
    expect(evaluateCondition('${{ text }}.endsWith("hello")', context)).toBe(false)
  })

  test('evaluates == equality true', () => {
    const context: VariableContext = { status: 'success' }
    expect(evaluateCondition('${{ status }} == "success"', context)).toBe(true)
  })

  test('evaluates == equality false', () => {
    const context: VariableContext = { status: 'failure' }
    expect(evaluateCondition('${{ status }} == "success"', context)).toBe(false)
  })

  test('evaluates === equality', () => {
    const context: VariableContext = { status: 'ok' }
    expect(evaluateCondition('${{ status }} === "ok"', context)).toBe(true)
  })

  test('evaluates != inequality true', () => {
    const context: VariableContext = { status: 'failure' }
    expect(evaluateCondition('${{ status }} != "success"', context)).toBe(true)
  })

  test('evaluates != inequality false', () => {
    const context: VariableContext = { status: 'success' }
    expect(evaluateCondition('${{ status }} != "success"', context)).toBe(false)
  })

  test('evaluates !== inequality', () => {
    const context: VariableContext = { status: 'error' }
    expect(evaluateCondition('${{ status }} !== "success"', context)).toBe(true)
  })

  test('evaluates truthy variable', () => {
    const context: VariableContext = { value: 'something' }
    expect(evaluateCondition('${{ value }}', context)).toBe(true)
  })

  test('returns false for unresolved variable', () => {
    const context: VariableContext = {}
    expect(evaluateCondition('${{ undefined_var }}', context)).toBe(false)
  })

  test('handles single quotes in conditions', () => {
    const context: VariableContext = { name: 'test' }
    expect(evaluateCondition("${{ name }}.contains('test')", context)).toBe(true)
  })
})

describe('createContext', () => {
  test('creates context with workflow metadata', () => {
    const context = createContext('my-workflow', 'production')
    expect(context.workflow?.name).toBe('my-workflow')
    expect(context.workflow?.instance).toBe('production')
  })

  test('includes task outputs', () => {
    const context = createContext('test', 'default', { output1: 'value1', output2: 'value2' })
    expect(context.output1).toBe('value1')
    expect(context.output2).toBe('value2')
  })

  test('includes env reference', () => {
    const context = createContext('test', 'default')
    expect(context.env).toBeDefined()
  })
})

// ==================== Parser Tests ====================

import {
  validateWorkflow,
  getReferencedAgents,
  parseWorkflowFile,
} from '../src/workflow/parser.ts'

describe('validateWorkflow', () => {
  test('validates minimal valid workflow', () => {
    const workflow = {
      agents: {
        assistant: {
          model: 'anthropic/claude-sonnet-4-5',
          system_prompt: 'You are helpful.',
        },
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('rejects non-object workflow', () => {
    expect(validateWorkflow(null).valid).toBe(false)
    expect(validateWorkflow('string').valid).toBe(false)
    expect(validateWorkflow(123).valid).toBe(false)
  })

  test('requires agents field', () => {
    const result = validateWorkflow({})
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'agents')).toBe(true)
  })

  test('validates agent model is required', () => {
    const workflow = {
      agents: {
        test: {
          system_prompt: 'Hello',
        },
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path.includes('model'))).toBe(true)
  })

  test('validates agent system_prompt is required', () => {
    const workflow = {
      agents: {
        test: {
          model: 'openai/gpt-5.2',
        },
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path.includes('system_prompt'))).toBe(true)
  })

  test('validates agent must be object', () => {
    const workflow = {
      agents: {
        test: 'not an object',
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates tasks must be array', () => {
    const workflow = {
      agents: {
        test: { model: 'test', system_prompt: 'test' },
      },
      tasks: 'not an array',
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'tasks')).toBe(true)
  })

  test('validates shell task', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ shell: 'echo hello' }],
    }
    expect(validateWorkflow(workflow).valid).toBe(true)
  })

  test('validates shell must be string', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ shell: 123 }],
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates send task requires to field', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ send: 'message' }],
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('to'))).toBe(true)
  })

  test('validates send task with to field', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ send: 'message', to: 'a' }],
    }
    expect(validateWorkflow(workflow).valid).toBe(true)
  })

  test('validates conditional task requires shell or send', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ if: 'condition' }],
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('shell'))).toBe(true)
  })

  test('validates conditional task with shell', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ if: 'condition', shell: 'echo hi' }],
    }
    expect(validateWorkflow(workflow).valid).toBe(true)
  })

  test('validates conditional task with send', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ if: 'condition', send: 'message', to: 'a' }],
    }
    expect(validateWorkflow(workflow).valid).toBe(true)
  })

  test('validates parallel task', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [
        {
          parallel: [
            { shell: 'echo 1' },
            { shell: 'echo 2' },
          ],
        },
      ],
    }
    expect(validateWorkflow(workflow).valid).toBe(true)
  })

  test('validates parallel must be array', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ parallel: 'not array' }],
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates nested parallel tasks', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [
        {
          parallel: [
            { shell: 123 }, // Invalid
          ],
        },
      ],
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates task must have type', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: [{ as: 'output' }], // No shell, send, if, or parallel
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates task must be object', () => {
    const workflow = {
      agents: { a: { model: 'm', system_prompt: 's' } },
      tasks: ['not an object'],
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates optional tools must be array', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's', tools: 'not array' },
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })
})

describe('getReferencedAgents', () => {
  test('returns empty set for no tasks', () => {
    expect(getReferencedAgents([]).size).toBe(0)
  })

  test('extracts agent from send task', () => {
    const tasks = [{ send: 'message', to: 'assistant' }]
    const agents = getReferencedAgents(tasks as any)
    expect(agents.has('assistant')).toBe(true)
  })

  test('extracts agents from multiple tasks', () => {
    const tasks = [
      { send: 'msg1', to: 'agent1' },
      { send: 'msg2', to: 'agent2' },
      { shell: 'echo' },
      { send: 'msg3', to: 'agent1' }, // Duplicate
    ]
    const agents = getReferencedAgents(tasks as any)
    expect(agents.size).toBe(2)
    expect(agents.has('agent1')).toBe(true)
    expect(agents.has('agent2')).toBe(true)
  })

  test('extracts agents from conditional tasks', () => {
    const tasks = [{ if: 'condition', send: 'msg', to: 'conditional-agent' }]
    const agents = getReferencedAgents(tasks as any)
    expect(agents.has('conditional-agent')).toBe(true)
  })

  test('extracts agents from parallel tasks', () => {
    const tasks = [
      {
        parallel: [
          { send: 'msg1', to: 'parallel-agent1' },
          { send: 'msg2', to: 'parallel-agent2' },
        ],
      },
    ]
    const agents = getReferencedAgents(tasks as any)
    expect(agents.has('parallel-agent1')).toBe(true)
    expect(agents.has('parallel-agent2')).toBe(true)
  })

  test('ignores shell tasks', () => {
    const tasks = [{ shell: 'echo hello' }]
    const agents = getReferencedAgents(tasks as any)
    expect(agents.size).toBe(0)
  })
})

describe('parseWorkflowFile', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `workflow-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('parses valid workflow file', async () => {
    const workflowPath = join(testDir, 'test.yml')
    writeFileSync(
      workflowPath,
      `name: test-workflow
agents:
  assistant:
    model: openai/gpt-5.2
    system_prompt: You are helpful.
tasks:
  - shell: echo hello
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.name).toBe('test-workflow')
    expect(workflow.agents.assistant).toBeDefined()
    expect(workflow.agents.assistant.model).toBe('openai/gpt-5.2')
    expect(workflow.tasks).toHaveLength(1)
  })

  test('uses filename as name if not specified', async () => {
    const workflowPath = join(testDir, 'my-workflow.yml')
    writeFileSync(
      workflowPath,
      `agents:
  a:
    model: test
    system_prompt: test
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.name).toBe('my-workflow')
  })

  test('throws for non-existent file', async () => {
    await expect(parseWorkflowFile('/nonexistent/file.yml')).rejects.toThrow('not found')
  })

  test('throws for invalid YAML', async () => {
    const workflowPath = join(testDir, 'invalid.yml')
    writeFileSync(workflowPath, 'this: is: not: valid: yaml: [')

    await expect(parseWorkflowFile(workflowPath)).rejects.toThrow('Failed to parse YAML')
  })

  test('throws for invalid workflow structure', async () => {
    const workflowPath = join(testDir, 'bad.yml')
    writeFileSync(workflowPath, 'not_agents: true')

    await expect(parseWorkflowFile(workflowPath)).rejects.toThrow('Invalid workflow file')
  })

  test('resolves system_prompt from file', async () => {
    const promptPath = join(testDir, 'prompt.txt')
    writeFileSync(promptPath, 'You are a code reviewer.')

    const workflowPath = join(testDir, 'workflow.yml')
    writeFileSync(
      workflowPath,
      `agents:
  reviewer:
    model: test
    system_prompt: prompt.txt
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.agents.reviewer.resolvedSystemPrompt).toBe('You are a code reviewer.')
  })

  test('resolves .md system_prompt file', async () => {
    const promptPath = join(testDir, 'system.md')
    writeFileSync(promptPath, '# Assistant\nYou help users.')

    const workflowPath = join(testDir, 'workflow.yml')
    writeFileSync(
      workflowPath,
      `agents:
  helper:
    model: test
    system_prompt: system.md
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.agents.helper.resolvedSystemPrompt).toContain('# Assistant')
  })

  test('keeps literal system_prompt if file not found', async () => {
    const workflowPath = join(testDir, 'workflow.yml')
    writeFileSync(
      workflowPath,
      `agents:
  test:
    model: test
    system_prompt: nonexistent.txt
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.agents.test.resolvedSystemPrompt).toBe('nonexistent.txt')
  })

  test('defaults to empty tasks array', async () => {
    const workflowPath = join(testDir, 'no-tasks.yml')
    writeFileSync(
      workflowPath,
      `agents:
  a:
    model: test
    system_prompt: test
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.tasks).toEqual([])
  })
})

// ==================== Runner Tests ====================

import { runWorkflow, type RunConfig } from '../src/workflow/runner.ts'

describe('runWorkflow', () => {
  const mockAgent = {
    model: 'test',
    system_prompt: 'test',
    resolvedSystemPrompt: 'test',
  }

  test('runs empty workflow', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'empty',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.output).toBe('')
  })

  test('runs shell task', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'shell-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ shell: 'echo hello' }],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.output).toBe('hello')
  })

  test('captures shell output with as', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'capture-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ shell: 'echo captured', as: 'output' }],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.results.output).toBe('captured')
  })

  test('interpolates variables in shell', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'interpolate-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [
          { shell: 'echo first', as: 'first' },
          { shell: 'echo ${{ first }}', as: 'second' },
        ],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.results.second).toBe('first')
  })

  test('runs send task', async () => {
    let sentMessage = ''
    const result = await runWorkflow({
      workflow: {
        name: 'send-test',
        filePath: 'test.yml',
        agents: { assistant: mockAgent },
        tasks: [{ send: 'Hello agent', to: 'assistant' }],
      },
      startAgent: async () => {},
      sendToAgent: async (agent, msg) => {
        sentMessage = msg
        return 'Agent response'
      },
    })

    expect(result.success).toBe(true)
    expect(result.output).toBe('Agent response')
    expect(sentMessage).toContain('Hello agent')
    expect(sentMessage).toContain('[Task Mode]')
  })

  test('captures send output with as', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'send-capture-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ send: 'Test', to: 'a', as: 'response' }],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'Captured response',
    })

    expect(result.success).toBe(true)
    expect(result.results.response).toBe('Captured response')
  })

  test('handles as object with name and prompt', async () => {
    let outputPrompt = ''
    const result = await runWorkflow({
      workflow: {
        name: 'as-object-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [
          {
            send: 'Analyze this',
            to: 'a',
            as: { name: 'summary', prompt: 'Summarize in one line' },
          },
        ],
      },
      startAgent: async () => {},
      sendToAgent: async (agent, msg, prompt) => {
        outputPrompt = prompt || ''
        return 'Summary result'
      },
    })

    expect(result.success).toBe(true)
    expect(result.results.summary).toBe('Summary result')
    expect(outputPrompt).toBe('Summarize in one line')
  })

  test('runs conditional task when condition true', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'conditional-true-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [
          { shell: 'echo success', as: 'status' },
          { if: '${{ status }}.contains("success")', shell: 'echo passed', as: 'result' },
        ],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.results.result).toBe('passed')
  })

  test('skips conditional task when condition false', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'conditional-false-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [
          { shell: 'echo failure', as: 'status' },
          { if: '${{ status }} == "success"', shell: 'echo should-not-run', as: 'skipped' },
        ],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.results.skipped).toBeUndefined()
  })

  test('runs parallel tasks', async () => {
    const startTimes: number[] = []
    const result = await runWorkflow({
      workflow: {
        name: 'parallel-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [
          {
            parallel: [
              { shell: 'echo one', as: 'p1' },
              { shell: 'echo two', as: 'p2' },
            ],
          },
        ],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(true)
    expect(result.results.p1).toBe('one')
    expect(result.results.p2).toBe('two')
  })

  test('starts agents in eager mode', async () => {
    const startedAgents: string[] = []
    await runWorkflow({
      workflow: {
        name: 'eager-test',
        filePath: 'test.yml',
        agents: {
          a: mockAgent,
          b: mockAgent,
        },
        tasks: [],
      },
      lazy: false,
      startAgent: async (name) => {
        startedAgents.push(name)
      },
      sendToAgent: async () => 'response',
    })

    expect(startedAgents).toContain('a')
    expect(startedAgents).toContain('b')
  })

  test('starts agents lazily when lazy=true', async () => {
    const startedAgents: string[] = []
    await runWorkflow({
      workflow: {
        name: 'lazy-test',
        filePath: 'test.yml',
        agents: {
          a: mockAgent,
          b: mockAgent,
        },
        tasks: [{ send: 'Hello', to: 'a' }],
      },
      lazy: true,
      startAgent: async (name) => {
        startedAgents.push(name)
      },
      sendToAgent: async () => 'response',
    })

    expect(startedAgents).toEqual(['a']) // Only 'a' was used
  })

  test('handles agent start failure', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'fail-start-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [],
      },
      startAgent: async () => {
        throw new Error('Start failed')
      },
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Start failed')
  })

  test('handles shell command failure', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'shell-fail-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ shell: 'exit 1' }],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Shell command failed')
  })

  test('handles undefined agent in send', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'undefined-agent-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ send: 'Hello', to: 'nonexistent' }],
      },
      lazy: true,
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Agent not defined: nonexistent')
  })

  test('verbose mode logs output', async () => {
    const logs: string[] = []
    await runWorkflow({
      workflow: {
        name: 'verbose-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ shell: 'echo test' }],
      },
      verbose: true,
      log: (msg) => logs.push(msg),
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(logs.some(l => l.includes('Starting agents'))).toBe(true)
    expect(logs.some(l => l.includes('Task 1/1'))).toBe(true)
  })

  test('returns duration', async () => {
    const result = await runWorkflow({
      workflow: {
        name: 'duration-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [{ shell: 'echo fast' }],
      },
      startAgent: async () => {},
      sendToAgent: async () => 'response',
    })

    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  test('conditional send task', async () => {
    let sentTo = ''
    const result = await runWorkflow({
      workflow: {
        name: 'conditional-send-test',
        filePath: 'test.yml',
        agents: { a: mockAgent },
        tasks: [
          { shell: 'echo yes', as: 'flag' },
          { if: '${{ flag }} == "yes"', send: 'Conditional message', to: 'a', as: 'response' },
        ],
      },
      startAgent: async () => {},
      sendToAgent: async (agent) => {
        sentTo = agent
        return 'Sent!'
      },
    })

    expect(result.success).toBe(true)
    expect(sentTo).toBe('a')
    expect(result.results.response).toBe('Sent!')
  })
})
