/**
 * Workflow Runner
 * Supports setup + kickoff model with shared context
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, existsSync } from 'node:fs'
import type { ParsedWorkflow, SetupTask, ResolvedAgent, ResolvedContext, ResolvedFileContext } from './types.ts'
import { interpolate, createContext, type VariableContext } from './interpolate.ts'
import { createFileContextProvider } from './context/file-provider.ts'
import { createMemoryContextProvider } from './context/memory-provider.ts'
import { createContextMCPServer } from './context/mcp-server.ts'
import { runWithUnixSocket, getSocketPath, type UnixSocketServer } from './context/transport.ts'
import type { ContextProvider } from './context/provider.ts'

const execAsync = promisify(exec)

/**
 * Workflow run configuration
 */
export interface RunConfig {
  /** Workflow to run */
  workflow: ParsedWorkflow
  /** Instance name */
  instance?: string
  /** Verbose output */
  verbose?: boolean
  /** Log function */
  log?: (message: string) => void
  /** Agent startup function */
  startAgent: (agentName: string, config: ResolvedAgent, mcpSocketPath: string) => Promise<void>
}

/**
 * Workflow run result
 */
export interface RunResult {
  /** Success flag */
  success: boolean
  /** Error if failed */
  error?: string
  /** Setup variable results */
  setupResults: Record<string, string>
  /** Execution time in ms */
  duration: number
  /** MCP socket path (for external agents) */
  mcpSocketPath?: string
  /** Context provider for polling/reading state */
  contextProvider?: ContextProvider
  /** Agent names in the workflow */
  agentNames?: string[]
  /** Shutdown function */
  shutdown?: () => Promise<void>
}

/**
 * Workflow runtime instance
 */
export interface WorkflowRuntime {
  /** Workflow name */
  name: string
  /** Instance name */
  instance: string
  /** Context provider */
  contextProvider: ContextProvider
  /** MCP server (if running with Unix socket) */
  mcpServer?: UnixSocketServer
  /** MCP socket path */
  mcpSocketPath: string
  /** Agent names */
  agentNames: string[]
  /** Setup results */
  setupResults: Record<string, string>
  /** Send kickoff message */
  sendKickoff: () => Promise<void>
  /** Shutdown all resources */
  shutdown: () => Promise<void>
}

/**
 * Initialize workflow runtime
 *
 * This sets up:
 * 1. Context provider (file or memory)
 * 2. Context directory (for file provider)
 * 3. MCP server (Unix socket)
 * 4. Runs setup commands
 */
export async function initWorkflow(config: RunConfig): Promise<WorkflowRuntime> {
  const { workflow, instance = 'default', verbose = false, log = console.log } = config
  const startTime = Date.now()

  const agentNames = Object.keys(workflow.agents)

  // Ensure context is enabled (only false if explicitly disabled with `context: false`)
  if (!workflow.context) {
    throw new Error('Workflow context is disabled. Remove "context: false" to enable agent collaboration.')
  }

  const resolvedContext = workflow.context as ResolvedContext

  // Create context provider based on provider type
  let contextProvider: ContextProvider

  if (resolvedContext.provider === 'memory') {
    // Memory provider (for testing)
    if (verbose) log('Using memory context provider')
    contextProvider = createMemoryContextProvider(agentNames)
  } else {
    // File provider (default)
    const fileContext = resolvedContext as ResolvedFileContext

    // Create context directory
    if (!existsSync(fileContext.dir)) {
      mkdirSync(fileContext.dir, { recursive: true })
    }

    if (verbose) log(`Context directory: ${fileContext.dir}`)

    contextProvider = createFileContextProvider(fileContext.dir, agentNames, {
      channelFile: fileContext.channel,
      documentFile: fileContext.document,
    })
  }

  // Create MCP server
  const mcpSocketPath = getSocketPath(workflow.name, instance)
  if (verbose) log(`MCP socket: ${mcpSocketPath}`)

  const mcpServer = await runWithUnixSocket(
    () =>
      createContextMCPServer({
        provider: contextProvider,
        validAgents: agentNames,
        name: `${workflow.name}-context`,
        version: '1.0.0',
      }).server,
    mcpSocketPath,
    {
      onConnect: (agentId, connId) => {
        if (verbose) log(`Agent connected: ${agentId} (${connId.slice(0, 8)})`)
      },
      onDisconnect: (agentId, connId) => {
        if (verbose) log(`Agent disconnected: ${agentId} (${connId.slice(0, 8)})`)
      },
    }
  )

  // Run setup commands
  const setupResults: Record<string, string> = {}
  const context = createContext(workflow.name, instance, setupResults)

  if (workflow.setup && workflow.setup.length > 0) {
    if (verbose) log('\nRunning setup...')
    for (const task of workflow.setup) {
      try {
        const result = await runSetupTask(task, context, verbose, log)
        if (task.as) {
          setupResults[task.as] = result
          context[task.as] = result
        }
      } catch (error) {
        await mcpServer.close()
        throw new Error(
          `Setup failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  // Interpolate kickoff with setup results
  const interpolatedKickoff = workflow.kickoff
    ? interpolate(workflow.kickoff, context)
    : undefined

  // Build runtime
  const runtime: WorkflowRuntime = {
    name: workflow.name,
    instance,
    contextProvider,
    mcpServer,
    mcpSocketPath,
    agentNames,
    setupResults,

    async sendKickoff() {
      if (!interpolatedKickoff) {
        if (verbose) log('No kickoff message configured')
        return
      }

      if (verbose) log(`\nKickoff: ${interpolatedKickoff.slice(0, 100)}...`)

      // Send kickoff as 'orchestrator' to the channel
      await contextProvider.appendChannel('orchestrator', interpolatedKickoff)
    },

    async shutdown() {
      if (verbose) log('\nShutting down workflow...')
      await mcpServer.close()
    },
  }

  if (verbose) {
    log(`\nWorkflow initialized in ${Date.now() - startTime}ms`)
    log(`Agents: ${agentNames.join(', ')}`)
  }

  return runtime
}

/**
 * Run a setup task
 */
async function runSetupTask(
  task: SetupTask,
  context: VariableContext,
  verbose: boolean,
  log: (message: string) => void
): Promise<string> {
  const command = interpolate(task.shell, context)

  if (verbose) {
    const displayCmd = command.length > 60 ? command.slice(0, 60) + '...' : command
    log(`  $ ${displayCmd}`)
  }

  try {
    const { stdout } = await execAsync(command)
    const result = stdout.trim()

    if (verbose && task.as) {
      const displayResult = result.length > 60 ? result.slice(0, 60) + '...' : result
      log(`  ${task.as} = ${displayResult}`)
    }

    return result
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Run a workflow (start mode)
 *
 * This initializes the runtime, starts agents, and sends kickoff.
 * Agents remain running until explicitly stopped.
 */
export async function runWorkflow(config: RunConfig): Promise<RunResult> {
  const { workflow, instance = 'default', verbose = false, log = console.log } = config
  const startTime = Date.now()

  try {
    // Initialize runtime
    const runtime = await initWorkflow(config)

    // Start all agents with MCP config
    if (verbose) log('\nStarting agents...')

    for (const agentName of runtime.agentNames) {
      const agentDef = workflow.agents[agentName]
      try {
        await config.startAgent(agentName, agentDef, runtime.mcpSocketPath)
        if (verbose) log(`  Started: ${agentName}`)
      } catch (error) {
        await runtime.shutdown()
        return {
          success: false,
          error: `Failed to start agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`,
          setupResults: runtime.setupResults,
          duration: Date.now() - startTime,
        }
      }
    }

    // Send kickoff
    await runtime.sendKickoff()

    return {
      success: true,
      setupResults: runtime.setupResults,
      duration: Date.now() - startTime,
      mcpSocketPath: runtime.mcpSocketPath,
      contextProvider: runtime.contextProvider,
      agentNames: runtime.agentNames,
      shutdown: () => runtime.shutdown(),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      setupResults: {},
      duration: Date.now() - startTime,
    }
  }
}
