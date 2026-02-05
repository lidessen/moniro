/**
 * Workflow runner - executes workflows
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { ParsedWorkflow, Task, ResolvedAgent } from './types.ts'
import { isShellTask, isSendTask, isConditionalTask, isParallelTask } from './types.ts'
import { interpolate, createContext, evaluateCondition, type VariableContext } from './interpolate.ts'
import { buildAgentId } from '../cli/instance.ts'

const execAsync = promisify(exec)

export interface RunConfig {
  /** Workflow to run */
  workflow: ParsedWorkflow
  /** Instance name */
  instance?: string
  /** Lazy agent startup */
  lazy?: boolean
  /** Verbose output */
  verbose?: boolean
  /** Agent send function */
  sendToAgent: (agentName: string, message: string, outputPrompt?: string) => Promise<string>
  /** Agent startup function */
  startAgent: (agentName: string, config: ResolvedAgent) => Promise<void>
  /** Log function */
  log?: (message: string) => void
}

export interface RunResult {
  /** Final output (last task result) */
  output: string
  /** All task results */
  results: Record<string, string>
  /** Execution time in ms */
  duration: number
  /** Success flag */
  success: boolean
  /** Error if failed */
  error?: string
}

const TASK_MODE_PREFIX = `[Task Mode] This is a task execution, not a conversation.
Complete the task and provide your final result in the last message.

Task: `

/**
 * Run a workflow
 */
export async function runWorkflow(config: RunConfig): Promise<RunResult> {
  const { workflow, instance = 'default', lazy = false, verbose = false, log = console.log } = config
  const startTime = Date.now()

  const results: Record<string, string> = {}
  const startedAgents = new Set<string>()

  // Create variable context
  const context = createContext(workflow.name, instance, results)

  // Start all agents (eager mode)
  if (!lazy) {
    if (verbose) log('Starting agents...')
    for (const [agentName, agentDef] of Object.entries(workflow.agents)) {
      try {
        await config.startAgent(agentName, agentDef)
        startedAgents.add(agentName)
        if (verbose) log(`  Started: ${agentName}`)
      } catch (error) {
        return {
          output: '',
          results,
          duration: Date.now() - startTime,
          success: false,
          error: `Failed to start agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }
  }

  // Execute tasks
  let lastOutput = ''
  try {
    for (let i = 0; i < workflow.tasks.length; i++) {
      const task = workflow.tasks[i]
      if (verbose) log(`\nTask ${i + 1}/${workflow.tasks.length}:`)

      const taskResult = await executeTask(task, context, {
        ...config,
        startedAgents,
        verbose,
        log,
      })

      if (taskResult.name) {
        results[taskResult.name] = taskResult.output
        // Update context with new result
        context[taskResult.name] = taskResult.output
      }

      lastOutput = taskResult.output
    }
  } catch (error) {
    return {
      output: lastOutput,
      results,
      duration: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  return {
    output: lastOutput,
    results,
    duration: Date.now() - startTime,
    success: true,
  }
}

interface TaskResult {
  output: string
  name?: string
}

interface TaskContext extends RunConfig {
  startedAgents: Set<string>
}

async function executeTask(
  task: Task,
  context: VariableContext,
  config: TaskContext
): Promise<TaskResult> {
  const { verbose, log = console.log } = config

  // Check conditional FIRST (before shell/send) since conditional tasks can have shell/send
  if (isConditionalTask(task)) {
    // Conditional task
    const conditionMet = evaluateCondition(task.if, context)

    if (verbose) log(`  if: ${task.if} => ${conditionMet}`)

    if (!conditionMet) {
      return { output: '' }
    }

    // Execute the conditional action
    if (task.shell) {
      const command = interpolate(task.shell, context)
      if (verbose) log(`  shell: ${command.slice(0, 50)}...`)
      const { stdout } = await execAsync(command)
      const output = stdout.trim()
      if (verbose) log(`  output: ${output.slice(0, 100)}${output.length > 100 ? '...' : ''}`)
      return { output, name: typeof task.as === 'string' ? task.as : task.as?.name }
    }

    if (task.send && task.to) {
      const message = TASK_MODE_PREFIX + interpolate(task.send, context)
      if (verbose) log(`  send to ${task.to}: ${task.send.slice(0, 50)}...`)

      // Lazy start agent if needed
      if (!config.startedAgents.has(task.to)) {
        const agentDef = config.workflow.agents[task.to]
        if (!agentDef) {
          throw new Error(`Agent not defined: ${task.to}`)
        }
        await config.startAgent(task.to, agentDef)
        config.startedAgents.add(task.to)
      }

      let outputPrompt: string | undefined
      let outputName: string | undefined

      if (typeof task.as === 'object') {
        outputName = task.as.name
        outputPrompt = task.as.prompt
      } else {
        outputName = task.as
      }

      const output = await config.sendToAgent(task.to, message, outputPrompt)
      if (verbose) log(`  response: ${output.slice(0, 100)}${output.length > 100 ? '...' : ''}`)
      return { output, name: outputName }
    }

    return { output: '' }
  }

  if (isShellTask(task)) {
    // Shell task
    const command = interpolate(task.shell, context)
    if (verbose) log(`  shell: ${command.slice(0, 50)}...`)

    try {
      const { stdout } = await execAsync(command)
      const output = stdout.trim()
      if (verbose) log(`  output: ${output.slice(0, 100)}${output.length > 100 ? '...' : ''}`)
      return { output, name: task.as }
    } catch (error) {
      throw new Error(`Shell command failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (isSendTask(task)) {
    // Send task
    const message = TASK_MODE_PREFIX + interpolate(task.send, context)
    if (verbose) log(`  send to ${task.to}: ${task.send.slice(0, 50)}...`)

    // Lazy start agent if needed
    if (!config.startedAgents.has(task.to)) {
      const agentDef = config.workflow.agents[task.to]
      if (!agentDef) {
        throw new Error(`Agent not defined: ${task.to}`)
      }
      await config.startAgent(task.to, agentDef)
      config.startedAgents.add(task.to)
    }

    // Determine output prompt if as is object
    let outputPrompt: string | undefined
    let outputName: string | undefined

    if (typeof task.as === 'object') {
      outputName = task.as.name
      outputPrompt = task.as.prompt
    } else {
      outputName = task.as
    }

    const output = await config.sendToAgent(task.to, message, outputPrompt)
    if (verbose) log(`  response: ${output.slice(0, 100)}${output.length > 100 ? '...' : ''}`)

    return { output, name: outputName }
  }

  if (isParallelTask(task)) {
    // Parallel task - execute all in parallel
    if (verbose) log(`  parallel: ${task.parallel.length} tasks`)

    const results = await Promise.all(
      task.parallel.map(subTask => executeTask(subTask, context, config))
    )

    // Merge results into context
    for (const result of results) {
      if (result.name) {
        context[result.name] = result.output
      }
    }

    // Return last result's output
    const lastResult = results[results.length - 1]
    return { output: lastResult?.output || '', name: lastResult?.name }
  }

  return { output: '' }
}
