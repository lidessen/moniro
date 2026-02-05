/**
 * Workflow Integration Tests
 *
 * These tests simulate real workflow execution scenarios with:
 * - Real shell commands
 * - Mocked agent interactions
 * - File system operations
 * - Complex workflow patterns
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseWorkflowFile, runWorkflow

 } from '../src/workflow/index.ts'
import type { ParsedWorkflow, ResolvedAgent } from '../src/workflow/types.ts'

// ==================== Test Utilities ====================

interface MockAgent {
  name: string
  responses: Map<string, string>
  receivedMessages: string[]
}

function createMockAgentSystem() {
  const agents = new Map<string, MockAgent>()
  const startedAgents: string[] = []

  return {
    agents,
    startedAgents,

    registerAgent(name: string, responses: Record<string, string> = {}) {
      agents.set(name, {
        name,
        responses: new Map(Object.entries(responses)),
        receivedMessages: [],
      })
    },

    async startAgent(name: string, _config: ResolvedAgent) {
      startedAgents.push(name)
    },

    async sendToAgent(name: string, message: string, _outputPrompt?: string): Promise<string> {
      const agent = agents.get(name)
      if (!agent) {
        throw new Error(`Agent not registered: ${name}`)
      }

      agent.receivedMessages.push(message)

      // Find matching response
      for (const [pattern, response] of agent.responses) {
        if (message.includes(pattern)) {
          return response
        }
      }

      return `[${name}] Received: ${message.slice(0, 50)}...`
    },

    getAgent(name: string) {
      return agents.get(name)
    },

    reset() {
      agents.clear()
      startedAgents.length = 0
    },
  }
}

// ==================== Integration Tests ====================

describe('Workflow Integration', () => {
  let testDir: string
  let mockAgents: ReturnType<typeof createMockAgentSystem>

  beforeEach(() => {
    testDir = join(tmpdir(), `workflow-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    mockAgents = createMockAgentSystem()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mockAgents.reset()
  })

  describe('Shell Task Workflows', () => {
    test('executes sequential shell commands with variable passing', async () => {
      const workflowPath = join(testDir, 'shell-chain.yml')
      writeFileSync(
        workflowPath,
        `name: shell-chain
agents:
  dummy:
    model: test
    system_prompt: test
tasks:
  - shell: echo "step1"
    as: step1
  - shell: echo "after \${{ step1 }}"
    as: step2
  - shell: echo "final \${{ step2 }}"
    as: final
`
      )

      const workflow = await parseWorkflowFile(workflowPath)
      mockAgents.registerAgent('dummy')

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.step1).toBe('step1')
      expect(result.results.step2).toBe('after step1')
      expect(result.results.final).toBe('final after step1')
    })

    test('handles file operations in workflow', async () => {
      const dataFile = join(testDir, 'data.txt')
      writeFileSync(dataFile, 'original content')

      const workflowPath = join(testDir, 'file-ops.yml')
      writeFileSync(
        workflowPath,
        `name: file-operations
agents:
  processor:
    model: test
    system_prompt: test
tasks:
  - shell: cat ${dataFile}
    as: content
  - shell: echo "processed" > ${dataFile} && cat ${dataFile}
    as: written
  - shell: wc -c < ${dataFile}
    as: size
`
      )

      const workflow = await parseWorkflowFile(workflowPath)
      mockAgents.registerAgent('processor')

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.content).toBe('original content')
      expect(result.results.written).toBe('processed')
      expect(parseInt(result.results.size.trim())).toBeGreaterThan(0)
    })

    test('captures command exit codes via shell', async () => {
      const workflowPath = join(testDir, 'exit-code.yml')
      writeFileSync(
        workflowPath,
        `name: exit-code-check
agents:
  checker:
    model: test
    system_prompt: test
tasks:
  - shell: test -f ${join(testDir, 'exists.txt')} && echo "exists" || echo "missing"
    as: check1
  - shell: touch ${join(testDir, 'exists.txt')} && echo "created"
    as: create
  - shell: test -f ${join(testDir, 'exists.txt')} && echo "exists" || echo "missing"
    as: check2
`
      )

      const workflow = await parseWorkflowFile(workflowPath)
      mockAgents.registerAgent('checker')

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.check1).toBe('missing')
      expect(result.results.create).toBe('created')
      expect(result.results.check2).toBe('exists')
    })
  })

  describe('Agent Interaction Workflows', () => {
    test('simulates code review workflow', async () => {
      const codeFile = join(testDir, 'code.ts')
      writeFileSync(codeFile, 'function add(a: number, b: number) { return a + b }')

      const workflowPath = join(testDir, 'code-review.yml')
      writeFileSync(
        workflowPath,
        `name: code-review
agents:
  reviewer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You are a code reviewer.
  fixer:
    model: anthropic/claude-sonnet-4-5
    system_prompt: You fix code based on reviews.
tasks:
  - shell: cat ${codeFile}
    as: code
  - send: "Review this code:\\n\${{ code }}"
    to: reviewer
    as: review
  - send: "Fix based on review:\\n\${{ review }}\\n\\nCode:\\n\${{ code }}"
    to: fixer
    as: fixed_code
`
      )

      mockAgents.registerAgent('reviewer', {
        'Review this code': 'Missing JSDoc comments. Consider adding type exports.',
      })
      mockAgents.registerAgent('fixer', {
        'Fix based on review': '/** Adds two numbers */\nexport function add(a: number, b: number): number { return a + b }',
      })

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.code).toContain('function add')
      expect(result.results.review).toContain('JSDoc')
      expect(result.results.fixed_code).toContain('export function add')

      // Verify agents received correct messages
      const reviewer = mockAgents.getAgent('reviewer')!
      expect(reviewer.receivedMessages.length).toBe(1)
      expect(reviewer.receivedMessages[0]).toContain('[Task Mode]')
      expect(reviewer.receivedMessages[0]).toContain('function add')
    })

    test('simulates multi-agent collaboration', async () => {
      const workflowPath = join(testDir, 'collaboration.yml')
      writeFileSync(
        workflowPath,
        `name: collaboration
agents:
  planner:
    model: test
    system_prompt: You create plans.
  implementer:
    model: test
    system_prompt: You implement plans.
  tester:
    model: test
    system_prompt: You write tests.
tasks:
  - send: "Create a plan for a todo app"
    to: planner
    as: plan
  - send: "Implement: \${{ plan }}"
    to: implementer
    as: implementation
  - send: "Write tests for: \${{ implementation }}"
    to: tester
    as: tests
`
      )

      mockAgents.registerAgent('planner', {
        'Create a plan': '1. Create TodoItem model\n2. Add CRUD operations\n3. Build UI',
      })
      mockAgents.registerAgent('implementer', {
        'Implement:': 'class TodoItem { constructor(public title: string) {} }',
      })
      mockAgents.registerAgent('tester', {
        'Write tests': "test('TodoItem creates with title', () => { expect(new TodoItem('test').title).toBe('test') })",
      })

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(mockAgents.startedAgents).toContain('planner')
      expect(mockAgents.startedAgents).toContain('implementer')
      expect(mockAgents.startedAgents).toContain('tester')
      expect(result.results.plan).toContain('TodoItem')
      expect(result.results.implementation).toContain('class TodoItem')
      expect(result.results.tests).toContain('test(')
    })
  })

  describe('Conditional Workflows', () => {
    test('branches based on shell output', async () => {
      const workflowPath = join(testDir, 'conditional.yml')
      writeFileSync(
        workflowPath,
        `name: conditional-branch
agents:
  handler:
    model: test
    system_prompt: test
tasks:
  - shell: echo "success"
    as: status
  - if: \${{ status }} == "success"
    shell: echo "handling success path"
    as: success_result
  - if: \${{ status }} == "failure"
    shell: echo "handling failure path"
    as: failure_result
`
      )

      mockAgents.registerAgent('handler')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.status).toBe('success')
      expect(result.results.success_result).toBe('handling success path')
      expect(result.results.failure_result).toBeUndefined()
    })

    test('chains conditionals with contains check', async () => {
      const workflowPath = join(testDir, 'contains-check.yml')
      writeFileSync(
        workflowPath,
        `name: contains-conditional
agents:
  analyzer:
    model: test
    system_prompt: test
tasks:
  - shell: 'echo "error - file not found"'
    as: output
  - if: \${{ output }}.contains("error")
    shell: echo "detected error"
    as: error_detected
  - if: \${{ output }}.contains("success")
    shell: echo "detected success"
    as: success_detected
`
      )

      mockAgents.registerAgent('analyzer')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.error_detected).toBe('detected error')
      expect(result.results.success_detected).toBeUndefined()
    })

    test('conditional agent task', async () => {
      const workflowPath = join(testDir, 'conditional-agent.yml')
      writeFileSync(
        workflowPath,
        `name: conditional-agent
agents:
  helper:
    model: test
    system_prompt: test
tasks:
  - shell: echo "needs_help"
    as: check
  - if: \${{ check }}.contains("needs_help")
    send: "Please help with this task"
    to: helper
    as: help_response
`
      )

      mockAgents.registerAgent('helper', {
        'Please help': 'Here is my assistance.',
      })

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        lazy: true, // Only start agent if needed
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.help_response).toBe('Here is my assistance.')
      expect(mockAgents.startedAgents).toContain('helper')
    })
  })

  describe('Parallel Workflows', () => {
    test('executes parallel shell tasks', async () => {
      const workflowPath = join(testDir, 'parallel-shell.yml')
      writeFileSync(
        workflowPath,
        `name: parallel-shell
agents:
  worker:
    model: test
    system_prompt: test
tasks:
  - parallel:
      - shell: echo "task1"
        as: p1
      - shell: echo "task2"
        as: p2
      - shell: echo "task3"
        as: p3
  - shell: echo "\${{ p1 }}-\${{ p2 }}-\${{ p3 }}"
    as: combined
`
      )

      mockAgents.registerAgent('worker')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.p1).toBe('task1')
      expect(result.results.p2).toBe('task2')
      expect(result.results.p3).toBe('task3')
      expect(result.results.combined).toBe('task1-task2-task3')
    })

    test('parallel agent tasks', async () => {
      const workflowPath = join(testDir, 'parallel-agents.yml')
      writeFileSync(
        workflowPath,
        `name: parallel-agents
agents:
  analyst1:
    model: test
    system_prompt: Analyze from perspective 1
  analyst2:
    model: test
    system_prompt: Analyze from perspective 2
tasks:
  - shell: echo "data to analyze"
    as: data
  - parallel:
      - send: "Analyze: \${{ data }}"
        to: analyst1
        as: analysis1
      - send: "Analyze: \${{ data }}"
        to: analyst2
        as: analysis2
  - shell: echo "Both analyses complete"
    as: done
`
      )

      mockAgents.registerAgent('analyst1', {
        'Analyze:': 'Perspective 1: The data shows positive trends.',
      })
      mockAgents.registerAgent('analyst2', {
        'Analyze:': 'Perspective 2: Risk factors identified.',
      })

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.analysis1).toContain('Perspective 1')
      expect(result.results.analysis2).toContain('Perspective 2')
      expect(mockAgents.startedAgents).toContain('analyst1')
      expect(mockAgents.startedAgents).toContain('analyst2')
    })

    test('nested parallel with file operations', async () => {
      const file1 = join(testDir, 'file1.txt')
      const file2 = join(testDir, 'file2.txt')

      const workflowPath = join(testDir, 'parallel-files.yml')
      writeFileSync(
        workflowPath,
        `name: parallel-files
agents:
  worker:
    model: test
    system_prompt: test
tasks:
  - parallel:
      - shell: echo "content1" > ${file1} && echo "wrote file1"
        as: write1
      - shell: echo "content2" > ${file2} && echo "wrote file2"
        as: write2
  - parallel:
      - shell: cat ${file1}
        as: read1
      - shell: cat ${file2}
        as: read2
`
      )

      mockAgents.registerAgent('worker')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.write1).toBe('wrote file1')
      expect(result.results.write2).toBe('wrote file2')
      expect(result.results.read1).toBe('content1')
      expect(result.results.read2).toBe('content2')
    })
  })

  describe('Error Handling', () => {
    test('captures shell command failure', async () => {
      const workflowPath = join(testDir, 'shell-fail.yml')
      writeFileSync(
        workflowPath,
        `name: shell-failure
agents:
  worker:
    model: test
    system_prompt: test
tasks:
  - shell: echo "starting"
    as: start
  - shell: exit 1
    as: should_fail
  - shell: echo "should not reach"
    as: after_fail
`
      )

      mockAgents.registerAgent('worker')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Shell command failed')
      expect(result.results.start).toBe('starting')
      expect(result.results.after_fail).toBeUndefined()
    })

    test('handles missing agent gracefully', async () => {
      const workflowPath = join(testDir, 'missing-agent.yml')
      writeFileSync(
        workflowPath,
        `name: missing-agent
agents:
  defined:
    model: test
    system_prompt: test
tasks:
  - send: "Hello"
    to: undefined_agent
    as: response
`
      )

      mockAgents.registerAgent('defined')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        lazy: true,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not defined')
    })

    test('handles agent start failure', async () => {
      const workflowPath = join(testDir, 'agent-start-fail.yml')
      writeFileSync(
        workflowPath,
        `name: agent-start-fail
agents:
  failing:
    model: test
    system_prompt: test
tasks:
  - shell: echo "before"
    as: before
`
      )

      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: async () => {
          throw new Error('Failed to start agent')
        },
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to start agent')
    })

    test('handles agent communication failure', async () => {
      const workflowPath = join(testDir, 'agent-comm-fail.yml')
      writeFileSync(
        workflowPath,
        `name: agent-comm-fail
agents:
  flaky:
    model: test
    system_prompt: test
tasks:
  - send: "This will fail"
    to: flaky
    as: response
`
      )

      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: async () => {},
        sendToAgent: async () => {
          throw new Error('Connection refused')
        },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection refused')
    })
  })

  describe('Complex Workflows', () => {
    test('full CI/CD simulation', async () => {
      const srcFile = join(testDir, 'app.ts')
      const testFile = join(testDir, 'app.test.ts')

      writeFileSync(srcFile, 'export const greet = (n: string) => `Hello ${n}`')
      writeFileSync(testFile, 'import { greet } from "./app"; test("greets", () => expect(greet("World")).toBe("Hello World"))')

      const workflowPath = join(testDir, 'cicd.yml')
      writeFileSync(
        workflowPath,
        `name: ci-cd-pipeline
agents:
  linter:
    model: test
    system_prompt: You are a linter.
  reviewer:
    model: test
    system_prompt: You are a code reviewer.
tasks:
  # Step 1: Read source
  - shell: cat ${srcFile}
    as: source

  # Step 2: Parallel lint and review
  - parallel:
      - send: "Lint this code:\\n\${{ source }}"
        to: linter
        as: lint_result
      - send: "Review this code:\\n\${{ source }}"
        to: reviewer
        as: review_result

  # Step 3: Check lint result
  - if: \${{ lint_result }}.contains("pass")
    shell: echo "Lint passed"
    as: lint_status

  # Step 4: Build (simulated)
  - shell: echo "Build successful"
    as: build_result

  # Step 5: Summary
  - shell: 'echo "Pipeline complete"'
    as: summary
`
      )

      mockAgents.registerAgent('linter', {
        'Lint this code': 'Lint pass: No issues found.',
      })
      mockAgents.registerAgent('reviewer', {
        'Review this code': 'Code looks good. Consider adding types.',
      })

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        verbose: false,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.lint_result).toContain('pass')
      expect(result.results.review_result).toContain('Consider adding types')
      expect(result.results.lint_status).toBe('Lint passed')
      expect(result.results.build_result).toBe('Build successful')
    })

    test('iterative refinement workflow', async () => {
      const workflowPath = join(testDir, 'refinement.yml')
      writeFileSync(
        workflowPath,
        `name: iterative-refinement
agents:
  writer:
    model: test
    system_prompt: You write code.
  critic:
    model: test
    system_prompt: You critique code.
tasks:
  - send: "Write a hello world function"
    to: writer
    as: draft1
  - send: "Critique: \${{ draft1 }}"
    to: critic
    as: critique1
  - send: "Improve based on: \${{ critique1 }}\\nOriginal: \${{ draft1 }}"
    to: writer
    as: draft2
  - send: "Final review: \${{ draft2 }}"
    to: critic
    as: final_review
`
      )

      mockAgents.registerAgent('writer', {
        'Write a hello world': 'function hello() { console.log("hi") }',
        'Improve based on': 'function hello(name = "World") { console.log(`Hello ${name}`) }',
      })
      mockAgents.registerAgent('critic', {
        'Critique:': 'Add parameter support and template literals.',
        'Final review': 'Approved! Good use of default parameters.',
      })

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.draft1).toContain('console.log')
      expect(result.results.critique1).toContain('parameter')
      expect(result.results.draft2).toContain('name = "World"')
      expect(result.results.final_review).toContain('Approved')
    })
  })

  describe('Lazy vs Eager Agent Startup', () => {
    test('eager mode starts all agents upfront', async () => {
      const workflowPath = join(testDir, 'eager.yml')
      writeFileSync(
        workflowPath,
        `name: eager-test
agents:
  agent1:
    model: test
    system_prompt: test
  agent2:
    model: test
    system_prompt: test
  agent3:
    model: test
    system_prompt: test
tasks:
  - send: "Only using agent1"
    to: agent1
    as: result
`
      )

      mockAgents.registerAgent('agent1', { 'Only using': 'Response from agent1' })
      mockAgents.registerAgent('agent2', {})
      mockAgents.registerAgent('agent3', {})

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        lazy: false, // Eager mode
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      // All agents should be started even though only agent1 is used
      expect(mockAgents.startedAgents).toContain('agent1')
      expect(mockAgents.startedAgents).toContain('agent2')
      expect(mockAgents.startedAgents).toContain('agent3')
    })

    test('lazy mode only starts used agents', async () => {
      const workflowPath = join(testDir, 'lazy.yml')
      writeFileSync(
        workflowPath,
        `name: lazy-test
agents:
  used:
    model: test
    system_prompt: test
  unused:
    model: test
    system_prompt: test
tasks:
  - send: "Hello"
    to: used
    as: result
`
      )

      mockAgents.registerAgent('used', { Hello: 'Used agent response' })
      mockAgents.registerAgent('unused', {})

      const workflow = await parseWorkflowFile(workflowPath)
      const result = await runWorkflow({
        workflow,
        lazy: true, // Lazy mode
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(mockAgents.startedAgents).toContain('used')
      expect(mockAgents.startedAgents).not.toContain('unused')
    })
  })

  describe('Workflow Metadata', () => {
    test('workflow.name and workflow.instance are accessible', async () => {
      const workflowPath = join(testDir, 'metadata.yml')
      writeFileSync(
        workflowPath,
        `name: my-workflow
agents:
  worker:
    model: test
    system_prompt: test
tasks:
  - shell: 'echo "Workflow = \${{ workflow.name }}"'
    as: name_output
  - shell: 'echo "Instance = \${{ workflow.instance }}"'
    as: instance_output
`
      )

      mockAgents.registerAgent('worker')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        instance: 'production',
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.name_output).toBe('Workflow = my-workflow')
      expect(result.results.instance_output).toBe('Instance = production')
    })

    test('environment variables are accessible', async () => {
      const workflowPath = join(testDir, 'env-vars.yml')
      writeFileSync(
        workflowPath,
        `name: env-test
agents:
  worker:
    model: test
    system_prompt: test
tasks:
  - shell: 'echo "Home = \${{ env.HOME }}"'
    as: home
  - shell: 'echo "Path = \${{ env.PATH }}"'
    as: path_check
`
      )

      mockAgents.registerAgent('worker')
      const workflow = await parseWorkflowFile(workflowPath)

      const result = await runWorkflow({
        workflow,
        startAgent: mockAgents.startAgent.bind(mockAgents),
        sendToAgent: mockAgents.sendToAgent.bind(mockAgents),
      })

      expect(result.success).toBe(true)
      expect(result.results.home).toContain('Home =')
      // PATH should be interpolated
      expect(result.results.path_check).not.toContain('${{')
    })
  })
})
