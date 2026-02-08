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
      workflow: { name: 'my-workflow', tag: 'default', instance: 'default' },
    }
    expect(interpolate('Workflow: ${{ workflow.name }}', context)).toBe('Workflow: my-workflow')
  })

  test('interpolates workflow.instance', () => {
    const context: VariableContext = {
      workflow: { name: 'test', tag: 'prod', instance: 'prod' },
    }
    expect(interpolate('Instance: ${{ workflow.instance }}', context)).toBe('Instance: prod')
  })

  test('handles unknown workflow fields', () => {
    const context: VariableContext = {
      workflow: { name: 'test', tag: 'default', instance: 'default' },
    }
    expect(interpolate('${{ workflow.unknown }}', context)).toBe('${{ workflow.unknown }}')
  })

  test('handles mixed variable types', () => {
    const context: VariableContext = {
      output: 'result',
      env: { USER: 'testuser' },
      workflow: { name: 'mixed', tag: 'dev', instance: 'dev' },
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
    expect(context.workflow?.tag).toBe('production') // New tag field
    expect(context.workflow?.instance).toBe('production') // Backward compat
  })

  test('tag and instance fields are synchronized', () => {
    const context = createContext('test-workflow', 'pr-123')
    expect(context.workflow?.tag).toBe('pr-123')
    expect(context.workflow?.instance).toBe('pr-123')
    // Both should have the same value for backward compatibility
    expect(context.workflow?.tag).toBe(context.workflow?.instance)
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

  test('validates agent system_prompt is optional', () => {
    const workflow = {
      agents: {
        test: {
          model: 'openai/gpt-5.2',
        },
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(true)
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

  test('validates optional tools must be array', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's', tools: 'not array' },
      },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
  })

  test('validates bare file provider without config', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's' },
      },
      context: { provider: 'file' },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(true)
  })

  test('validates context config.bind', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's' },
      },
      context: { provider: 'file', config: { bind: '.agent-context/' } },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(true)
  })

  test('rejects non-string config.bind value', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's' },
      },
      context: { provider: 'file', config: { bind: 123 } },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'context.config.bind')).toBe(true)
  })

  test('rejects config with both dir and bind', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's' },
      },
      context: { provider: 'file', config: { dir: './a/', bind: './b/' } },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'context.config')).toBe(true)
  })

  test('validates bind with documentOwner', () => {
    const workflow = {
      agents: {
        a: { model: 'm', system_prompt: 's' },
      },
      context: { provider: 'file', config: { bind: './ctx/' }, documentOwner: 'a' },
    }
    const result = validateWorkflow(workflow)
    expect(result.valid).toBe(true)
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
context: null
kickoff: "@assistant start working"
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.name).toBe('test-workflow')
    expect(workflow.agents.assistant).toBeDefined()
    expect(workflow.agents.assistant.model).toBe('openai/gpt-5.2')
    expect(workflow.kickoff).toBe('@assistant start working')
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

  test('defaults to empty setup array', async () => {
    const workflowPath = join(testDir, 'no-setup.yml')
    writeFileSync(
      workflowPath,
      `agents:
  a:
    model: test
    system_prompt: test
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.setup).toEqual([])
  })

  test('parses config.bind as persistent file provider', async () => {
    const workflowPath = join(testDir, 'bind-workflow.yml')
    writeFileSync(
      workflowPath,
      `agents:
  reviewer:
    model: test
    system_prompt: test
context:
  provider: file
  config:
    bind: .agent-context/
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.context).toBeDefined()
    expect(workflow.context!.provider).toBe('file')
    expect((workflow.context as any).persistent).toBe(true)
    expect((workflow.context as any).dir).toBe(join(testDir, '.agent-context/'))
  })

  test('parses config.bind with instance template', async () => {
    const workflowPath = join(testDir, 'bind-instance.yml')
    writeFileSync(
      workflowPath,
      `agents:
  a:
    model: test
    system_prompt: test
context:
  provider: file
  config:
    bind: .ctx/${'${{ instance }}'}/
`
    )

    const workflow = await parseWorkflowFile(workflowPath, { instance: 'pr-42' })
    expect((workflow.context as any).dir).toBe(join(testDir, '.ctx/pr-42/'))
    expect((workflow.context as any).persistent).toBe(true)
  })

  test('parses config.bind with new tag parameter', async () => {
    const workflowPath = join(testDir, 'bind-tag.yml')
    writeFileSync(
      workflowPath,
      `agents:
  a:
    model: test
    system_prompt: test
context:
  provider: file
  config:
    bind: .ctx/${'${{ workflow.tag }}'}/
`
    )

    const workflow = await parseWorkflowFile(workflowPath, { tag: 'pr-123' })
    expect((workflow.context as any).dir).toBe(join(testDir, '.ctx/pr-123/'))
    expect((workflow.context as any).persistent).toBe(true)
  })

  test('supports workflow.name and workflow.tag templates', async () => {
    const workflowPath = join(testDir, 'template-new.yml')
    writeFileSync(
      workflowPath,
      `name: review
agents:
  a:
    model: test
    system_prompt: test
context:
  provider: file
  config:
    bind: ./data/${'${{ workflow.name }}'}/${'${{ workflow.tag }}'}/
`
    )

    const workflow = await parseWorkflowFile(workflowPath, { tag: 'pr-456' })
    expect((workflow.context as any).dir).toBe(join(testDir, './data/review/pr-456/'))
    expect((workflow.context as any).persistent).toBe(true)
  })

  test('parses config.bind with documentOwner', async () => {
    const workflowPath = join(testDir, 'bind-owner.yml')
    writeFileSync(
      workflowPath,
      `agents:
  lead:
    model: test
    system_prompt: test
context:
  provider: file
  config:
    bind: ./shared-ctx/
  documentOwner: lead
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect((workflow.context as any).persistent).toBe(true)
    expect((workflow.context as any).documentOwner).toBe('lead')
  })

  test('config.dir does not have persistent flag', async () => {
    const workflowPath = join(testDir, 'non-bind.yml')
    writeFileSync(
      workflowPath,
      `agents:
  a:
    model: test
    system_prompt: test
context:
  provider: file
  config:
    dir: ./my-ctx/
`
    )

    const workflow = await parseWorkflowFile(workflowPath)
    expect(workflow.context!.provider).toBe('file')
    expect((workflow.context as any).persistent).toBeUndefined()
  })
})

// ==================== Runner Tests ====================

import { runWorkflow } from '../src/workflow/runner.ts'
import type { ParsedWorkflow } from '../src/workflow/types.ts'

describe('runWorkflow', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `workflow-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('initializes v2 workflow with context', async () => {
    const contextDir = join(testDir, 'context')
    const workflow: ParsedWorkflow = {
      name: 'test-workflow',
      filePath: 'test.yml',
      agents: {
        agent1: {
          model: 'test',
          resolvedSystemPrompt: 'You are a test agent',
        },
      },
      setup: [],
      context: { provider: 'file', dir: contextDir },
      kickoff: '@agent1 please start working',
    }

    const startedAgents: string[] = []
    const result = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async (name) => {
        startedAgents.push(name)
      },
    })

    expect(result.success).toBe(true)
    expect(result.mcpUrl).toBeDefined()
    expect(result.contextProvider).toBeDefined()
    expect(result.agentNames).toEqual(['agent1'])
    expect(startedAgents).toEqual(['agent1'])

    // Cleanup
    if (result.shutdown) {
      await result.shutdown()
    }
  })

  test('runs setup tasks before kickoff', async () => {
    const contextDir = join(testDir, 'context')
    const workflow: ParsedWorkflow = {
      name: 'setup-test',
      filePath: 'test.yml',
      agents: { agent1: { model: 'test', resolvedSystemPrompt: 'test' } },
      context: { provider: 'file', dir: contextDir },
      setup: [
        { shell: 'echo hello', as: 'greeting' },
        { shell: 'echo ${{ greeting }} world', as: 'full' },
      ],
      kickoff: 'Start with ${{ full }}',
    }

    const result = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })

    expect(result.success).toBe(true)
    expect(result.setupResults.greeting).toBe('hello')
    expect(result.setupResults.full).toBe('hello world')

    if (result.shutdown) {
      await result.shutdown()
    }
  })

  test('fails gracefully on setup error', async () => {
    const contextDir = join(testDir, 'context')
    const workflow: ParsedWorkflow = {
      name: 'setup-fail-test',
      filePath: 'test.yml',
      agents: { agent1: { model: 'test', resolvedSystemPrompt: 'test' } },
      context: { provider: 'file', dir: contextDir },
      setup: [{ shell: 'exit 1', as: 'fail' }],
      kickoff: 'This should not run',
    }

    const result = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Setup failed')
  })

  test('fails when context is not configured', async () => {
    const workflow: ParsedWorkflow = {
      name: 'no-context-test',
      filePath: 'test.yml',
      agents: { agent1: { model: 'test', resolvedSystemPrompt: 'test' } },
      setup: [],
      // No context configured
    }

    const result = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('context is disabled')
  })

  test('persistent (bind) context: second run sees preserved state', async () => {
    const contextDir = join(testDir, 'bind-ctx')
    const workflow: ParsedWorkflow = {
      name: 'bind-test',
      filePath: 'test.yml',
      agents: { agent1: { model: 'test', resolvedSystemPrompt: 'test' } },
      context: { provider: 'file', dir: contextDir, persistent: true },
      setup: [],
    }

    // Run 1: write and ack a message
    const run1 = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })
    expect(run1.success).toBe(true)

    await run1.contextProvider!.appendChannel('system', '@agent1 do something')
    await run1.contextProvider!.ackInbox('agent1',
      (await run1.contextProvider!.getInbox('agent1'))[0].entry.id,
    )
    await run1.shutdown!()

    // Run 2: verify state persisted via API (not file checks)
    const run2 = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })
    expect(run2.success).toBe(true)

    // Inbox should be empty — ack from run 1 persisted
    const inbox = await run2.contextProvider!.getInbox('agent1')
    expect(inbox).toHaveLength(0)

    // Channel history from run 1 should be visible
    const messages = await run2.contextProvider!.readChannel()
    expect(messages.some(m => m.content === '@agent1 do something')).toBe(true)

    await run2.shutdown!()
  })

  test('ephemeral context: second run inbox is isolated by run epoch', async () => {
    const contextDir = join(testDir, 'ephemeral-ctx')
    const workflow: ParsedWorkflow = {
      name: 'ephemeral-test',
      filePath: 'test.yml',
      agents: { agent1: { model: 'test', resolvedSystemPrompt: 'test' } },
      context: { provider: 'file', dir: contextDir },
      setup: [],
      // No kickoff with @mention — avoids extra inbox entries from kickoff messages
    }

    // Run 1: write and ack a message
    const run1 = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })
    expect(run1.success).toBe(true)

    await run1.contextProvider!.appendChannel('system', '@agent1 do something')
    const run1Inbox = await run1.contextProvider!.getInbox('agent1')
    expect(run1Inbox).toHaveLength(1)
    await run1.contextProvider!.ackInbox('agent1', run1Inbox[0].entry.id)
    await run1.shutdown!()

    // Run 2: markRunStart() sets epoch — old messages are below the floor
    const run2 = await runWorkflow({
      workflow,
      instance: 'test',
      startAgent: async () => {},
    })
    expect(run2.success).toBe(true)

    // Inbox should be empty — run epoch isolates previous run's messages
    const inbox = await run2.contextProvider!.getInbox('agent1')
    expect(inbox).toHaveLength(0)

    // But channel history is still accessible
    const messages = await run2.contextProvider!.readChannel()
    expect(messages.some(m => m.content === '@agent1 do something')).toBe(true)

    await run2.shutdown!()
  })
})

